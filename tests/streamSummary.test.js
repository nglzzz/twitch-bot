const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreamSummaryService } = require('../src/services/streamSummary.service');

function fakeRepo(calls) {
  return {
    chatTotalsSince: (since) => { calls.push(since); return { messages: 5, chatters: 3 }; },
    topChattersSince: () => [{ login: 'nglzzzbot', name: 'bot', messages: 9 }, { login: 'ann', name: 'Ann', messages: 4 }],
    followersSince: () => [{ login: 'bob', name: 'Bob' }],
    subscribersSince: () => [],
    donorsSince: () => [{ name: 'Кто-то' }],
  };
}

test('summary uses the live session start and hides bots', async () => {
  const calls = [];
  const service = createStreamSummaryService({
    repo: fakeRepo(calls),
    getActiveSession: async () => ({ startedAt: 1000, title: 'Стрим' }),
    isDbReady: () => true,
    botLogins: ['NGLZZZBOT'],
    now: () => 5000,
  });
  const summary = await service.getSummary();
  assert.equal(calls[0], 1000);
  assert.equal(summary.live, true);
  assert.deepEqual(summary.topChatters.map((c) => c.login), ['ann']);
  assert.equal(summary.followers.length, 1);
});

test('without a live stream the last six hours are used; no database gives null', async () => {
  const calls = [];
  const now = 7 * 60 * 60 * 1000;
  const offline = createStreamSummaryService({ repo: fakeRepo(calls), getActiveSession: async () => null, isDbReady: () => true, now: () => now });
  assert.equal((await offline.getSummary()).live, false);
  assert.equal(calls[0], now - 6 * 60 * 60 * 1000);
  const noDb = createStreamSummaryService({ repo: fakeRepo([]), getActiveSession: async () => null, isDbReady: () => false });
  assert.equal(await noDb.getSummary(), null);
});
