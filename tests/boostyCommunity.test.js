'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const BoostyClient = require('../src/utils/Boosty/BoostyClient');
const {
  createBoostyCommunityService,
  createAutoLinkWorker,
  normalizeSubscriberId,
} = require('../src/services/boostyCommunity.service');

test('Boosty subscriber client follows offset pages and verifies the complete result', async () => {
  const requests = [];
  const client = new BoostyClient('secret-token', {
    request: async (options) => {
      requests.push(options);
      const offset = Number(new URL(options.url).searchParams.get('offset'));
      const pages = {
        0: [{ id: 101, name: 'One' }, { id: 102, name: 'Two' }],
        2: [{ id: 103, name: 'Three' }, { id: 104, name: 'Four' }],
        4: [{ id: 105, name: 'Five' }],
      };
      return { data: { total: 5, data: pages[offset] } };
    },
  });
  const records = await client.getSubscriberRecords(2, { requireComplete: true });
  assert.deepEqual(records.map(({ id }) => id), [101, 102, 103, 104, 105]);
  assert.deepEqual(requests.map((options) => Number(new URL(options.url).searchParams.get('offset'))), [0, 2, 4]);
  assert.ok(requests.every((options) => Number(new URL(options.url).searchParams.get('limit')) === 2));
  assert.equal(requests[0].timeout, 5000);
  assert.equal(requests[0].headers.Authorization, 'Bearer secret-token');
  assert.doesNotMatch(JSON.stringify(records), /secret-token/);

  const incomplete = new BoostyClient('secret-token', {
    request: async (options) => ({
      data: {
        total: 3,
        data: Number(new URL(options.url).searchParams.get('offset')) === 0 ? [{ id: 101, name: 'One' }] : [],
      },
    }),
  });
  await assert.rejects(incomplete.getSubscriberRecords(1000, { requireComplete: true }), /incomplete subscriber list/);
  const unknownCompleteness = new BoostyClient('secret-token', {
    request: async () => ({ data: { data: [{ id: 101, name: 'One' }] } }),
  });
  assert.deepEqual(await unknownCompleteness.getSubscriberRecords(1000), [{ id: 101, name: 'One' }]);
  await assert.rejects(unknownCompleteness.getSubscriberRecords(1000, { requireComplete: true }), /incomplete subscriber list/);

  const legacyClient = new BoostyClient('secret-token', {
    request: async () => ({ data: { data: [{ id: 101, name: 'One', price: 100, subscribed: true }] } }),
  });
  assert.equal((await legacyClient.getSubscribers(1000)).one.id, 101);

  const unavailable = new BoostyClient('secret-token', {
    request: async () => { throw new Error('network unavailable'); },
  });
  await assert.rejects(unavailable.getSubscriberRecords(1000), /subscriber request failed/);

  const loggedErrors = [];
  const originalError = console.error;
  console.error = (...args) => loggedErrors.push(args.join(' '));
  try {
    assert.deepEqual(await unavailable.getSubscribers(1000), {});
  } finally {
    console.error = originalError;
  }
  assert.equal(loggedErrors.length, 1);
  assert.match(loggedErrors[0], /Failed to retrieve subscribers/);
  assert.doesNotMatch(loggedErrors[0], /secret-token|Authorization|headers/i);
});

test('Boosty pagination rejects short, repeated, and changing pages without looping', async () => {
  const shortPage = new BoostyClient('secret-token', {
    request: async (options) => {
      const offset = Number(new URL(options.url).searchParams.get('offset'));
      return { data: { total: 3, data: offset === 0 ? [{ id: 1 }, { id: 2 }] : [] } };
    },
  });
  await assert.rejects(shortPage.getSubscriberRecords(2, { requireComplete: true }), /incomplete subscriber list/);

  let repeatedCalls = 0;
  const repeatedPage = new BoostyClient('secret-token', {
    request: async () => {
      repeatedCalls += 1;
      return { data: { total: 4, data: [{ id: 1 }, { id: 2 }] } };
    },
  });
  await assert.rejects(repeatedPage.getSubscriberRecords(2, { requireComplete: true }), /repeated a subscriber page/);
  assert.equal(repeatedCalls, 2);

  const changingTotal = new BoostyClient('secret-token', {
    request: async (options) => {
      const offset = Number(new URL(options.url).searchParams.get('offset'));
      return { data: { total: offset === 0 ? 3 : 4, data: [{ id: offset + 1 }, { id: offset + 2 }] } };
    },
  });
  await assert.rejects(changingTotal.getSubscriberRecords(2, { requireComplete: true }), /changed during pagination/);
});

