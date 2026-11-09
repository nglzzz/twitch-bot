const test = require('node:test');
const assert = require('node:assert/strict');
const { createDonationTopService, pickLeader, startOfDay, startOfMonth } = require('../src/services/donationTop.service');

test('leader sums one donor across currencies and rounds to rubles', () => {
  const rows = [
    { name: 'Valera', currency: 'RUB', amount: 300, lastAt: 1 },
    { name: 'valera', currency: 'USD', amount: 5, lastAt: 2 },
    { name: 'Ann', currency: 'RUB', amount: 700, lastAt: 3 },
  ];
  assert.deepEqual(pickLeader(rows, { USD: 90.4 }), { name: 'Valera', amount: 752 });
});

test('currency without a rate is skipped, empty list gives null', () => {
  assert.deepEqual(pickLeader([{ name: 'X', currency: 'USD', amount: 50, lastAt: 1 }, { name: 'Y', currency: 'RUB', amount: 10, lastAt: 1 }], null), { name: 'Y', amount: 10 });
  assert.equal(pickLeader([], null), null);
});

test('ties go to the latest donor', () => {
  const rows = [{ name: 'Old', currency: 'RUB', amount: 100, lastAt: 1 }, { name: 'New', currency: 'RUB', amount: 100, lastAt: 9 }];
  assert.equal(pickLeader(rows, null).name, 'New');
});

test('service asks day and month windows and caches', async () => {
  const at = new Date(2026, 10, 9, 15, 30).getTime();
  const calls = [];
  const repo = {
    donationTotalsSince: (since) => {
      calls.push(since);
      return since === startOfDay(at)
        ? [{ name: 'Day', currency: 'RUB', amount: 100, lastAt: at }]
        : [{ name: 'Day', currency: 'RUB', amount: 100, lastAt: at }, { name: 'Month', currency: 'USD', amount: 10, lastAt: at - 1 }];
    },
  };
  let rateCalls = 0;
  const service = createDonationTopService({ repo, getRates: async () => { rateCalls += 1; return { rates: { USD: 80 } }; }, isDbReady: () => true, now: () => at });
  const top = await service.getTop();
  assert.deepEqual(top, { day: { name: 'Day', amount: 100 }, month: { name: 'Month', amount: 800 } });
  assert.deepEqual(calls, [startOfMonth(at), startOfDay(at)]);
  assert.equal(new Date(startOfMonth(at)).getDate(), 1);
  await service.getTop();
  assert.equal(calls.length, 2);
  assert.equal(rateCalls, 1);
});

test('no database — no top', async () => {
  const service = createDonationTopService({ repo: {}, getRates: async () => ({}), isDbReady: () => false });
  assert.equal(await service.getTop(), null);
});
