const { isDbReady } = require('../app/db');
const streamSessionRepo = require('../repositories/streamSession.repo');
const chatLogRepo = require('../repositories/chatLog.repo');
const viewerRepo = require('../repositories/viewer.repo');
const { getChannelInfo } = require('../twitchApi/channelInfo');
const config = require('../config');

const DEFAULT_CHANNEL = (config.CHANNEL || 'nglzzz').toLowerCase();

let _activeSession = null;
let _pollTimer = null;

const STREAM_OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Возвращает активную сессию стрима (объект camelCase) или null.
 * Кэшируется в памяти между вызовами.
 */
async function getActiveSession() {
  if (_activeSession) {
    return _activeSession;
  }

  if (!isDbReady()) {
    return null;
  }

  try {
    const live = streamSessionRepo.findOneLiveLatest();

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
    const session = streamSessionRepo.create({
      streamId: streamData.id || streamData.stream_id,
      title: streamData.title || '',
      gameName: streamData.game_name || '',
      startedAt: streamData.started_at ? new Date(streamData.started_at) : new Date(),
      lastSeenAt: new Date(),
      status: 'live',
    });

    _activeSession = session;
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
    const endedAt = Date.now();
    const since = session.startedAt || session.createdAt;

    const patch = {
      status: 'ended',
      endedAt: new Date(endedAt),
    };

    if (isDbReady() && since !== null && since !== undefined) {
      const sinceMs = since instanceof Date ? since.getTime() : Number(since);

      patch.uniqueChatters = chatLogRepo.countBetween(sinceMs, endedAt) > 0
        ? chatLogRepo.distinctUsersSince({ since: sinceMs })
        : 0;

      const snapshots = viewerRepo.findSnapshots({ since: sinceMs });
      const allViewers = new Set();
      snapshots.forEach((snap) => {
        (snap.viewers || []).forEach((v) => allViewers.add(String(v).toLowerCase()));
      });
      patch.uniqueViewers = allViewers.size;

      patch.messagesCount = chatLogRepo.countBetween(sinceMs, endedAt);
    }

    streamSessionRepo.update(session._id, patch);
    console.log(`[StreamTracker] Stream ended: "${session.title}" (${session.streamId})`);
  } catch (error) {
    console.error('[StreamTracker] Error ending session:', error.message);
  }

  if (_activeSession && _activeSession._id === session._id) {
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
        const updated = streamSessionRepo.update(session._id, {
          title: streamData.title || session.title,
          gameName: streamData.game_name || session.gameName,
          lastSeenAt: new Date(),
        });
        if (updated) {
          _activeSession = updated;
          session = updated;
        }
      }

      // Пиковый/средний онлайн берём из надёжного Streams API (viewer_count).
      // Раньше счётчик шёл из chat/chatters, но тот эндпоинт требует
      // user-access токена со скоупом moderator:read:chatters и часто отдаёт
      // пустой список — из-за чего max/avgviewers не сохранялись.
      if (session && streamData.viewer_count !== undefined && streamData.viewer_count !== null) {
        try {
          streamSessionRepo.applyViewerUpdate(session._id, Number(streamData.viewer_count) || 0);
        } catch (error) {
          console.error('[StreamTracker] Error applying viewer update:', error.message);
        }
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

/**
 * Возвращает id активной сессии стрима (для привязки chatLog), либо null.
 */
async function linkMessageToStream() {
  const session = await getActiveSession();
  return session ? session._id : null;
}

/**
 * Привязывает снапшот зрителей к активной сессии и обновляет её статистику
 * зрителей (макс/среднее/счётчик). Возвращает id сессии или null.
 * currentCount — число зрителей в снапшоте.
 */
async function linkViewerSnapshotToStream(currentCount) {
  const session = await getActiveSession();

  if (session) {
    streamSessionRepo.applyViewerUpdate(session._id, currentCount);
    return session._id;
  }

  return null;
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
