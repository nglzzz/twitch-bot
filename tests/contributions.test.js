'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const Database = require('better-sqlite3');
const { upgradeSchema } = require('../src/app/schema');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-contributions-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const communityRepo = require('../src/repositories/community.repo');
const contributionRepo = require('../src/repositories/communityContributions.repo');
const achievementRepo = require('../src/repositories/achievement.repo');
const achievementService = require('../src/services/achievements.service');
const { ACHIEVEMENTS, makeAchievements, metricValues } = require('../src/services/achievementRules');

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function addUser(userId, username = userId.replace(/[^a-z0-9_]/gi, '_')) {
  return communityRepo.recordChat({
    userId,
    username,
    displayName: `User ${username}`,
    message: 'profile baseline',
    messageId: `baseline-${userId}`,
  });
}

function addMeme(id, eventId, { kind = 'sticker-sent', userAlias = 'Meme User', sentAt = Date.now() } = {}) {
  const now = Date.now();
  db.prepare(`INSERT INTO meme_log
    (id, event_id, user, user_alias, sticker_name, kind, sent_at, raw, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
    .run(id, eventId, userAlias.toLowerCase().replace(/\s+/g, '_'), userAlias, 'Sticker', kind, sentAt, now, now);
}

function addDonation(id, source, externalId, {
  isTest = false,
  amount = 5,
  status = 'sent',
  donorName = 'Anonymous',
} = {}) {
  const now = Date.now();
  db.prepare(`INSERT INTO donation
    (id, source, is_test, external_id, donor_name, donor_id, message, amount, currency,
      status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', '', ?, 'RUB', ?, ?, ?)`)
    .run(id, source, isTest ? 1 : 0, externalId, donorName, amount, status, now, now);
}

test('schema v6 adds paid subscription links without changing old achievement IDs', () => {
  assert.ok(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version >= 6);
  assert.equal(db.prepare("SELECT name FROM pragma_table_info('community_paid_subscription') WHERE name = 'external_subscriber_id'").get()?.name, 'external_subscriber_id');
  assert.equal(db.prepare("SELECT name FROM pragma_table_info('community_paid_subscription') WHERE name = 'confirmed_by'").get()?.name, 'confirmed_by');
  assert.equal(db.prepare("SELECT name FROM pragma_table_info('meme_log') WHERE name = 'community_user_id'").get()?.name, 'community_user_id');
  assert.equal(db.prepare("SELECT name FROM pragma_table_info('donation') WHERE name = 'community_user_id'").get()?.name, 'community_user_id');

  const ids = ACHIEVEMENTS.map(({ id }) => id);
  assert.equal(ids.length, 51);
  for (const legacyId of ['messages_1', 'follow', 'quiz_100', 'mode_movie_25']) assert.ok(ids.includes(legacyId));
  assert.equal(new Set(ids).size, ids.length);
});

test('channel point spending is deduplicated, fulfillment-only, and safely monotonic', () => {
  addUser('points-user');
  const input = {
    id: 'redemption-points-1',
    userId: 'points-user',
    username: 'points_user',
    displayName: 'Points User',
    cost: 1500,
    rewardId: 'reward-1',
    status: 'unfulfilled',
    redeemedAt: 1_700_000_000_000,
  };

  const pending = contributionRepo.recordRedemption(input);
  assert.equal(pending.status, 'unfulfilled');
  assert.equal(contributionRepo.getStats('points-user').pointsSpent, 0);
  assert.equal(contributionRepo.claimRedemption(input.id), true);
  assert.equal(contributionRepo.claimRedemption(input.id), false);

  const fulfilled = contributionRepo.setRedemptionStatus(input.id, 'fulfilled');
  assert.equal(fulfilled.status, 'fulfilled');
  assert.equal(contributionRepo.getStats('points-user').pointsSpent, 1500);
  assert.ok(achievementService.getEarned('points-user').some(({ achievementId }) => achievementId === 'points_spent_1000'));
  assert.equal(contributionRepo.claimRedemption(input.id), false);

  contributionRepo.recordRedemption({ ...input, cost: 999999, rewardId: 'replacement', status: 'fulfilled' });
  assert.equal(contributionRepo.getRedemption(input.id).cost, 1500);
  assert.equal(contributionRepo.getRedemption(input.id).rewardId, 'reward-1');
  assert.throws(() => contributionRepo.recordRedemption({ ...input, userId: 'different-user' }), /another Twitch user/);

  contributionRepo.setRedemptionStatus(input.id, 'canceled');
  contributionRepo.setRedemptionStatus(input.id, 'unfulfilled');
  assert.equal(contributionRepo.getRedemption(input.id).status, 'canceled');
  assert.equal(contributionRepo.getStats('points-user').pointsSpent, 0);
  assert.ok(achievementService.getEarned('points-user').some(({ achievementId }) => achievementId === 'points_spent_1000'));

  contributionRepo.recordRedemption({ ...input, id: 'redemption-unknown', status: 'unknown' });
  assert.equal(contributionRepo.getStats('points-user').pointsSpent, 0);
  assert.equal(contributionRepo.claimRedemption('redemption-unknown'), false);

  contributionRepo.recordRedemption({
    ...input, id: 'redemption-update-first', userId: 'points-user', cost: 250, status: 'fulfilled',
  });
  contributionRepo.recordRedemption({
    ...input, id: 'redemption-update-first', userId: 'points-user', cost: 250, status: 'unfulfilled',
  });
  assert.equal(contributionRepo.getRedemption('redemption-update-first').status, 'fulfilled');
  assert.equal(contributionRepo.getStats('points-user').pointsSpent, 250);
});

test('explicit support links count safe real events once and historical awards stay silent', () => {
  addUser('support-user');
  addUser('other-user');
  addMeme('meme-a', 'provider-event-a');
  addMeme('meme-a-duplicate', 'provider-event-a');
  addMeme('meme-hidden-kind', 'provider-event-hidden', { kind: 'other-event' });
  addDonation('donation-da-failed', 'donationalerts', 'da-event-1', { status: 'failed' });
  addDonation('donation-usdt-baseline', 'usdt-trc20', 'tron-event-1', { status: 'skipped' });
  addDonation('donation-test', 'donationalerts', 'test-event', { isTest: true });
  addDonation('donation-scheduled', 'scheduled', 'scheduled-event');
  addDonation('donation-empty-id', 'donationalerts', '');

  assert.equal(contributionRepo.getStats('support-user').memesSent, 0);
  const unassigned = contributionRepo.listUnassigned({ limit: 20 });
  assert.equal(unassigned.some((item) => item.recordId === 'meme-a'), true);
  assert.equal(unassigned.some((item) => item.recordId === 'donation-da-failed'), true);
  assert.equal(unassigned.some((item) => item.recordId === 'donation-usdt-baseline'), true);
  assert.equal(unassigned.some((item) => item.recordId === 'donation-test'), false);
  assert.equal(unassigned.some((item) => item.recordId === 'donation-scheduled'), false);
  assert.equal(unassigned.some((item) => item.recordId === 'meme-hidden-kind'), false);
  assert.equal(unassigned.some((item) => Object.hasOwn(item, 'walletAddress') || Object.hasOwn(item, 'raw')), false);

  assert.deepEqual(contributionRepo.assignSupportRecord({
    kind: 'meme', recordId: 'meme-a', userId: 'support-user', adminId: 'admin-1',
  }), { kind: 'meme', recordId: 'meme-a', userId: 'support-user', assigned: true });
  assert.equal(contributionRepo.getStats('support-user').memesSent, 1);
  assert.ok(achievementService.getEarned('support-user').some(({ achievementId, isHistorical }) => achievementId === 'memes_sent_1' && isHistorical));
  const supportAnnouncements = achievementRepo.getPendingAnnouncements()
    .find(({ userId }) => userId === 'support-user')?.achievements || [];
  assert.equal(supportAnnouncements.some(({ id }) => id.startsWith('memes_sent_')), false);
  assert.equal(supportAnnouncements.some(({ id }) => id.startsWith('donations_')), false);
  assert.throws(() => contributionRepo.assignSupportRecord({
    kind: 'meme', recordId: 'meme-a-duplicate', userId: 'other-user',
  }), /another Twitch user/);

  contributionRepo.assignSupportRecord({
    kind: 'donation', recordId: 'donation-da-failed', userId: 'support-user', adminId: 'admin-1',
  });
  contributionRepo.assignSupportRecord({
    kind: 'donation', recordId: 'donation-usdt-baseline', userId: 'support-user', adminId: 'admin-1',
  });
  assert.equal(contributionRepo.getStats('support-user').donationsCount, 2);
  const repeatUpdate = contributionRepo.recordSupportChange('donation', 'donation-da-failed');
  assert.deepEqual(repeatUpdate, []);
  assert.equal(contributionRepo.getStats('support-user').pointsBalance, null);
  assert.throws(() => contributionRepo.assignSupportRecord({
    kind: 'donation', recordId: 'donation-test', userId: 'support-user',
  }), /not found/);
});

test('admin can opt a newly attributed support event into one chat announcement', () => {
  addUser('live-support-user');
  addDonation('donation-live', 'donationalerts', 'da-live-event');

  const linked = contributionRepo.assignSupportRecord({
    kind: 'donation', recordId: 'donation-live', userId: 'live-support-user', adminId: 'admin-live', historical: false,
  });
  assert.equal(linked.assigned, true);
  const pending = achievementRepo.getPendingAnnouncements().find(({ userId }) => userId === 'live-support-user');
  assert.equal(pending.achievements.filter(({ id }) => id === 'donations_1').length, 1);

  const repeated = contributionRepo.assignSupportRecord({
    kind: 'donation', recordId: 'donation-live', userId: 'live-support-user', adminId: 'admin-live', historical: false,
  });
  assert.equal(repeated.assigned, false);
  assert.equal(achievementRepo.getPendingAnnouncements()
    .find(({ userId }) => userId === 'live-support-user').achievements.filter(({ id }) => id === 'donations_1').length, 1);
});

test('hidden and test memes in valid provider payloads never count or appear for attribution', () => {
  addUser('meme-filter-user');
  addMeme('meme-raw-hidden', 'raw-hidden-event');
  addMeme('meme-raw-test', 'raw-test-event');
  addMeme('meme-raw-good', 'raw-good-event');
  db.prepare('UPDATE meme_log SET raw = ? WHERE id = ?').run(JSON.stringify({ isHidden: true }), 'meme-raw-hidden');
  db.prepare('UPDATE meme_log SET raw = ? WHERE id = ?').run(JSON.stringify({ test: true }), 'meme-raw-test');
  db.prepare('UPDATE meme_log SET raw = ? WHERE id = ?').run(JSON.stringify({ isTest: false }), 'meme-raw-good');

  const unassignedIds = new Set(contributionRepo.listUnassigned({ kind: 'meme' }).map(({ recordId }) => recordId));
  assert.equal(unassignedIds.has('meme-raw-hidden'), false);
  assert.equal(unassignedIds.has('meme-raw-test'), false);
  assert.equal(unassignedIds.has('meme-raw-good'), true);
  assert.throws(() => contributionRepo.assignSupportRecord({
    kind: 'meme', recordId: 'meme-raw-hidden', userId: 'meme-filter-user',
  }), /not found/);

  contributionRepo.assignSupportRecord({ kind: 'meme', recordId: 'meme-raw-good', userId: 'meme-filter-user' });
  assert.equal(contributionRepo.getStats('meme-filter-user').memesSent, 1);
});

test('support attribution rolls back if achievement evaluation fails', () => {
  addUser('rollback-user');
  addMeme('meme-rollback', 'provider-event-rollback');
  const originalEvaluateUser = achievementService.evaluateUser;
  achievementService.evaluateUser = () => { throw new Error('forced evaluation failure'); };
  try {
    assert.throws(() => contributionRepo.assignSupportRecord({
      kind: 'meme', recordId: 'meme-rollback', userId: 'rollback-user', adminId: 'admin-rollback',
    }), /forced evaluation failure/);
  } finally {
    achievementService.evaluateUser = originalEvaluateUser;
  }
  assert.equal(db.prepare('SELECT community_user_id FROM meme_log WHERE id = ?').get('meme-rollback').community_user_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM community_support_link_audit WHERE record_id = ?').get('meme-rollback').count, 0);
});

test('schema v4 upgrade adds contribution columns idempotently and preserves source and achievement rows', () => {
  const legacyDb = new Database(':memory:');
  legacyDb.pragma('foreign_keys = ON');
  legacyDb.exec(`
    CREATE TABLE admin_settings (updated_at INTEGER NOT NULL);
    CREATE TABLE quiz_question (id TEXT PRIMARY KEY, clue TEXT NOT NULL, answers TEXT NOT NULL,
      answer_key TEXT NOT NULL UNIQUE, source TEXT NOT NULL DEFAULT 'ai', created_at INTEGER NOT NULL);
    CREATE TABLE community_user (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, followed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE community_achievement (user_id TEXT NOT NULL, achievement_id TEXT NOT NULL,
      earned_at INTEGER NOT NULL, is_historical INTEGER NOT NULL DEFAULT 0, announced_at INTEGER,
      PRIMARY KEY (user_id, achievement_id));
    CREATE TABLE community_achievement_state (user_id TEXT PRIMARY KEY, initialized_at INTEGER NOT NULL);
    CREATE TABLE chat_log (id TEXT PRIMARY KEY, user TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE meme_log (id TEXT PRIMARY KEY, event_id TEXT, user TEXT, user_alias TEXT, sticker_name TEXT,
      kind TEXT, sent_at INTEGER, stream_session_id TEXT, raw TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE donation (id TEXT PRIMARY KEY, source TEXT NOT NULL, is_test INTEGER NOT NULL DEFAULT 0,
      external_id TEXT, donor_name TEXT NOT NULL, donor_id TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'RUB', stream_session_id TEXT,
      stream_elements_activity_id TEXT, status TEXT NOT NULL DEFAULT 'pending', error TEXT, raw TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  `);
  const now = Date.now();
  legacyDb.prepare(`INSERT INTO community_user
    (user_id, username, display_name, first_seen_at, last_seen_at, followed_at, created_at, updated_at)
    VALUES ('legacy-user', 'legacy_user', 'Legacy User', ?, ?, NULL, ?, ?)`)
    .run(now, now, now, now);
  legacyDb.prepare(`INSERT INTO community_achievement
    (user_id, achievement_id, earned_at, is_historical, announced_at)
    VALUES ('legacy-user', 'messages_1', ?, 0, NULL)`).run(now);
  legacyDb.prepare(`INSERT INTO meme_log
    (id, event_id, user, user_alias, sticker_name, kind, sent_at, raw, created_at, updated_at)
    VALUES ('legacy-meme', 'legacy-event', 'legacy', 'Legacy', 'Sticker', 'sticker-sent', ?, '{"isTest":false}', ?, ?)`)
    .run(now, now, now);
  legacyDb.prepare(`INSERT INTO donation
    (id, source, is_test, external_id, donor_name, amount, created_at, updated_at)
    VALUES ('legacy-donation', 'donationalerts', 0, 'legacy-donation-event', 'Legacy', 10, ?, ?)`)
    .run(now, now);

  try {
    upgradeSchema(legacyDb);
    upgradeSchema(legacyDb);
    assert.deepEqual(legacyDb.prepare('SELECT id, event_id, kind, raw FROM meme_log').get(), {
      id: 'legacy-meme', event_id: 'legacy-event', kind: 'sticker-sent', raw: '{"isTest":false}',
    });
    assert.deepEqual(legacyDb.prepare('SELECT id, source, external_id, amount FROM donation').get(), {
      id: 'legacy-donation', source: 'donationalerts', external_id: 'legacy-donation-event', amount: 10,
    });
    assert.equal(legacyDb.prepare('SELECT COUNT(*) AS count FROM community_achievement WHERE achievement_id = ?').get('messages_1').count, 1);
    assert.equal(legacyDb.prepare('PRAGMA table_info(meme_log)').all().filter(({ name }) => name === 'community_user_id').length, 1);
    assert.equal(legacyDb.prepare('PRAGMA table_info(donation)').all().filter(({ name }) => name === 'community_user_id').length, 1);
    assert.equal(legacyDb.prepare('SELECT COUNT(*) AS count FROM community_redemption').get().count, 0);
  } finally {
    legacyDb.close();
  }
});

test('contribution metrics drive threshold progress without inventing a points balance', () => {
  const values = metricValues({ pointsSpent: 10_000, memesSent: 50, donationsCount: 5 }, {});
  assert.equal(values.pointsSpent, 10_000);
  assert.equal(values.memesSent, 50);
  assert.equal(values.donationsCount, 5);
  const progress = makeAchievements({ pointsSpent: 10_000, memesSent: 50, donationsCount: 5 }, {});
  assert.equal(progress.find(({ id }) => id === 'points_spent_10000').unlocked, true);
  assert.equal(progress.find(({ id }) => id === 'memes_sent_50').unlocked, true);
  assert.equal(progress.find(({ id }) => id === 'donations_5').unlocked, true);
  assert.equal(contributionRepo.getStats('support-user').pointsBalance, null);
});
