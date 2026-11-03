'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const eventSubPath = require.resolve('../src/app/twitchEventSub');
const dependencyPaths = {
  axios: require.resolve('axios'),
  config: require.resolve('../src/config'),
  chat: require.resolve('../src/app/chat'),
  rewardRedemptions: require.resolve('../src/twitchApi/rewardRedemptions'),
  tokenService: require.resolve('../src/services/token.service'),
  db: require.resolve('../src/app/db'),
  communityRepo: require.resolve('../src/repositories/community.repo'),
  contributionsRepo: require.resolve('../src/repositories/communityContributions.repo'),
  websocket: require.resolve('ws'),
};

function loadEventSub(options = {}) {
  const originalEntries = new Map();
  for (const filename of [eventSubPath, ...Object.values(dependencyPaths)]) {
    originalEntries.set(filename, require.cache[filename]);
    delete require.cache[filename];
  }

  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback, delay, ...args) => ({ callback, delay, args });
  global.clearTimeout = () => {};

  const sockets = [];
  const getCalls = [];
  const postCalls = [];
  const recordedFollows = [];
  const followsByUserId = new Map();
  const warnings = [];
  let dbReady = options.dbReady ?? true;

  class FakeWebSocket extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      sockets.push(this);
    }

    terminate() {
      this.readyState = 3;
      this.emit('close', 1000, Buffer.from('test close'));
    }

    sendEvent(messageType, payload) {
      this.emit('message', Buffer.from(JSON.stringify({
        metadata: { message_type: messageType },
        payload,
      })));
    }
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;

  const validatedToken = options.validatedToken || {
    client_id: 'test-client-id',
    user_id: 'moderator-user-id',
    scopes: ['moderator:read:followers'],
  };

  const mockExports = {
    [dependencyPaths.axios]: {
      get: async (...args) => {
        getCalls.push(args);
        if (options.validateError) throw options.validateError;
        return { data: validatedToken };
      },
      post: async (...args) => {
        postCalls.push(args);
        if (options.followSubscriptionError && args[1].type === 'channel.follow') {
          throw options.followSubscriptionError;
        }
        return { data: { data: [{ id: `subscription-${postCalls.length}`, status: 'enabled' }] } };
      },
    },
    [dependencyPaths.config]: {
      CHANNEL: 'test-channel',
      TWITCH_API_CLIENT_ID: 'test-client-id',
      BROADCASTER_ID: 'broadcaster-user-id',
    },
    [dependencyPaths.chat]: { handleMessageResult: () => {} },
    [dependencyPaths.rewardRedemptions]: { updateRedemptionStatus: async () => {} },
    [dependencyPaths.tokenService]: { getTwitchAccessToken: async () => 'test-access-token' },
    [dependencyPaths.db]: { isDbReady: () => dbReady },
    [dependencyPaths.communityRepo]: {
      recordFollow: (follow) => {
        recordedFollows.push(follow);
        if (!followsByUserId.has(follow.userId)) followsByUserId.set(follow.userId, follow);
      },
    },
    [dependencyPaths.contributionsRepo]: {},
    [dependencyPaths.websocket]: FakeWebSocket,
  };

  for (const [filename, exports] of Object.entries(mockExports)) {
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }

  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  const eventSub = require(eventSubPath);

  return {
    eventSub,
    sockets,
    getCalls,
    postCalls,
    recordedFollows,
    followsByUserId,
    warnings,
    setDbReady: (value) => { dbReady = value; },
    restore: () => {
      console.warn = originalWarn;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
      for (const filename of [eventSubPath, ...Object.values(dependencyPaths)]) {
        const original = originalEntries.get(filename);
        if (original) require.cache[filename] = original;
        else delete require.cache[filename];
      }
    },
  };
}