test('Boosty community service lists active paid IDs and requires an explicit matching ID to link', async () => {
  const writes = [];
  const service = createBoostyCommunityService({
    tokenProvider: async () => 'private-token',
    clientFactory: () => ({
      getSubscriberRecords: async () => [
        { id: 21, name: 'Alice on Boosty', price: 100, subscribed: true },
        { id: 22, name: 'Inactive', price: 100, subscribed: false },
        { id: 23, name: 'Follower', price: 0, subscribed: true },
      ],
    }),
    repository: { recordBoostySubscription: (input) => { writes.push(input); return true; } },
  });

  assert.deepEqual(await service.getActiveSubscribers(), [{ id: '21', name: 'Alice on Boosty' }]);
  assert.equal(await service.linkActiveSubscriber({
    userId: 'twitch-id-1', username: 'alice', displayName: 'Alice',
    subscriberId: '21', adminId: 'admin-7', confirmedAt: 1234,
  }), true);
  assert.deepEqual(writes, [{
    userId: 'twitch-id-1', username: 'alice', displayName: 'Alice',
    externalSubscriberId: '21', confirmedBy: 'admin-7', confirmedAt: 1234,
  }]);

  await assert.rejects(service.linkActiveSubscriber({
    userId: 'twitch-id-2', subscriberId: '22', adminId: 'admin-7',
  }), /не найдена среди активных платных подписок/);
  await assert.rejects(service.linkActiveSubscriber({
    userId: 'twitch-id-2', subscriberId: '23', adminId: 'admin-7',
  }), /не найдена среди активных платных подписок/);
  await assert.rejects(service.linkActiveSubscriber({
    userId: 'twitch-id-2', subscriberId: 'Alice on Boosty', adminId: 'admin-7',
  }), /Укажите участника Twitch/);
  assert.equal(writes.length, 1);
});

test('automatic Boosty links require one paid Boosty nickname and one existing Twitch identity', async () => {
  const records = [
    { id: 31, name: 'Eve', price: 100, subscribed: true },
    { id: 32, name: 'Duplicate', price: 100, subscribed: true },
    { id: 33, name: 'duplicate', price: 0, subscribed: true },
    { id: 34, name: 'Reused', price: 100, subscribed: true },
    { id: 35, name: 'Linked', price: 100, subscribed: true },
    { id: 36, name: 'NoTwitch', price: 100, subscribed: false },
    { id: 37, name: 'Nobody', price: 100, subscribed: true },
  ];
  const writes = [];
  const service = createBoostyCommunityService({
    tokenProvider: async () => 'private-token',
    clientFactory: () => ({ getSubscriberRecords: async (_limit, options) => {
      assert.equal(options.requireComplete, true);
      return records;
    } }),
    community: {
      findUniqueIdentityByLogin(login) {
        const identities = {
          eve: { userId: 'twitch-eve', username: 'EVE', displayName: 'Eve' },
          reused: null,
          linked: { userId: 'twitch-linked', username: 'linked', displayName: 'Linked' },
          nobody: null,
        };
        return identities[login] || null;
      },
    },
    repository: {
      listBoostyMappings: () => [{ userId: 'twitch-linked', externalSubscriberId: '99', confirmedBy: 'admin-1' }],
      recordAutomaticBoostySubscription: (input) => { writes.push(input); return true; },
    },
    now: () => 4321,
  });

  assert.deepEqual(await service.syncMatchingSubscribers(), {
    linked: 1, ambiguousBoosty: 1, missingTwitch: 2, alreadyLinked: 1,
  });
  assert.deepEqual(writes, [{
    userId: 'twitch-eve', username: 'EVE', displayName: 'Eve',
    externalSubscriberId: '31', confirmedAt: 4321,
  }]);
});

test('Boosty lookup fails closed when the token or complete subscriber list is unavailable', async () => {
  const noToken = createBoostyCommunityService({ tokenProvider: async () => '' });
  await assert.rejects(noToken.getActiveSubscribers(), /Не настроен токен Boosty/);

  const incomplete = createBoostyCommunityService({
    tokenProvider: async () => 'private-token',
    clientFactory: () => ({ getSubscriberRecords: async () => { throw new Error('partial page'); } }),
  });
  await assert.rejects(incomplete.getActiveSubscribers(), /полный список подписчиков/);
  await assert.rejects(incomplete.linkActiveSubscriber({
    userId: 'twitch-id-2', subscriberId: '21', adminId: 'admin-7',
  }), /полный список подписчиков/);
});

test('Boosty IDs are normalized safely and reject malformed values', () => {
  assert.equal(normalizeSubscriberId(123), '123');
  assert.equal(normalizeSubscriberId(' boosty_123 '), 'boosty_123');
  assert.equal(normalizeSubscriberId('../secret'), null);
  assert.equal(normalizeSubscriberId(''), null);
});

test('automatic Boosty worker skips offline storage, prevents overlapping polls, and contains API errors', async () => {
  let dbReady = false;
  let releaseSync;
  let calls = 0;
  const warnings = [];
  const worker = createAutoLinkWorker({
    service: {
      syncMatchingSubscribers() {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => { releaseSync = resolve; });
        throw new Error('temporary Boosty failure');
      },
    },
    isDbReady: () => dbReady,
    logger: { info() {}, warn: (...args) => warnings.push(args.join(' ')) },
  });

  assert.equal(await worker.poll(), null);
  assert.equal(calls, 0);
  dbReady = true;
  const first = worker.poll();
  assert.equal(await worker.poll(), null);
  assert.equal(calls, 1);
  releaseSync({ linked: 0 });
  assert.deepEqual(await first, { linked: 0 });
  assert.equal(await worker.poll(), null);
  assert.equal(calls, 2);
  assert.match(warnings[0], /temporary Boosty failure/);
});
