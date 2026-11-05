'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-admin-dashboard-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const { buildDashboardData, formatMoney } = require('../src/services/adminDashboard.service');
const exchangeRates = require('../src/services/exchangeRates.service');

const RATES = { rates: { RUB: 1, USD: 80, USDT: 80 }, date: Date.UTC(2026, 10, 6, 8, 30) };

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function addDonation(id, { source = 'donationalerts', isTest = false, amount = 100, currency = 'RUB', status = 'sent', donorName = 'donor', createdAt = NOW } = {}) {
  db.prepare(`INSERT INTO donation (id, source, is_test, external_id, donor_name, amount, currency, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, source, isTest ? 1 : 0, `ext-${id}`, donorName, amount, currency, status, createdAt, createdAt);
}

function addMessage(id, user, createdAt) {
  db.prepare('INSERT INTO chat_log (id, user, display_name, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, user, user, 'hello', createdAt, createdAt);
}

test('dashboard counts only real donations and groups them by currency', () => {
  addDonation('real-1', { amount: 300, donorName: 'alice', createdAt: NOW - DAY });
  addDonation('real-2', { amount: 1200, donorName: 'bob', createdAt: NOW - 2 * DAY });
  addDonation('usdt-1', { source: 'usdt-trc20', amount: 2500, currency: 'USD', createdAt: NOW - 3 * DAY });
  addDonation('old-1', { amount: 5000, donorName: 'carol', createdAt: NOW - 60 * DAY });
  addDonation('scheduled-1', { source: 'scheduled', isTest: true, amount: 99999, donorName: 'fake' });
  addDonation('manual-1', { source: 'manual', isTest: true, amount: 77777, donorName: 'fake' });
  addDonation('failed-1', { amount: 400, status: 'failed', donorName: 'dave' });

  const data = buildDashboardData(NOW, { rates: RATES });
  // 300 + 1200 ₽ и 2500 $ по курсу 80 = 201 500 ₽.
  assert.equal(data.metrics.donationsMonth.primary, formatMoney(201500, 'RUB'));
  assert.equal(data.metrics.donationsMonth.extra, `в т.ч. ${formatMoney(2500, 'USD')} ≈ ${formatMoney(200000, 'RUB')}`);
  assert.equal(data.metrics.donationsMonth.count, 3);
  assert.equal(data.metrics.donationsAll.primary, formatMoney(206500, 'RUB'));
  assert.match(data.metrics.rateNote, /1 \$ = 80 ₽/);

  // Без курса доллары не теряются, а показываются отдельно без пересчёта.
  const withoutRates = buildDashboardData(NOW);
  assert.equal(withoutRates.metrics.donationsMonth.primary, formatMoney(1500, 'RUB'));
  assert.equal(withoutRates.metrics.donationsMonth.extra, `+ ${formatMoney(2500, 'USD')} без пересчёта`);
  assert.equal(withoutRates.metrics.rateNote, '');

  const serialized = JSON.stringify(data);
  assert.doesNotMatch(serialized, /fake|99\s?999|77\s?777/);
  assert.deepEqual(data.topDonors.map((item) => item.donorName), ['bob', 'alice']);
  assert.equal(data.recentDonations[0].donorName, 'alice');
  assert.ok(data.recentDonations.some((item) => item.donorName === 'USDT поддержка'));
});

test('dashboard shows the total in rubles when a period has only dollars', () => {
  addDonation('usd-only', { source: 'usdt-trc20', amount: 10, currency: 'USD', createdAt: NOW + 165 * DAY });
  const data = buildDashboardData(NOW + 170 * DAY, { rates: RATES });
  assert.equal(data.metrics.donationsMonth.primary, formatMoney(800, 'RUB'));
  assert.equal(data.metrics.donationsMonth.extra, `в т.ч. ${formatMoney(10, 'USD')} ≈ ${formatMoney(800, 'RUB')}`);
});

test('exchange rates parse CBR nominal values, cache them, and survive source errors', async () => {
  exchangeRates.resetCache();
  const payload = JSON.stringify({ Date: '2026-11-06T11:30:00+03:00', Valute: {
    USD: { Nominal: 1, Value: 80.5 },
    KZT: { Nominal: 100, Value: 16 },
  } });
  let calls = 0;
  const http = { get: async () => { calls += 1; return { data: payload }; } };
  const first = await exchangeRates.getRubRates({ now: 1000, http });
  assert.equal(first.rates.USD, 80.5);
  assert.equal(first.rates.USDT, 80.5);
  assert.equal(first.rates.KZT, 0.16);
  assert.equal(exchangeRates.toRub(10, 'usdt', first.rates), 805);
  assert.equal(exchangeRates.toRub(10, 'XYZ', first.rates), null);

  await exchangeRates.getRubRates({ now: 2000, http });
  assert.equal(calls, 1, 'fresh cache must not hit the source again');

  const failing = { get: async () => { calls += 1; throw new Error('offline'); } };
  const stale = await exchangeRates.getRubRates({ now: 1000 + 7 * 60 * 60 * 1000, http: failing });
  assert.equal(stale.rates.USD, 80.5, 'last good rate is kept when the source fails');

  exchangeRates.resetCache();
  assert.equal(await exchangeRates.getRubRates({ now: 5000, http: failing }), null);
});

test('dashboard chat stats compare the last week with the previous one', () => {
  addMessage('m1', 'alice', NOW - DAY);
  addMessage('m2', 'Alice', NOW - DAY);
  addMessage('m3', 'bob', NOW - 2 * DAY);
  addMessage('m4', 'carol', NOW - 9 * DAY);

  const data = buildDashboardData(NOW);
  assert.equal(data.metrics.chatMessages, '3');
  assert.equal(data.metrics.chatters, '2');
  assert.equal(data.metrics.chatMessagesTrend.direction, 'up');
  assert.equal(data.metrics.chattersTrend.label, '+100% к прошлой неделе');
  assert.equal(data.topChatters[0].login, 'alice');
  assert.equal(data.topChatters[0].messages, 2);

  assert.equal(data.chatChart.bars.length, 14);
  assert.equal(data.chatChart.bars.filter((bar) => bar.isToday).length, 1);
  assert.equal(data.chatChart.total, '4');
  assert.ok(data.chatChart.bars.every((bar) => bar.height >= 0 && bar.height <= 100));
});

test('dashboard reports the live stream before the latest ended one', () => {
  const insert = db.prepare(`INSERT INTO stream_session (id, title, started_at, ended_at, status, max_viewers, avg_viewers, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run('ended', 'Old stream', NOW - 2 * DAY, NOW - 2 * DAY + 2 * 3600000, 'ended', 40, 20, NOW, NOW);
  insert.run('live', 'Live stream', NOW - 30 * 60000, null, 'live', 10, 6, NOW, NOW);

  const data = buildDashboardData(NOW);
  assert.equal(data.stream.isLive, true);
  assert.equal(data.stream.title, 'Live stream');
  assert.equal(data.streamsMonth.count, '2');
  assert.equal(data.streamsMonth.peakViewers, '40');
});