async function startSession(fixture) {
  await fixture.eventSub.connect();
  const socket = fixture.sockets[0];
  assert.ok(socket, 'EventSub should open a WebSocket');
  socket.sendEvent('session_welcome', { session: { id: 'test-session-id' } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return socket;
}

test('follow subscription uses the validated token owner and follower scope', async () => {
  const fixture = loadEventSub();
  try {
    await startSession(fixture);

    assert.equal(fixture.getCalls.length, 1);
    assert.equal(fixture.getCalls[0][0], 'https://id.twitch.tv/oauth2/validate');
    assert.deepEqual(fixture.getCalls[0][1], {
      headers: { Authorization: 'OAuth test-access-token' },
      timeout: 10000,
    });

    const followSubscription = fixture.postCalls.find(([url, body]) => body.type === 'channel.follow');
    assert.ok(followSubscription, 'a channel.follow subscription should be created');
    assert.equal(followSubscription[0], 'https://api.twitch.tv/helix/eventsub/subscriptions');
    assert.deepEqual(followSubscription[1], {
      type: 'channel.follow',
      version: '2',
      condition: {
        broadcaster_user_id: 'broadcaster-user-id',
        moderator_user_id: 'moderator-user-id',
      },
      transport: { method: 'websocket', session_id: 'test-session-id' },
    });
    assert.equal(followSubscription[2].headers.Authorization, 'Bearer test-access-token');
  } finally {
    fixture.restore();
  }
});

test('missing follower scope skips that subscription while reward subscriptions continue', async () => {
  const fixture = loadEventSub({
    validatedToken: {
      client_id: 'test-client-id',
      user_id: 'moderator-user-id',
      scopes: [],
    },
  });
  try {
    const socket = await startSession(fixture);

    assert.equal(fixture.postCalls.length, 2);
    assert.equal(fixture.postCalls[0][1].type, 'channel.channel_points_custom_reward_redemption.add');
    assert.equal(fixture.postCalls[1][1].type, 'channel.channel_points_custom_reward_redemption.update');
    assert.equal(fixture.postCalls.some(([, body]) => body.type === 'channel.follow'), false);
    assert.equal(fixture.warnings.filter((message) => message.includes('moderator:read:followers')).length, 1);

    socket.sendEvent('session_welcome', { session: { id: 'test-session-id-2' } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.warnings.filter((message) => message.includes('moderator:read:followers')).length, 1);
  } finally {
    fixture.restore();
  }
});

test('a rejected follow subscription is logged once and does not disrupt reward setup', async () => {
  const fixture = loadEventSub({ followSubscriptionError: new Error('subscription rejected') });
  try {
    const socket = await startSession(fixture);
    socket.sendEvent('session_welcome', { session: { id: 'test-session-id-2' } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(fixture.postCalls.filter(([, body]) => body.type === 'channel.follow').length, 2);
    assert.equal(fixture.postCalls.filter(([, body]) => body.type === 'channel.channel_points_custom_reward_redemption.add').length, 2);
    assert.equal(fixture.warnings.filter((message) => message.includes('Twitch rejected the subscription')).length, 1);
  } finally {
    fixture.restore();
  }
});

test('follow notifications record only this broadcaster and only while SQLite is ready', async () => {
  const fixture = loadEventSub();
  try {
    const socket = await startSession(fixture);
    const event = {
      broadcaster_user_id: 'broadcaster-user-id',
      user_id: 'viewer-user-id',
      user_login: 'viewer_login',
      user_name: 'Viewer Name',
      followed_at: '2026-10-31T12:34:56.000Z',
    };

    socket.sendEvent('notification', { subscription: { type: 'channel.follow' }, event });
    socket.sendEvent('notification', {
      subscription: { type: 'channel.follow' },
      event: { ...event, broadcaster_user_id: 'someone-else' },
    });
    fixture.setDbReady(false);
    socket.sendEvent('notification', { subscription: { type: 'channel.follow' }, event });

    assert.deepEqual(fixture.recordedFollows, [{
      userId: 'viewer-user-id',
      username: 'viewer_login',
      displayName: 'Viewer Name',
      followedAt: '2026-10-31T12:34:56.000Z',
    }]);

    fixture.setDbReady(true);
    socket.sendEvent('notification', { subscription: { type: 'channel.follow' }, event });
    assert.equal(fixture.recordedFollows.length, 2);
    assert.equal(fixture.followsByUserId.size, 1, 'the repository upsert is idempotent for duplicate follow events');
    assert.equal(fixture.followsByUserId.get('viewer-user-id').followedAt, '2026-10-31T12:34:56.000Z');
  } finally {
    fixture.restore();
  }
});
