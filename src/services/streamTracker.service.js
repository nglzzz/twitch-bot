const db = require('../app/db');
const StreamSession = require('../models/streamSession.model');
const { getChannelInfo } = require('../twitchApi/channelInfo');
const config = require('../config');

const DEFAULT_CHANNEL = (config.CHANNEL || 'nglzzz').toLowerCase();

let _activeSession = null;
let _pollTimer = null;
let _lastStreamId = null;

const STREAM_OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function isDbReady() {
  return db?.connection?.readyState === 1;
}

async function getActiveSession() {
  if (_activeSession) {
    return _activeSession;
  }

  if (!isDbReady()) {
    return null;
  }

  try {
    const live = await StreamSession.findOne({ status: 'live' }).sort({ startedAt: -1 });

    if (live) {
      _activeSession = live;
      return live;
    }
  } catch (error) {
    console.error('[StreamTracker] Error finding active session:', error.message);
  }

  return null;
}

async function _createSession(streamData) {
  if (!isDbReady()) {
    return null;
  }

  try {
    const session = new StreamSession({
      streamId: streamData.id || streamData.stream_id,
      title: streamData.title || '',
      gameName: streamData.game_name || '',
      startedAt: streamData.started_at ? new Date(streamData.started_at) : new Date(),
      lastSeenAt: new Date(),
      status: 'live',
    });

    await session.save();
    _activeSession = session;
    _lastStreamId = session._id;
    console.log(`[StreamTracker] New stream session started: "${session.title}" (${session.streamId})`);
    return session;
  } catch (error) {
    console.error('[StreamTracker] Error creating session:', error.message);
    return null;
  }
}

async function _endSession(session) {
  if (!session) {
    return;
  }

  try {
    session.status = 'ended';
    session.endedAt = new Date();

    // Finalize unique viewers/chatters from chatLog and viewer snapshots
    if (isDbReady()) {
      const chatLogModel = require('../models/chatLog.model');
      const viewerModel = require('../models/viewer.model');

      const since = session.startedAt || session.createdAt;

      const [chatterStats, viewerSnapshots] = await Promise.all([
        chatLogModel.aggregate([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: '$user' } },
          { $count: 'total' },
        ]),
        viewerModel.find({ createdAt: { $gte: since } }).lean(),
      ]);

      if (chatterStats.length > 0) {
        session.uniqueChatters = chatterStats[0].total;
      }

      const allViewers = new Set();
      viewerSnapshots.forEach((snap) => {
        (snap.viewers || []).forEach((v) => allViewers.add(String(v).toLowerCase()));
      });
      session.uniqueViewers = allViewers.size;

      // Count messages for this session
      session.messagesCount = await chatLogModel.countDocuments({
        createdAt: { $gte: since },
        ...(session.endedAt ? { createdAt: { $lte: session.endedAt } } : {}),
      });
    }

    await session.save();
    console.log(`[StreamTracker] Stream ended: "${session.title}" (${session.streamId})`);
  } catch (error) {
    console.error('[StreamTracker] Error ending session:', error.message);
  }

  if (_activeSession && _activeSession._id.equals(session._id)) {
    _activeSession = null;
  }
}

async function checkStreamStatus() {
  if (!isDbReady()) {
    return;
  }

  try {
    const streams = await getChannelInfo(DEFAULT_CHANNEL);
    const isLive = streams && streams.length > 0;
    const streamData = isLive ? streams[0] : null;

    if (isLive && streamData) {
      const currentStreamId = String(streamData.id || streamData.stream_id || '');
      let session = await getActiveSession();

      if (!session || (session.streamId && session.streamId !== currentStreamId)) {
        // End old session if stream ID changed
        if (session) {
          await _endSession(session);
        }

        session = await _createSession(streamData);
      } else {
        // Update existing session
        session.title = streamData.title || session.title;
        session.gameName = streamData.game_name || session.gameName;
        session.lastSeenAt = new Date();
        await session.save();
      }
    } else {
      // Stream is offline
      const session = await getActiveSession();

      if (session && session.lastSeenAt) {
        const timeSinceLastSeen = Date.now() - new Date(session.lastSeenAt).getTime();

        if (timeSinceLastSeen > STREAM_OFFLINE_THRESHOLD_MS) {
          await _endSession(session);
        }
      }
    }
  } catch (error) {
    console.error('[StreamTracker] Error checking stream status:', error.message);
  }
}

async function linkMessageToStream(chatLogEntry) {
  const session = await getActiveSession();

  if (session && chatLogEntry) {
    chatLogEntry.streamSessionId = session._id;
  }
}

async function linkViewerSnapshotToStream(viewerDoc) {
  const session = await getActiveSession();

  if (session && viewerDoc) {
    viewerDoc.streamSessionId = session._id;

    // Update session viewer stats
    const count = (viewerDoc.viewers || []).length;
    session.updateViewers(count);
    await session.save();
  }
}

async function getActiveSessionId() {
  const session = await getActiveSession();
  return session ? session._id : null;
}

function startTracking(pollIntervalMs) {
  const interval = pollIntervalMs || 5 * 60 * 1000; // default 5 minutes

  if (_pollTimer) {
    clearInterval(_pollTimer);
  }

  // Check immediately on start
  checkStreamStatus();

  _pollTimer = setInterval(checkStreamStatus, interval);
  console.log(`[StreamTracker] Started polling every ${Math.round(interval / 1000)}s`);
}

function stopTracking() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
    console.log('[StreamTracker] Stopped polling');
  }
}

module.exports = {
  getActiveSession,
  getActiveSessionId,
  checkStreamStatus,
  linkMessageToStream,
  linkViewerSnapshotToStream,
  startTracking,
  stopTracking,
};
