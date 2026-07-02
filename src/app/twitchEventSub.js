const WebSocket = require('ws');
const axios = require('axios');
const config = require('../config');
const Chat = require('./chat');
const { updateRedemptionStatus } = require('../twitchApi/rewardRedemptions');

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const SUBSCRIBE_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';

const REWARD_HANDLERS = {};

let ws = null;
let sessionId = null;
let reconnectUrl = null;
let reconnecting = false;

// Keepalive watchdog — Twitch sends keepalive every ~10 seconds.
// If no message arrives within this timeout the connection is
// considered dead and we force a reconnect.
const KEEPALIVE_TIMEOUT_MS = 30000;
const RECONNECT_DELAY_MS = 5000;
let keepaliveTimer = null;
let reconnectTimer = null;

/**
 * Register a reward handler for a specific reward ID
 * @param {string} rewardId - Twitch Custom Reward ID
 * @param {function} handler - async function that returns a chat message string
 */
function registerReward(rewardId, handler) {
  REWARD_HANDLERS[rewardId] = handler;
  console.log(`[EventSub] Registered reward handler for: ${rewardId}`);
}

/**
 * Subscribe to a Twitch EventSub event type
 */
async function subscribe(type, version, condition) {
  const token = config.TWITCH_ACCESS_TOKEN;

  if (!token) {
    console.error('[EventSub] TWITCH_ACCESS_TOKEN is not set in config');
    return;
  }

  if (!sessionId) {
    console.error('[EventSub] No session ID available yet');
    return;
  }

  try {
    await axios.post(SUBSCRIBE_URL, {
      type,
      version,
      condition,
      transport: {
        method: 'websocket',
        session_id: sessionId
      }
    }, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Client-Id': config.TWITCH_API_CLIENT_ID,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[EventSub] Subscribed to ${type}`);
  } catch (error) {
    if (error.response) {
      console.error(`[EventSub] Subscription failed for ${type}:`, error.response.status, JSON.stringify(error.response.data));
    } else {
      console.error(`[EventSub] Subscription failed for ${type}:`, error.message);
    }
  }
}

/**
 * Subscribe to all needed events
 */
async function subscribeAll() {
  if (!config.BROADCASTER_ID) {
    console.error('[EventSub] BROADCASTER_ID is not set');
    return;
  }

  await subscribe(
    'channel.channel_points_custom_reward_redemption.add',
    '1',
    { broadcaster_user_id: config.BROADCASTER_ID }
  );
}

// ---------------------------------------------------------------------------
// Keepalive watchdog & timer helpers
// ---------------------------------------------------------------------------

/**
 * Reset the keepalive watchdog timer.
 * Called on every incoming message (keepalive, notification, etc.).
 * If the timer fires it means no message was received within the timeout
 * period, so the connection is likely silently dead.
 */
function resetKeepaliveTimer() {
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
  }
  keepaliveTimer = setTimeout(() => {
    console.warn(`[EventSub] No message received within ${KEEPALIVE_TIMEOUT_MS}ms — connection appears dead, forcing reconnect`);
    // terminate() triggers the 'close' event which handles reconnection
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.terminate();
    } else {
      // Connection not open — reconnect directly
      reconnecting = false;
      reconnectUrl = null;
      scheduleReconnect();
    }
  }, KEEPALIVE_TIMEOUT_MS);
}

/**
 * Clear the keepalive watchdog timer
 */
function clearKeepaliveTimer() {
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  }
}

/**
 * Schedule a reconnection attempt after RECONNECT_DELAY_MS.
 * Safe to call multiple times — only one timer is active.
 */
function scheduleReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

/**
 * Handle incoming EventSub messages
 */
function handleMessage(data) {
  const { metadata, payload } = data;

  if (!metadata) return;

  // Every message resets the keepalive watchdog — must happen before any
  // early return so the watchdog always tracks connection liveness
  resetKeepaliveTimer();

  if (!payload) return;

  switch (metadata.message_type) {
    case 'session_welcome': {
      sessionId = payload.session.id;
      console.log('[EventSub] Session established, ID:', sessionId);

      // During a Twitch-initiated session_reconnect, subscriptions are
      // automatically migrated to the new connection — do NOT re-subscribe.
      // Only subscribe on a fresh (non-reconnect) connection.
      if (reconnecting) {
        console.log('[EventSub] Reconnect complete — subscriptions migrated automatically');
        reconnecting = false;
        reconnectUrl = null;
      } else {
        subscribeAll();
      }
      break;
    }

    case 'session_keepalive': {
      // Keepalive — watchdog already reset above
      break;
    }

    case 'notification': {
      handleNotification(payload);
      break;
    }

    case 'session_reconnect': {
      reconnectUrl = payload.session.reconnect_url;
      console.log('[EventSub] Reconnect requested, new URL:', reconnectUrl);
      handleReconnect();
      break;
    }

    case 'revocation': {
      console.warn('[EventSub] Subscription revoked:', JSON.stringify(payload));
      break;
    }

    default: {
      console.log('[EventSub] Unknown message type:', metadata.message_type);
    }
  }
}

