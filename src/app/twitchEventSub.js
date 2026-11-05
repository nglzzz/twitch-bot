const WebSocket = require('ws');
const axios = require('axios');
const config = require('../config');
const Chat = require('./chat');
const { updateRedemptionStatus } = require('../twitchApi/rewardRedemptions');
const { getTwitchAccessToken } = require('../services/token.service');
const { isDbReady } = require('./db');
const communityRepo = require('../repositories/community.repo');
const communityContributionsRepo = require('../repositories/communityContributions.repo');

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const SUBSCRIBE_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';
const TOKEN_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const FOLLOW_READ_SCOPE = 'moderator:read:followers';
const SUBSCRIPTION_READ_SCOPE = 'channel:read:subscriptions';
const TOKEN_VALIDATE_TIMEOUT_MS = 10000;

const REWARD_HANDLERS = {};
let followSetupWarningLogged = false;
let paidSubscriptionSetupWarningLogged = false;

// Active WebSocket connection — the one currently eligible to receive
// notifications and whose session_id is used for subscriptions.
let ws = null;

// Pending Twitch reconnect socket.  Created in response to a
// session_reconnect message.  Promoted to ``ws`` once its
// session_welcome is received, at which point the old connection is
// closed.  This two-socket approach is required because Twitch only
// migrates subscriptions while the old connection is still alive.
let reconnectSocket = null;

let sessionId = null;
let reconnectUrl = null;

// Set to true when the active connection dies while a Twitch reconnect
// socket is pending.  If the old connection closes before the new
// session_welcome arrives, Twitch may NOT have migrated subscriptions —
// so we must explicitly re-subscribe rather than assuming migration.
let activeSocketClosedDuringReconnect = false;

// Keepalive watchdog — Twitch sends keepalive every ~10 seconds.
// If no message arrives within this timeout the connection is
// considered dead and we force a reconnect.
const KEEPALIVE_TIMEOUT_MS = 30000;
const RECONNECT_DELAY_MS = 5000;
// Max time to wait for session_welcome on a Twitch reconnect socket.
// If it doesn't arrive, abandon the reconnect and do a fresh connect.
const TWITCH_RECONNECT_TIMEOUT_MS = 15000;
let keepaliveTimer = null;
let reconnectTimer = null;
let reconnectTimeoutTimer = null;

// ---------------------------------------------------------------------------
// Reward handler registry
// ---------------------------------------------------------------------------

/**
 * Register a reward handler for a specific reward ID
 * @param {string} rewardId - Twitch Custom Reward ID
 * @param {function} handler - async function that returns a chat message string
 */
function registerReward(rewardId, handler) {
  REWARD_HANDLERS[rewardId] = handler;
  console.log(`[EventSub] Registered reward handler for: ${rewardId}`);
}

// ---------------------------------------------------------------------------
// Subscription helpers
// ---------------------------------------------------------------------------

/**
 * Subscribe to a Twitch EventSub event type
 */
