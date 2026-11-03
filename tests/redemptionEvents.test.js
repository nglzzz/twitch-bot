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
  const patchCalls = [];
  const records = new Map();
  const claimed = new Set();
  const recordCalls = [];
  const claimCalls = [];
  const statusCalls = [];
  const chatMessages = [];
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

  const mockExports = {
    [dependencyPaths.axios]: {
      get: async (...args) => {
        getCalls.push(args);
        return {
          data: {
            client_id: 'test-client-id',
            user_id: 'moderator-user-id',
            scopes: ['moderator:read:followers'],
          },
        };
      },
      post: async (...args) => {
        postCalls.push(args);
        return { data: { data: [{ id: `subscription-${postCalls.length}`, status: 'enabled' }] } };
      },
    },
    [dependencyPaths.config]: {
      CHANNEL: 'test-channel',
      TWITCH_API_CLIENT_ID: 'test-client-id',
      BROADCASTER_ID: 'broadcaster-user-id',
    },
    [dependencyPaths.chat]: {
      handleMessageResult: (...args) => chatMessages.push(args),
    },
    [dependencyPaths.rewardRedemptions]: {
      updateRedemptionStatus: async (params) => {
        patchCalls.push(params);
        if (options.patchErrorFor === params.status) throw new Error('status patch failed');
      },
    },
    [dependencyPaths.tokenService]: { getTwitchAccessToken: async () => 'test-access-token' },
    [dependencyPaths.db]: { isDbReady: () => dbReady },
    [dependencyPaths.communityRepo]: { recordFollow: () => {} },
    [dependencyPaths.contributionsRepo]: {
      recordRedemption: (data) => {
        recordCalls.push({ ...data });
        if (options.recordError) throw new Error('redemption persistence failed');
        const previous = records.get(data.id);
        let status = data.status;
        if (previous && ['fulfilled', 'canceled'].includes(previous.status) && status === 'unfulfilled') {
          status = previous.status;
        }
        if (previous?.status === 'canceled' && status === 'fulfilled') status = 'canceled';
        const row = {
          ...(previous || {}),
          ...data,
          status,
        };
        records.set(data.id, row);
        return { ...row };
      },
      setRedemptionStatus: (id, status) => {
        statusCalls.push({ id, status });
        if (options.statusError) throw new Error('status persistence failed');
        const row = records.get(id);
        if (!row) return null;
        row.status = status;
        return { ...row };
      },
      getRedemption: (id) => records.get(id) || null,
      claimRedemption: (id) => {
        claimCalls.push(id);
        if (options.claimError) throw new Error('claim failed');
        const row = records.get(id);
        if (!row || row.status !== 'unfulfilled' || claimed.has(id)) return false;
        claimed.add(id);
        return true;
      },
    },
    [dependencyPaths.websocket]: FakeWebSocket,
  };

  for (const [filename, exports] of Object.entries(mockExports)) {
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }

  const originalWarn = console.warn;
  const originalError = console.error;
  const originalLog = console.log;
  console.warn = () => {};
  console.error = () => {};
  console.log = () => {};
  const eventSub = require(eventSubPath);

  return {
    eventSub,
    sockets,
    getCalls,
    postCalls,
    patchCalls,
    records,
    recordCalls,
    claimCalls,
    statusCalls,
    chatMessages,
    setDbReady: (value) => { dbReady = value; },
    restore: () => {
      console.warn = originalWarn;
      console.error = originalError;
      console.log = originalLog;
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
  await flush();
  return socket;
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function makeRedemption(overrides = {}) {
  return {
    id: 'redemption-id-1',
    broadcaster_user_id: 'broadcaster-user-id',
    user_id: 'viewer-user-id',
    user_login: 'viewer_login',
    user_name: 'Viewer Name',
    status: 'unfulfilled',
    redeemed_at: '2026-11-03T10:00:00.000Z',
    reward: {
      id: 'registered-reward',
      title: 'Meme reward',
      cost: 125,
    },
    ...overrides,
  };
}

function notify(socket, type, event) {
  socket.sendEvent('notification', { subscription: { type }, event });
}

const ADD_TYPE = 'channel.channel_points_custom_reward_redemption.add';
const UPDATE_TYPE = 'channel.channel_points_custom_reward_redemption.update';

test('subscribes to redemption add and update for the configured broadcaster', async () => {
  const fixture = loadEventSub();
  try {
    await startSession(fixture);

    const redemptionSubscriptions = fixture.postCalls
      .map(([, body]) => body)
      .filter((body) => body.type === ADD_TYPE || body.type === UPDATE_TYPE);
    assert.deepEqual(redemptionSubscriptions, [
      {
        type: ADD_TYPE,
        version: '1',
        condition: { broadcaster_user_id: 'broadcaster-user-id' },
        transport: { method: 'websocket', session_id: 'test-session-id' },
      },
      {
        type: UPDATE_TYPE,
        version: '1',
        condition: { broadcaster_user_id: 'broadcaster-user-id' },
        transport: { method: 'websocket', session_id: 'test-session-id' },
      },
    ]);
    assert.ok(fixture.postCalls.some(([, body]) => body.type === 'channel.follow'));
  } finally {
    fixture.restore();
  }
});

test('records cost and stable Twitch identity, runs a registered handler once, and marks success fulfilled', async () => {
  const fixture = loadEventSub();
  let handlerCalls = 0;
  try {
    fixture.eventSub.registerReward('registered-reward', () => {
      handlerCalls += 1;
      return 'Reward complete';
    });
    const socket = await startSession(fixture);
    const event = makeRedemption();

    notify(socket, ADD_TYPE, event);
    await flush();
    notify(socket, ADD_TYPE, event);
    await flush();

    assert.deepEqual(fixture.recordCalls[0], {
      id: 'redemption-id-1',
      userId: 'viewer-user-id',
      username: 'viewer_login',
      displayName: 'Viewer Name',
      cost: 125,
      rewardId: 'registered-reward',
      status: 'unfulfilled',
      redeemedAt: '2026-11-03T10:00:00.000Z',
    });
    assert.equal(handlerCalls, 1, 'duplicate add deliveries must not repeat the external handler');
    assert.deepEqual(fixture.patchCalls, [{
      broadcasterId: 'broadcaster-user-id',
      rewardId: 'registered-reward',
      redemptionId: 'redemption-id-1',
      status: 'FULFILLED',
    }]);
    assert.deepEqual(fixture.statusCalls, [{ id: 'redemption-id-1', status: 'fulfilled' }]);
    assert.deepEqual(fixture.chatMessages, [['Reward complete', '#test-channel']]);
  } finally {
    fixture.restore();
  }
});

test('unknown rewards and updates are persisted without running a reward handler', async () => {
  const fixture = loadEventSub();
  let handlerCalls = 0;
  try {
    fixture.eventSub.registerReward('registered-reward', () => { handlerCalls += 1; });
    const socket = await startSession(fixture);

    notify(socket, ADD_TYPE, makeRedemption({
      id: 'unknown-reward-event',
      status: 'UNFULFILLED',
      reward: { id: 'unregistered-reward', title: 'Viewer reward', cost: 700 },
    }));
    notify(socket, UPDATE_TYPE, makeRedemption({
      id: 'updated-event',
      status: 'FULFILLED',
      reward: { id: 'registered-reward', title: 'Meme reward', cost: 250 },
    }));
    await flush();

    assert.equal(fixture.records.get('unknown-reward-event').cost, 700);
    assert.equal(fixture.records.get('unknown-reward-event').status, 'unfulfilled');
    assert.equal(fixture.records.get('updated-event').cost, 250);
    assert.equal(fixture.records.get('updated-event').status, 'fulfilled');
    assert.equal(handlerCalls, 0);
    assert.equal(fixture.claimCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('an update arriving before add preserves its terminal status and blocks the handler', async () => {
  const fixture = loadEventSub();
  let handlerCalls = 0;
  try {
    fixture.eventSub.registerReward('registered-reward', () => { handlerCalls += 1; });
    const socket = await startSession(fixture);

    notify(socket, UPDATE_TYPE, makeRedemption({ status: 'CANCELLED' }));
    await flush();
    notify(socket, ADD_TYPE, makeRedemption({ status: 'unfulfilled' }));
    await flush();

    assert.equal(fixture.records.get('redemption-id-1').status, 'canceled');
    assert.equal(handlerCalls, 0);
    assert.equal(fixture.claimCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('an unfulfilled update is stored only; a later add runs the handler once', async () => {
  const fixture = loadEventSub();
  let handlerCalls = 0;
  try {
    fixture.eventSub.registerReward('registered-reward', () => { handlerCalls += 1; });
    const socket = await startSession(fixture);
    const event = makeRedemption({ id: 'pending-update-first' });

    notify(socket, UPDATE_TYPE, event);
    await flush();
    assert.equal(handlerCalls, 0);
    assert.equal(fixture.records.get('pending-update-first').status, 'unfulfilled');

    notify(socket, ADD_TYPE, event);
    await flush();
    notify(socket, ADD_TYPE, event);
    await flush();

    assert.equal(handlerCalls, 1);
    assert.equal(fixture.records.get('pending-update-first').status, 'fulfilled');
  } finally {
    fixture.restore();
  }
});

test('a canceled add records the refund status but does not run a handler', async () => {
  const fixture = loadEventSub();
  let handlerCalls = 0;
  try {
    fixture.eventSub.registerReward('registered-reward', () => { handlerCalls += 1; });
    const socket = await startSession(fixture);

    notify(socket, ADD_TYPE, makeRedemption({ status: 'CANCELED' }));
    await flush();

    assert.equal(fixture.records.get('redemption-id-1').status, 'canceled');
    assert.equal(handlerCalls, 0);
    assert.equal(fixture.claimCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('fulfilled and canceled add events are persisted without running handlers', async () => {
  const fixture = loadEventSub();
  let handlerCalls = 0;
  try {
    fixture.eventSub.registerReward('registered-reward', () => { handlerCalls += 1; });
    const socket = await startSession(fixture);

    notify(socket, ADD_TYPE, makeRedemption({ id: 'already-fulfilled', status: 'FULFILLED' }));
    notify(socket, ADD_TYPE, makeRedemption({ id: 'already-canceled', status: 'CANCELED' }));
    await flush();

    assert.equal(fixture.records.get('already-fulfilled').status, 'fulfilled');
    assert.equal(fixture.records.get('already-canceled').status, 'canceled');
    assert.equal(handlerCalls, 0);
    assert.equal(fixture.claimCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('failed Twitch status patch leaves a successful external handler pending and claimed', async () => {
  const fixture = loadEventSub({ patchErrorFor: 'FULFILLED' });
  let handlerCalls = 0;
  try {
    fixture.eventSub.registerReward('registered-reward', () => {
      handlerCalls += 1;
      return 'Reward complete';
    });
    const socket = await startSession(fixture);
    const event = makeRedemption();

    notify(socket, ADD_TYPE, event);
    await flush();
    notify(socket, ADD_TYPE, event);
    await flush();

    assert.equal(handlerCalls, 1);
    assert.equal(fixture.records.get('redemption-id-1').status, 'unfulfilled');
    assert.deepEqual(fixture.statusCalls, []);
  } finally {
    fixture.restore();
  }
});

test('a local status write failure after handler success does not request a refund', async () => {
  const fixture = loadEventSub({ statusError: true });
  let handlerCalls = 0;
  try {
    fixture.eventSub.registerReward('registered-reward', () => { handlerCalls += 1; });
    const socket = await startSession(fixture);

    notify(socket, ADD_TYPE, makeRedemption());
    await flush();

    assert.equal(handlerCalls, 1);
    assert.deepEqual(fixture.patchCalls.map(({ status }) => status), ['FULFILLED']);
    assert.equal(fixture.records.get('redemption-id-1').status, 'unfulfilled');
  } finally {
    fixture.restore();
  }
});

test('handler failure cancels the redemption and persists the confirmed refund', async () => {
  const fixture = loadEventSub();
  try {
    fixture.eventSub.registerReward('registered-reward', () => Promise.reject(new Error('handler failed')));
    const socket = await startSession(fixture);

    notify(socket, ADD_TYPE, makeRedemption());
    await flush();

    assert.deepEqual(fixture.patchCalls, [{
      broadcasterId: 'broadcaster-user-id',
      rewardId: 'registered-reward',
      redemptionId: 'redemption-id-1',
      status: 'CANCELED',
    }]);
    assert.deepEqual(fixture.statusCalls, [{ id: 'redemption-id-1', status: 'canceled' }]);
    assert.equal(fixture.records.get('redemption-id-1').status, 'canceled');
  } finally {
    fixture.restore();
  }
});

test('foreign broadcaster, unavailable SQLite, and persistence or claim failures never run a handler', async (t) => {
  for (const options of [
    { dbReady: false },
    { recordError: true },
    { claimError: true },
  ]) {
    await t.test(JSON.stringify(options), async () => {
      const fixture = loadEventSub(options);
      let handlerCalls = 0;
      try {
        fixture.eventSub.registerReward('registered-reward', () => { handlerCalls += 1; });
        const socket = await startSession(fixture);

        notify(socket, ADD_TYPE, makeRedemption({
          broadcaster_user_id: 'someone-else',
          id: 'foreign-event',
        }));
        notify(socket, ADD_TYPE, makeRedemption());
        await flush();

        assert.equal(handlerCalls, 0);
        assert.equal(fixture.patchCalls.length, 0);
        if (options.dbReady === false) assert.equal(fixture.recordCalls.length, 0);
        if (options.recordError) assert.equal(fixture.claimCalls.length, 0);
      } finally {
        fixture.restore();
      }
    });
  }
});