/**
 * Handle notification payload
 */
function handleNotification(payload) {
  const { subscription, event } = payload;

  if (!subscription || !event) return;

  switch (subscription.type) {
    case 'channel.channel_points_custom_reward_redemption.add': {
      handleRedemption(event);
      break;
    }

    default: {
      console.log('[EventSub] Unhandled subscription type:', subscription.type);
    }
  }
}

/**
 * Handle channel points redemption event
 */
function handleRedemption(event) {
  const rewardId = event.reward.id;
  const handler = REWARD_HANDLERS[rewardId];

  if (!handler) {
    console.warn(`[EventSub] Ignored redemption for reward "${event.reward.title}" (ID: ${rewardId}): no handler registered`);
    return Promise.resolve();
  }

  const userName = event.user_name;
  const redemptionId = event.id;
  const broadcasterId = config.BROADCASTER_ID;

  console.log(`[EventSub] Reward redeemed: "${event.reward.title}" by ${userName}`);

  return handler()
    .then(async resultMessage => {
      // Handler succeeded — mark redemption as FULFILLED
      try {
        await updateRedemptionStatus({
          broadcasterId,
          rewardId,
          redemptionId,
          status: 'FULFILLED'
        });
      } catch (patchError) {
        // Reward already executed successfully, only log the status update failure
        console.error('[EventSub] Reward succeeded but failed to mark as FULFILLED:', patchError.message);
      }

      if (resultMessage) {
        Chat.handleMessageResult(resultMessage, '#' + config.CHANNEL);
      }
    })
    .catch(async error => {
      // Handler failed — cancel redemption to refund channel points
      console.error(`[EventSub] Reward handler failed for "${event.reward.title}" by ${userName}:`, error.message);

      try {
        await updateRedemptionStatus({
          broadcasterId,
          rewardId,
          redemptionId,
          status: 'CANCELED'
        });
        console.log(`[EventSub] Redemption ${redemptionId} canceled, points refunded to ${userName}`);
      } catch (cancelError) {
        console.error('[EventSub] Failed to cancel redemption:', cancelError.message);
      }
    });
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

/**
 * Handle reconnect — connect to new URL before old connection closes
 */
function handleReconnect() {
  if (reconnecting) return;
  reconnecting = true;

  connect(reconnectUrl);
}

/**
 * Connect to EventSub WebSocket
 */
function connect(url) {
  if (!config.TWITCH_ACCESS_TOKEN) {
    console.error('[EventSub] Cannot connect: TWITCH_ACCESS_TOKEN is not set');
    return;
  }
  if (!config.TWITCH_API_CLIENT_ID) {
    console.error('[EventSub] Cannot connect: TWITCH_API_CLIENT_ID is not set');
    return;
  }
  if (!config.BROADCASTER_ID) {
    console.error('[EventSub] Cannot connect: BROADCASTER_ID is not set');
    return;
  }

  _doConnect(url);
}

/**
 * Internal connect implementation
 */
function _doConnect(url) {
  url = url || EVENTSUB_URL;

  // Clean up any existing connection
  if (ws) {
    try {
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    } catch (e) {
      // ignore
    }
  }

  // Clear stale timers from previous connection
  clearKeepaliveTimer();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log('[EventSub] Connecting to', url);

  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[EventSub] WebSocket connected');
    resetKeepaliveTimer();
    // Note: reconnecting flag is reset in session_welcome handler,
    // not here — we need it to distinguish reconnect from fresh connect.
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      handleMessage(data);
    } catch (e) {
      console.error('[EventSub] Failed to parse message:', e.message);
    }
  });

  // Twitch sends WebSocket-level ping frames; treat them as keepalive
  ws.on('ping', () => {
    resetKeepaliveTimer();
  });

  ws.on('pong', () => {
    resetKeepaliveTimer();
  });

  ws.on('close', (code, reason) => {
    console.log(`[EventSub] WebSocket closed: ${code} ${reason}`);
    clearKeepaliveTimer();
    sessionId = null;

    // Always schedule a reconnect on close.
    //
    // The reconnecting flag is only set during a session_reconnect flow to
    // prevent handleReconnect() from spawning duplicate connections. Even if
    // a session_reconnect's new connection fails, we must still reconnect to
    // the main EventSub URL.
    reconnecting = false;
    reconnectUrl = null;

    scheduleReconnect();
  });

  ws.on('error', (error) => {
    console.error('[EventSub] WebSocket error:', error.message);
  });
}

module.exports = { registerReward, connect };