async function subscribe(type, version, condition, accessToken = null, quietFailure = false) {
  const token = accessToken || await getTwitchAccessToken();

  if (!token) {
    if (!quietFailure) console.error('[EventSub] Twitch access token is not configured');
    return false;
  }

  if (!sessionId) {
    if (!quietFailure) console.error('[EventSub] No session ID available yet');
    return false;
  }

  try {
    const response = await axios.post(SUBSCRIBE_URL, {
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
    const sub = response.data && response.data.data && response.data.data[0];
    console.log(`[EventSub] Subscribed to ${type}: id=${sub ? sub.id : '?'}, status=${sub ? sub.status : '?'}`);
    return true;
  } catch (error) {
    if (!quietFailure) {
      if (error.response) {
        console.error(`[EventSub] Subscription failed for ${type}:`, error.response.status, JSON.stringify(error.response.data));
      } else {
        console.error(`[EventSub] Subscription failed for ${type}:`, error.message);
      }
    }
    return false;
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

  await subscribe(
    'channel.channel_points_custom_reward_redemption.update',
    '1',
    { broadcaster_user_id: config.BROADCASTER_ID }
  );

  let access;
  try {
    const token = await getTwitchAccessToken();
    if (token) {
      const response = await axios.get(TOKEN_VALIDATE_URL, {
        headers: { Authorization: `OAuth ${token}` },
        timeout: TOKEN_VALIDATE_TIMEOUT_MS,
      });
      access = { token, validatedToken: response.data || {} };
    }
  } catch (error) {
    warnFollowSetup('the token could not be validated.', error);
    warnPaidSubscriptionSetup('the token could not be validated.', error);
    return;
  }
  if (!access) {
    warnFollowSetup('the Twitch access token is not configured.');
    warnPaidSubscriptionSetup('the Twitch access token is not configured.');
    return;
  }

  await subscribeToFollows(access);
  await subscribeToPaidSubscriptions(access);
}

function warnFollowSetup(message, error = null) {
  if (followSetupWarningLogged) return;
  followSetupWarningLogged = true;
  if (error) {
    console.warn(`[EventSub] Follow achievements are unavailable: ${message}`, error.message);
    return;
  }
  console.warn(`[EventSub] Follow achievements are unavailable: ${message}`);
}

async function subscribeToFollows({ token, validatedToken }) {
  if (!sessionId || !config.BROADCASTER_ID) return;
  const scopes = new Set(Array.isArray(validatedToken.scopes) ? validatedToken.scopes : []);
  const moderatorUserId = String(validatedToken.user_id || '').trim();

  if (String(validatedToken.client_id || '') !== String(config.TWITCH_API_CLIENT_ID || '')) {
    warnFollowSetup('the validated token belongs to a different Twitch application.');
    return;
  }
  if (!moderatorUserId) {
    warnFollowSetup('the token has no user identity; a user token is required.');
    return;
  }
  if (!scopes.has(FOLLOW_READ_SCOPE)) {
    warnFollowSetup(`the token needs the ${FOLLOW_READ_SCOPE} scope.`);
    return;
  }

  const subscribed = await subscribe(
    'channel.follow',
    '2',
    {
      broadcaster_user_id: String(config.BROADCASTER_ID),
      moderator_user_id: moderatorUserId,
    },
    token,
    true
  );
  if (!subscribed) {
    warnFollowSetup('Twitch rejected the subscription; check that the token owner can moderate this channel.');
  }
}

function warnPaidSubscriptionSetup(message, error = null) {
  if (paidSubscriptionSetupWarningLogged) return;
  paidSubscriptionSetupWarningLogged = true;
  if (error) {
    console.warn(`[EventSub] Paid subscription achievements are unavailable: ${message}`, error.message);
    return;
  }
  console.warn(`[EventSub] Paid subscription achievements are unavailable: ${message}`);
}

async function subscribeToPaidSubscriptions({ token, validatedToken }) {
  if (!sessionId || !config.BROADCASTER_ID) return;
  const scopes = new Set(Array.isArray(validatedToken.scopes) ? validatedToken.scopes : []);

  if (String(validatedToken.client_id || '') !== String(config.TWITCH_API_CLIENT_ID || '')) {
    warnPaidSubscriptionSetup('the validated token belongs to a different Twitch application.');
    return;
  }
  if (String(validatedToken.user_id || '') !== String(config.BROADCASTER_ID)) {
    warnPaidSubscriptionSetup('the token must belong to the broadcaster.');
    return;
  }
  if (!scopes.has(SUBSCRIPTION_READ_SCOPE)) {
    warnPaidSubscriptionSetup(`the token needs the ${SUBSCRIPTION_READ_SCOPE} scope.`);
    return;
  }

  const subscribed = await subscribe(
    'channel.subscribe',
    '1',
    { broadcaster_user_id: String(config.BROADCASTER_ID) },
    token,
    true
  );
  if (!subscribed) warnPaidSubscriptionSetup('Twitch rejected the subscription.');
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
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      // terminate() triggers the 'close' event which handles reconnection
      ws.terminate();
    } else if (reconnectSocket && (reconnectSocket.readyState === WebSocket.OPEN || reconnectSocket.readyState === WebSocket.CONNECTING)) {
      // Active connection already gone but reconnect socket is stuck
      console.warn('[EventSub] Reconnect socket appears stuck — terminating');
      reconnectSocket.terminate();
    } else {
      // No active connection — clean up and reconnect directly
      _closeSocket(reconnectSocket);
      reconnectSocket = null;
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

/**
 * Start a timeout for the Twitch reconnect socket to receive
 * session_welcome.  If it doesn't arrive in time, abandon the reconnect
 * attempt and perform a fresh connect to re-establish subscriptions.
 */
function _startReconnectTimeout() {
  _clearReconnectTimeout();
  reconnectTimeoutTimer = setTimeout(() => {
    reconnectTimeoutTimer = null;
    console.warn(`[EventSub] Twitch reconnect did not complete within ${TWITCH_RECONNECT_TIMEOUT_MS}ms — abandoning, doing fresh connect`);
    activeSocketClosedDuringReconnect = true;
    // Terminate the reconnect socket (its close handler will deal with cleanup)
    if (reconnectSocket) {
      const stuck = reconnectSocket;
      reconnectSocket = null;
      _closeSocket(stuck);
    }
    // Force a fresh connect
    connect();
  }, TWITCH_RECONNECT_TIMEOUT_MS);
}

/**
 * Clear the Twitch reconnect timeout timer.
 */
function _clearReconnectTimeout() {
  if (reconnectTimeoutTimer) {
    clearTimeout(reconnectTimeoutTimer);
    reconnectTimeoutTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

/**
 * Handle incoming EventSub messages.
 * @param {WebSocket} socket - the socket this message arrived on
 * @param {object} data - parsed JSON message
 */
function handleMessage(socket, data) {
  const { metadata, payload } = data;

  if (!metadata) return;

  // Every message resets the keepalive watchdog — must happen before any
  // early return so the watchdog always tracks connection liveness
  resetKeepaliveTimer();

  if (!payload) return;

  switch (metadata.message_type) {
    case 'session_welcome': {
      handleSessionWelcome(socket, payload);
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
      handleSessionReconnect(payload);
      break;
    }

    case 'revocation': {
      handleRevocation(payload);
      break;
    }

    default: {
      console.log('[EventSub] Unknown message type:', metadata.message_type);
    }
  }
}

/**
 * Handle session_welcome — either a fresh connection or a Twitch
 * reconnect migration.
 */
function handleSessionWelcome(socket, payload) {
  // Guard against stale session_welcome from a socket that is no longer
  // the one we're tracking (e.g. after _doFreshConnect replaced it).
  if (socket._isTwitchReconnect && socket !== reconnectSocket) {
    console.warn('[EventSub] Ignoring session_welcome from stale reconnect socket');
    return;
  }
  if (!socket._isTwitchReconnect && socket !== ws) {
    console.warn('[EventSub] Ignoring session_welcome from stale fresh socket');
    return;
  }

  sessionId = payload.session && payload.session.id;
  socket._welcomeReceived = true;

  // Reconnect timeout no longer needed — welcome arrived
  _clearReconnectTimeout();

  if (socket._isTwitchReconnect) {
    if (activeSocketClosedDuringReconnect) {
      // The old active connection died before this welcome arrived,
      // so Twitch may NOT have migrated subscriptions.  Treat this as
      // a fresh session and explicitly re-subscribe.
      console.warn('[EventSub] Reconnect session established, ID:', sessionId, '— but old connection was already closed, re-subscribing explicitly');
      activeSocketClosedDuringReconnect = false;
      ws = socket;
      reconnectSocket = null;
      reconnectUrl = null;
      resetKeepaliveTimer();
      subscribeAll();
    } else {
      // Normal Twitch reconnect: subscriptions migrated automatically.
      console.log('[EventSub] Reconnect session established, ID:', sessionId, '— subscriptions migrated automatically');

      // Close the old active connection (listeners already removed by
      // _closeSocket so its close handler will not fire).
      if (ws && ws !== socket) {
        _closeSocket(ws);
      }

      // Promote reconnect socket to active
      ws = socket;
      reconnectSocket = null;
      reconnectUrl = null;
      resetKeepaliveTimer();
    }
  } else {
    // Fresh connection — subscribe to all needed events
    console.log('[EventSub] Fresh session established, ID:', sessionId);
    activeSocketClosedDuringReconnect = false;
    ws = socket;
    subscribeAll();
  }
}

/**
 * Handle Twitch session_reconnect — open a new WebSocket to the
 * reconnect URL WITHOUT closing the current connection.
 */
function handleSessionReconnect(payload) {
  const newUrl = payload.session && payload.session.reconnect_url;
  console.log('[EventSub] Twitch reconnect requested, new URL:', newUrl);

  if (reconnectSocket) {
    console.warn('[EventSub] Reconnect already in progress — ignoring new request');
    return;
  }

  if (!newUrl) {
    console.warn('[EventSub] No reconnect URL provided — will rely on keepalive watchdog');
    return;
  }

  reconnectUrl = newUrl;

  // Create the reconnect socket — the old ``ws`` stays alive until
  // session_welcome is received on the new socket (see handleSessionWelcome).
  reconnectSocket = _createSocket(reconnectUrl, { isTwitchReconnect: true });

  // Start a safety timeout — if session_welcome doesn't arrive in time,
  // we abandon the reconnect and do a fresh connect to re-subscribe.
  _startReconnectTimeout();
}

/**
 * Handle revocation — Twitch has revoked one of our subscriptions.
 * Force a fresh reconnect to re-establish all subscriptions.
 */
function handleRevocation(payload) {
  console.warn('[EventSub] Subscription revoked:', JSON.stringify(payload));

  // Clean up any pending reconnect
  _clearReconnectTimeout();
  reconnectUrl = null;
  _closeSocket(reconnectSocket);
  reconnectSocket = null;

  // Force close the active connection to trigger a fresh reconnect
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.terminate();
  } else {
    ws = null;
    sessionId = null;
    clearKeepaliveTimer();
    scheduleReconnect();
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

    case 'channel.channel_points_custom_reward_redemption.update': {
      handleRedemptionUpdate(event);
      break;
    }

    case 'channel.follow': {
      handleFollow(event);
      break;
    }

    case 'channel.subscribe': {
      handlePaidSubscription(event);
      break;
    }

    default: {
      console.log('[EventSub] Unhandled subscription type:', subscription.type);
    }
  }
}

function handlePaidSubscription(event) {
  if (!config.BROADCASTER_ID || !event.broadcaster_user_id
      || String(event.broadcaster_user_id) !== String(config.BROADCASTER_ID)) {
    return;
  }
  if (!isDbReady()) return;

  try {
    require('../repositories/communityPaidSubscriptions.repo').recordTwitchSubscription({
      userId: event.user_id,
      username: event.user_login,
      displayName: event.user_name,
    });
  } catch (error) {
    console.error('[EventSub] Could not record Twitch paid subscription:', error.message);
  }
}

function handleFollow(event) {
  if (!config.BROADCASTER_ID || !event.broadcaster_user_id
      || String(event.broadcaster_user_id) !== String(config.BROADCASTER_ID)) {
    return;
  }
  if (!isDbReady()) return;

  try {
    communityRepo.recordFollow({
      userId: event.user_id,
      username: event.user_login,
      displayName: event.user_name,
      followedAt: event.followed_at || Date.now(),
    });
  } catch (error) {
    console.error('[EventSub] Could not record channel follow:', error.message);
  }
}

/**
 * Handle channel points redemption event
 */
function handleRedemption(event) {
  const redemption = persistRedemptionEvent(event, 'unfulfilled');
  if (!redemption) return Promise.resolve();

  const rewardId = String(event.reward.id);
  const handler = REWARD_HANDLERS[rewardId];
  const rewardTitle = event.reward.title || '?';
  const userName = event.user_name || event.user_login || event.user_id;
  const redemptionId = String(event.id);

  if (!handler) {
    const registeredIds = Object.keys(REWARD_HANDLERS);
    console.warn(
      `[EventSub] Recorded redemption for reward "${rewardTitle}" (ID: ${rewardId}) without a handler. ` +
      `Registered IDs: [${registeredIds.join(', ')}]`
    );
    return Promise.resolve();
  }

  if (redemption.status !== 'unfulfilled') {
    return Promise.resolve();
  }

  let claimed;
  try {
    claimed = communityContributionsRepo.claimRedemption(redemptionId);
  } catch (error) {
    console.error('[EventSub] Could not claim redemption before running its handler:', error.message);
    return Promise.resolve();
  }
  if (!claimed) return Promise.resolve();

  console.log(`[EventSub] Reward redeemed: "${rewardTitle}" by ${userName}`);

  return Promise.resolve()
    .then(() => handler())
    .then(async (resultMessage) => {
      try {
        await updateRedemptionStatus({
          broadcasterId: config.BROADCASTER_ID,
          rewardId,
          redemptionId,
          status: 'FULFILLED',
        });
        persistRedemptionStatus(redemptionId, 'fulfilled');
      } catch (patchError) {
        // The handler already ran; leave the ledger pending until Twitch confirms a status update.
        console.error('[EventSub] Reward succeeded but failed to mark as FULFILLED:', patchError.message);
      }

      if (resultMessage) {
        try {
          Chat.handleMessageResult(resultMessage, '#' + config.CHANNEL);
        } catch (chatError) {
          console.error('[EventSub] Could not send reward result to chat:', chatError.message);
        }
      }
    }, async (error) => {
      console.error(`[EventSub] Reward handler failed for "${rewardTitle}" by ${userName}:`, error.message);

      try {
        await updateRedemptionStatus({
          broadcasterId: config.BROADCASTER_ID,
          rewardId,
          redemptionId,
          status: 'CANCELED',
        });
        persistRedemptionStatus(redemptionId, 'canceled');
        console.log(`[EventSub] Redemption ${redemptionId} canceled, points refunded to ${userName}`);
      } catch (cancelError) {
        console.error('[EventSub] Failed to cancel redemption:', cancelError.message);
      }
    });
}

/**
 * Store a redemption status notification without executing its reward handler.
 */
function handleRedemptionUpdate(event) {
  persistRedemptionEvent(event, 'unfulfilled');
}

function persistRedemptionEvent(event, fallbackStatus) {
  if (!config.BROADCASTER_ID || !event.broadcaster_user_id
      || String(event.broadcaster_user_id) !== String(config.BROADCASTER_ID)) {
    return null;
  }
  if (!isDbReady()) {
    console.warn('[EventSub] Cannot record channel points redemption while SQLite is unavailable.');
    return null;
  }

  const reward = event.reward || {};
  const cost = Number(reward.cost);
  const redemptionId = String(event.id || '').trim();
  const userId = String(event.user_id || '').trim();
  const rewardId = String(reward.id || '').trim();
  if (!redemptionId || !userId || !rewardId || !Number.isSafeInteger(cost) || cost < 0) {
    console.warn('[EventSub] Ignored invalid channel points redemption payload.');
    return null;
  }

  const username = String(event.user_login || event.user_name || userId).trim();
  const displayName = String(event.user_name || event.user_login || userId).trim();
  const status = normalizeRedemptionStatus(event.status) || fallbackStatus;

  try {
    const recorded = communityContributionsRepo.recordRedemption({
      id: redemptionId,
      userId,
      username,
      displayName,
      cost,
      rewardId,
      status,
      redeemedAt: event.redeemed_at || Date.now(),
    });
    if (!recorded) {
      console.error(`[EventSub] Could not persist redemption ${redemptionId}.`);
      return null;
    }
    return {
      ...recorded,
      id: recorded.id || redemptionId,
      status: normalizeRedemptionStatus(recorded.status) || 'unknown',
    };
  } catch (error) {
    console.error(`[EventSub] Could not persist redemption ${redemptionId}:`, error.message);
    return null;
  }
}

function normalizeRedemptionStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'cancelled') return 'canceled';
  return ['unfulfilled', 'fulfilled', 'canceled'].includes(normalized) ? normalized : null;
}

function persistRedemptionStatus(redemptionId, status) {
  try {
    communityContributionsRepo.setRedemptionStatus(redemptionId, status);
  } catch (error) {
    console.error(`[EventSub] Could not persist redemption ${redemptionId} status:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

/**
 * Silently close a WebSocket — remove all listeners first so that the
 * 'close' event does not trigger reconnect logic.
 */
function _closeSocket(socket) {
  if (!socket) return;
  try {
    socket.removeAllListeners();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Create a new WebSocket connection and attach all event handlers.
 *
 * @param {string} url - WebSocket URL to connect to
 * @param {object} [options]
 * @param {boolean} [options.isTwitchReconnect=false] - if true, this is a
 *        Twitch-initiated reconnect socket; subscriptions will be migrated
 *        and subscribeAll() should NOT be called on session_welcome.
 * @returns {WebSocket}
 */
function _createSocket(url, options) {
  options = options || {};
  const isTwitchReconnect = options.isTwitchReconnect === true;

  console.log('[EventSub] Connecting to', url, isTwitchReconnect ? '(Twitch reconnect)' : '(fresh)');

  const socket = new WebSocket(url);
  socket._isTwitchReconnect = isTwitchReconnect;
  socket._welcomeReceived = false;

  socket.on('open', () => {
    console.log('[EventSub] WebSocket connected', isTwitchReconnect ? '(reconnect socket)' : '');
    resetKeepaliveTimer();
  });

  socket.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      handleMessage(socket, data);
    } catch (e) {
      console.error('[EventSub] Failed to parse message:', e.message);
    }
  });

  // Twitch sends WebSocket-level ping frames; treat them as keepalive
  socket.on('ping', () => {
    resetKeepaliveTimer();
  });

  socket.on('pong', () => {
    resetKeepaliveTimer();
  });

  socket.on('close', (code, reason) => {
    const reasonStr = reason ? reason.toString() : '';
    console.log(`[EventSub] WebSocket closed: ${code} ${reasonStr}`.trim());

    // ------------------------------------------------------------------
    // Case 1: the pending reconnect socket closed
    // ------------------------------------------------------------------
    if (socket === reconnectSocket) {
      reconnectSocket = null;
      _clearReconnectTimeout();

      if (!socket._welcomeReceived) {
        console.warn('[EventSub] Reconnect socket closed before session_welcome');
        // If the active connection is also dead, we need a fresh reconnect
        if (!ws) {
          reconnectUrl = null;
          clearKeepaliveTimer();
          scheduleReconnect();
        }
      }
      // If welcome was received, the socket was already promoted to ws and
      // reconnectSocket was cleared — this close is from the old reference.
      return;
    }

    // ------------------------------------------------------------------
    // Case 2: the active connection closed
    // ------------------------------------------------------------------
    if (socket === ws) {
      ws = null;
      sessionId = null;
      clearKeepaliveTimer();

      // If a Twitch reconnect is in progress, wait for it rather than
      // starting a competing fresh connection.
      if (reconnectSocket) {
        console.log('[EventSub] Active connection closed but Twitch reconnect in progress — waiting for reconnect socket');
        // Mark that the old connection died before welcome arrived —
        // if the new socket's welcome comes, we must re-subscribe explicitly.
        activeSocketClosedDuringReconnect = true;
        return;
      }

      reconnectUrl = null;
      scheduleReconnect();
      return;
    }

    // ------------------------------------------------------------------
    // Case 3: old or unknown socket — ignore
    // ------------------------------------------------------------------
    // This happens when the old connection (replaced during a successful
    // reconnect) finally closes after we already removed its listeners.
    console.log('[EventSub] Close event from non-active socket — ignoring');
  });

  socket.on('error', (error) => {
    console.error('[EventSub] WebSocket error:', error.message);
  });

  // Start the keepalive watchdog immediately so that a socket stuck in
  // CONNECTING will eventually be cleaned up.
  resetKeepaliveTimer();

  return socket;
}

/**
 * Connect to EventSub WebSocket (fresh connection).
 * After session_welcome, subscribeAll() will be called automatically.
 */
async function connect(url) {
  let token;
  try {
    token = await getTwitchAccessToken();
  } catch (error) {
    console.error('[EventSub] Cannot resolve Twitch access token:', error.message);
    return;
  }

  if (!token) {
    console.error('[EventSub] Cannot connect: Twitch access token is not configured');
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

  _doFreshConnect(url);
}

/**
 * Internal: perform a fresh connection, cleaning up any existing sockets.
 */
function _doFreshConnect(url) {
  url = url || EVENTSUB_URL;

  // Clean up ALL existing connections (active + pending reconnect)
  _closeSocket(ws);
  _closeSocket(reconnectSocket);
  ws = null;
  reconnectSocket = null;
  reconnectUrl = null;

  // Clear stale timers from previous connection
  clearKeepaliveTimer();
  _clearReconnectTimeout();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Reset reconnect state
  activeSocketClosedDuringReconnect = false;

  ws = _createSocket(url, { isTwitchReconnect: false });
}

module.exports = { registerReward, connect };
