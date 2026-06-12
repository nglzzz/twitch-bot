const axios = require('axios');
const config = require('../config');
const db = require('../app/db');
const MemeLog = require('../models/memeLog.model');
const { getActiveSession } = require('./streamTracker.service');

const MEMEALERTS_HOST = config.MEMEALERTS_HOST || 'memealerts.com';
const MEMEALERTS_API_URL = 'https://' + MEMEALERTS_HOST + '/api/event';
const POLL_INTERVAL_MS = (parseInt(config.MEMEALERTS_POLL_INTERVAL, 10) || 2) * 60 * 1000; // default 2 min

let _pollTimer = null;
let _lastSeenEventId = null;

function isDbReady() {
  return db?.connection?.readyState === 1;
}

function buildRequestHeaders() {
  return {
    accept: '*/*',
    authorization: 'Bearer ' + config.MEMEALERTS_JWT,
    'content-type': 'application/json',
    origin: 'https://memealerts.com',
    referer: 'https://memealerts.com/dashboard',
  };
}

async function fetchMemeEvents() {
  const response = await axios.post(
    MEMEALERTS_API_URL,
    {
      limit: 100,
      filters: [0, 1, 2, 3, 4, 5, 6, 7, 9],
    },
    { headers: buildRequestHeaders() }
  );

  const events = Array.isArray(response.data)
    ? response.data
    : (response.data.data || []);

  return events;
}

function isMemeEvent(event) {
  return event && event.kind === 'sticker-sent' && !event.isHidden;
}

function buildEventId(event) {
  // Use event id if available, otherwise build a composite key
  if (event.id) {
    return String(event.id);
  }

  const parts = [
    event.userAlias || event.user || '',
    event.stickerName || '',
    event.date || event.createdAt || '',
  ].filter(Boolean).join('_');

  return parts || null;
}

async function saveNewMemes(events) {
  if (!isDbReady() || !events || events.length === 0) {
    return 0;
  }

  const session = await getActiveSession();
  let saved = 0;

  for (const event of events) {
    if (!isMemeEvent(event)) {
      continue;
    }

    const eventId = buildEventId(event);

    if (!eventId) {
      continue;
    }

    try {
      const exists = await MemeLog.findOne({ eventId }).lean();

      if (exists) {
        continue;
      }

      const memeEntry = new MemeLog({
        eventId,
        user: (event.user || '').toLowerCase(),
        userAlias: event.userAlias || event.user || '',
        stickerName: event.stickerName || '',
        kind: event.kind,
        sentAt: event.date ? new Date(event.date) : new Date(),
        streamSessionId: session ? session._id : null,
        raw: event,
      });

      await memeEntry.save();
      saved += 1;

      // Update stream meme count
      if (session) {
        session.memesCount = (session.memesCount || 0) + 1;
      }
    } catch (error) {
      if (error.code !== 11000) { // Ignore duplicate key errors
        console.error('[MemeAlerts] Error saving meme:', error.message);
      }
    }
  }

  // Save updated session once
  if (session && saved > 0) {
    try {
      await session.save();
    } catch (error) {
      console.error('[MemeAlerts] Error updating session meme count:', error.message);
    }
  }

  return saved;
}

async function pollMemeAlerts() {
  if (!isDbReady() || !config.MEMEALERTS_JWT) {
    return;
  }

  try {
    const events = await fetchMemeEvents();
    const memeEvents = events.filter(isMemeEvent);

    if (memeEvents.length === 0) {
      return;
    }

    // Track the latest event ID for quick skip
    const latestId = buildEventId(memeEvents[0]);

    if (_lastSeenEventId && latestId === _lastSeenEventId) {
      return; // No new memes
    }

    const saved = await saveNewMemes(memeEvents);

    if (saved > 0) {
      console.log(`[MemeAlerts] Saved ${saved} new meme(s)`);
    }

    _lastSeenEventId = latestId;
  } catch (error) {
    console.error('[MemeAlerts] Poll error:', error.message);
  }
}

function startPolling(intervalMs) {
  const interval = intervalMs || POLL_INTERVAL_MS;

  if (_pollTimer) {
    clearInterval(_pollTimer);
  }

  // Don't poll if no JWT configured
  if (!config.MEMEALERTS_JWT) {
    console.log('[MemeAlerts] No JWT configured, skipping meme polling');
    return;
  }

  // Poll immediately on start
  pollMemeAlerts();

  _pollTimer = setInterval(pollMemeAlerts, interval);
  console.log(`[MemeAlerts] Started polling every ${Math.round(interval / 1000)}s`);
}

function stopPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
    console.log('[MemeAlerts] Stopped polling');
  }
}

module.exports = {
  fetchMemeEvents,
  pollMemeAlerts,
  startPolling,
  stopPolling,
};
