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

/**
 * Handle incoming EventSub messages
 */
function handleMessage(data) {
  const { metadata, payload } = data;

  if (!metadata || !payload) return;

  switch (metadata.message_type) {
    case 'session_welcome': {
      sessionId = payload.session.id;
      console.log('[EventSub] Session established, ID:', sessionId);
      subscribeAll();
      break;
    }

    case 'session_keepalive': {
      // keepalive, nothing to do
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
  console.log('handle notification: ');
  console.log(payload);

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

  if (ws) {
    try {
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch (e) {
      // ignore
    }
  }

  console.log('[EventSub] Connecting to', url);

  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[EventSub] WebSocket connected');
    reconnecting = false;
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      handleMessage(data);
    } catch (e) {
      console.error('[EventSub] Failed to parse message:', e.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[EventSub] WebSocket closed: ${code} ${reason}`);
    sessionId = null;

    // reconnect after delay unless reconnecting via session_reconnect
    if (!reconnecting) {
      setTimeout(() => connect(), 5000);
    }
  });

  ws.on('error', (error) => {
    console.error('[EventSub] WebSocket error:', error.message);
  });
}

module.exports = { registerReward, connect };
