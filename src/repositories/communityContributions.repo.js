'use strict';

const { db, stmt, uuid, toEpochMs } = require('./base');
const communityRepo = require('./community.repo');
const achievements = () => require('../services/achievements.service');

const REDEMPTION_TERMINAL = new Set(['fulfilled', 'canceled']);
const SUPPORT_KINDS = new Set(['meme', 'donation']);

function memeRawIsEligible(alias = 'm') {
  const flags = ['isHidden', 'hidden', 'isTest', 'is_test', 'test']
    .map((field) => `COALESCE(json_extract(${alias}.raw, '$.${field}'), 0) IN (1, 'true')`)
    .join(' OR ');
  return `(CASE WHEN json_valid(${alias}.raw) THEN NOT (${flags}) ELSE 1 END)`;
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return value ? value.slice(0, 32) : 'unknown';
}

function nextRedemptionStatus(currentStatus, incomingStatus) {
  const current = normalizeStatus(currentStatus);
  const incoming = normalizeStatus(incomingStatus);
  if (current === incoming) return current;
  if (current === 'canceled') return current;
  if (current === 'fulfilled') return incoming === 'canceled' ? incoming : current;
  if (REDEMPTION_TERMINAL.has(incoming)) return incoming;
  return incoming;
}

function redemptionStatsChanged(previousStatus, nextStatus) {
  return (normalizeStatus(previousStatus) === 'fulfilled') !== (normalizeStatus(nextStatus) === 'fulfilled');
}

function mapRedemption(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    cost: Number(row.cost),
    rewardId: row.reward_id,
    status: row.status,
    redeemedAt: Number(row.redeemed_at),
    handled: Boolean(row.handled),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function prepareKnownUser(userId, timestamp = null) {
  const identity = communityRepo.findIdentityById(String(userId));
  if (!identity) throw new TypeError('A known Twitch community user is required');
  communityRepo.prepareUserForEvent({
    userId: identity.userId,
    username: identity.username,
    displayName: identity.displayName,
  }, timestamp || identity.lastSeenAt);
  return identity;
}

function recordRedemption({
  id,
  userId,
  username,
  displayName,
  cost,
  rewardId = null,
  status = 'unfulfilled',
  redeemedAt = Date.now(),
} = {}) {
  const redemptionId = String(id || '').trim();
  const twitchUserId = String(userId || '').trim();
  if (!redemptionId || redemptionId.length > 128 || !twitchUserId) {
    throw new TypeError('A redemption ID and Twitch user ID are required');
  }

  const incomingStatus = normalizeStatus(status);
  const timestamp = toEpochMs(redeemedAt) || Date.now();
  const now = Date.now();
  const save = db.transaction(() => {
    const existing = stmt('SELECT * FROM community_redemption WHERE id = ?').get(redemptionId);
    if (existing && existing.user_id !== twitchUserId) {
      throw new Error('A redemption ID cannot be reassigned to another Twitch user');
    }

    const rawCost = cost === undefined || cost === null ? existing?.cost : Number(cost);
    const normalizedCost = Number(rawCost);
    if (!Number.isSafeInteger(normalizedCost) || normalizedCost < 0) {
      throw new TypeError('A non-negative integer redemption cost is required');
    }

    const identity = communityRepo.findIdentityById(twitchUserId);
    const normalizedUsername = username || identity?.username;
    const normalizedDisplayName = displayName || identity?.displayName || normalizedUsername;
    communityRepo.prepareUserForEvent({
      userId: twitchUserId,
      username: normalizedUsername,
      displayName: normalizedDisplayName,
    }, existing ? existing.redeemed_at : timestamp);

    let savedStatus = incomingStatus;
    if (!existing) {
      stmt(`INSERT INTO community_redemption
        (id, user_id, cost, reward_id, status, redeemed_at, handled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
        .run(redemptionId, twitchUserId, normalizedCost,
          rewardId === null || rewardId === undefined ? null : String(rewardId),
          incomingStatus, timestamp, now, now);
    } else {
      savedStatus = nextRedemptionStatus(existing.status, incomingStatus);
      if (savedStatus !== existing.status) {
        stmt('UPDATE community_redemption SET status = ?, updated_at = ? WHERE id = ?')
          .run(savedStatus, now, redemptionId);
      }
    }

    if (redemptionStatsChanged(existing?.status || 'unfulfilled', savedStatus)) {
      achievements().evaluateUser(twitchUserId);
    }
    return mapRedemption(stmt('SELECT * FROM community_redemption WHERE id = ?').get(redemptionId));
  });
  return save();
}

function setRedemptionStatus(id, status) {
  const redemptionId = String(id || '').trim();
  if (!redemptionId) return null;
  const nextIncomingStatus = normalizeStatus(status);
  const save = db.transaction(() => {
    const existing = stmt('SELECT * FROM community_redemption WHERE id = ?').get(redemptionId);
    if (!existing) return null;
    const nextStatus = nextRedemptionStatus(existing.status, nextIncomingStatus);
    if (nextStatus === existing.status) return mapRedemption(existing);
    prepareKnownUser(existing.user_id, existing.redeemed_at);
    stmt('UPDATE community_redemption SET status = ?, updated_at = ? WHERE id = ?')
      .run(nextStatus, Date.now(), redemptionId);
    if (redemptionStatsChanged(existing.status, nextStatus)) achievements().evaluateUser(existing.user_id);
    return mapRedemption(stmt('SELECT * FROM community_redemption WHERE id = ?').get(redemptionId));
  });
  return save();
}

function getRedemption(id) {
  if (!id) return null;
  return mapRedemption(stmt('SELECT * FROM community_redemption WHERE id = ?').get(String(id)));
}

function claimRedemption(id) {
  if (!id) return false;
  return stmt(`UPDATE community_redemption SET handled = 1, updated_at = ?
    WHERE id = ? AND status = 'unfulfilled' AND handled = 0`)
    .run(Date.now(), String(id)).changes === 1;
}

// Заказ засчитывается, когда он заиграл на стриме (скипнутый на ходу тоже считается).
const STARTED_REQUEST = "r.started_at IS NOT NULL AND r.status IN ('playing', 'played', 'skipped')";
const REAL_DONATION = "d.is_test = 0 AND d.external_id IS NOT NULL AND trim(d.external_id) <> '' AND d.amount > 0";
const DONATION_SERVICES = { donationalerts: 'donationsDonationAlerts', streamelements: 'donationsStreamElements', donatepay: 'donationsDonatePay', donatex: 'donationsDonatex' };

/** Заказы музыки и видео: бесплатные — командой в чате, платные — через донат, привязанный к зрителю. */
function getRequestStats(id) {
  const count = (table, paid) => Number(stmt(paid
    ? `SELECT COUNT(*) AS n FROM ${table} r JOIN donation d ON d.id = r.donation_id
        WHERE d.community_user_id = ? AND r.source = 'donation' AND ${STARTED_REQUEST} AND ${REAL_DONATION}`
    : `SELECT COUNT(*) AS n FROM ${table} r WHERE r.requested_by_id = ? AND r.source = 'chat' AND ${STARTED_REQUEST}`)
    .get(id)?.n) || 0;
  return {
    musicFree: count('music_request', false),
    musicPaid: count('music_request', true),
    videoFree: count('video_request', false),
    videoPaid: count('video_request', true),
  };
}

function getDonationServiceStats(id) {
  const rows = stmt(`SELECT d.source AS source, COUNT(*) AS n FROM donation d
    WHERE d.community_user_id = ? AND d.source IN (${Object.keys(DONATION_SERVICES).map(() => '?').join(', ')}) AND ${REAL_DONATION}
    GROUP BY d.source`).all(id, ...Object.keys(DONATION_SERVICES));
  const stats = Object.fromEntries(Object.values(DONATION_SERVICES).map((key) => [key, 0]));
  for (const row of rows) stats[DONATION_SERVICES[row.source]] = Number(row.n) || 0;
  return stats;
}

function getStats(userId) {
  const id = String(userId || '');
  if (!id) return { pointsSpent: 0, memesSent: 0, donationsCount: 0, pointsBalance: null };
  const row = stmt(`SELECT
    (SELECT COALESCE(SUM(cost), 0) FROM community_redemption WHERE user_id = ? AND status = 'fulfilled') AS points_spent,
    (SELECT COUNT(DISTINCT COALESCE(NULLIF(m.event_id, ''), m.id)) FROM meme_log m
      WHERE m.community_user_id = ? AND m.kind = 'sticker-sent' AND ${memeRawIsEligible('m')}) AS memes_sent,
    (SELECT COUNT(*) FROM donation
      WHERE community_user_id = ? AND source IN ('donationalerts', 'usdt-trc20', 'donatepay', 'donatex', 'streamelements')
        AND is_test = 0 AND external_id IS NOT NULL AND trim(external_id) <> '' AND amount > 0) AS donations_count`)
    .get(id, id, id);
  return {
    pointsSpent: Number(row?.points_spent) || 0,
    memesSent: Number(row?.memes_sent) || 0,
    donationsCount: Number(row?.donations_count) || 0,
    pointsBalance: null,
    ...getRequestStats(id),
    ...getDonationServiceStats(id),
  };
}

function normalizeSupportKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  if (!SUPPORT_KINDS.has(value)) throw new TypeError('Support kind must be meme or donation');
  return value;
}

function findEligibleSupport(kind, recordId) {
  if (kind === 'meme') {
    return stmt(`SELECT id, event_id AS eventId, community_user_id AS communityUserId,
        kind AS eventKind, user_alias AS displayName, sticker_name AS title,
        sent_at AS eventAt
      FROM meme_log m WHERE id = ? AND kind = 'sticker-sent' AND ${memeRawIsEligible('m')} LIMIT 1`).get(String(recordId));
  }
  return stmt(`SELECT id, external_id AS eventId, community_user_id AS communityUserId,
      source, donor_name AS displayName, amount, currency,
      created_at AS eventAt, status
    FROM donation WHERE id = ? AND source IN ('donationalerts', 'usdt-trc20', 'donatepay', 'donatex', 'streamelements')
      AND is_test = 0 AND external_id IS NOT NULL AND trim(external_id) <> '' AND amount > 0
    LIMIT 1`).get(String(recordId));
}

function assignSupportRecord({ kind, recordId, userId, adminId = null, historical = true } = {}) {
  const normalizedKind = normalizeSupportKind(kind);
  const safeRecordId = String(recordId || '').trim();
  const twitchUserId = String(userId || '').trim();
  if (!safeRecordId || !twitchUserId) throw new TypeError('A support record and Twitch user ID are required');

  const save = db.transaction(() => {
    const record = findEligibleSupport(normalizedKind, safeRecordId);
    if (!record) throw new Error('Eligible support record was not found');
    if (record.communityUserId && record.communityUserId !== twitchUserId) {
      throw new Error('The support record is already linked to another Twitch user');
    }
    if (normalizedKind === 'meme' && record.eventId) {
      const conflicting = stmt(`SELECT 1 FROM meme_log WHERE event_id = ?
        AND community_user_id IS NOT NULL AND community_user_id <> ? LIMIT 1`)
        .get(record.eventId, twitchUserId);
      if (conflicting) throw new Error('This meme event is already linked to another Twitch user');
    }

    const identity = communityRepo.findIdentityById(twitchUserId);
    if (!identity) throw new TypeError('A known Twitch community user is required');
    communityRepo.prepareUserForEvent({
      userId: identity.userId,
      username: identity.username,
      displayName: identity.displayName,
    }, identity.lastSeenAt);

    const audit = stmt(`SELECT user_id AS userId FROM community_support_link_audit
      WHERE record_kind = ? AND record_id = ?`).get(normalizedKind, safeRecordId);
    if (audit && audit.userId !== twitchUserId) throw new Error('This support record is already linked to another Twitch user');

    if (normalizedKind === 'meme' && record.eventId) {
      stmt(`UPDATE meme_log SET community_user_id = ? WHERE id IN (
        SELECT m.id FROM meme_log m WHERE m.event_id = ? AND m.kind = 'sticker-sent'
          AND ${memeRawIsEligible('m')}
      ) AND (community_user_id IS NULL OR community_user_id = ?)`)
        .run(twitchUserId, record.eventId, twitchUserId);
    } else {
      const table = normalizedKind === 'meme' ? 'meme_log' : 'donation';
      stmt(`UPDATE ${table} SET community_user_id = ? WHERE id = ? AND community_user_id IS NULL`)
        .run(twitchUserId, safeRecordId);
    }

    stmt(`INSERT OR IGNORE INTO community_support_link_audit
      (id, record_kind, record_id, user_id, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuid(), normalizedKind, safeRecordId, twitchUserId,
        adminId === null || adminId === undefined ? null : String(adminId).slice(0, 128), Date.now());

    const changed = record.communityUserId !== twitchUserId;
    if (changed) achievements().evaluateUser(twitchUserId, {
      historical: historical !== false,
      notify: historical === false,
    });
    return { kind: normalizedKind, recordId: safeRecordId, userId: twitchUserId, assigned: changed };
  });
  return save();
}

function listUnassigned({ kind = null, limit = 50 } = {}) {
  const normalizedKind = kind ? normalizeSupportKind(kind) : null;
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const results = [];
  if (!normalizedKind || normalizedKind === 'meme') {
    results.push(...stmt(`SELECT 'meme' AS kind, m.id AS recordId,
        'meme-alerts' AS source, m.user_alias AS displayName,
        m.sticker_name AS title, m.sent_at AS eventAt,
        'sent' AS status
      FROM meme_log m
      WHERE m.kind = 'sticker-sent' AND m.community_user_id IS NULL AND ${memeRawIsEligible('m')}
        AND NOT EXISTS (SELECT 1 FROM meme_log linked WHERE linked.event_id = m.event_id
          AND NULLIF(m.event_id, '') IS NOT NULL AND linked.community_user_id IS NOT NULL)
      ORDER BY m.sent_at DESC, m.id LIMIT ?`).all(safeLimit));
  }
  if (!normalizedKind || normalizedKind === 'donation') {
    results.push(...stmt(`SELECT 'donation' AS kind, d.id AS recordId,
        d.source AS source,
        CASE WHEN d.source = 'usdt-trc20' THEN 'USDT поддержка' ELSE d.donor_name END AS displayName,
        CAST(d.amount AS TEXT) || ' ' || d.currency AS title,
        d.created_at AS eventAt, d.status AS status
      FROM donation d
      WHERE d.community_user_id IS NULL AND d.source IN ('donationalerts', 'usdt-trc20', 'donatepay', 'donatex', 'streamelements')
        AND d.is_test = 0 AND d.external_id IS NOT NULL AND trim(d.external_id) <> '' AND d.amount > 0
      ORDER BY d.created_at DESC, d.id LIMIT ?`).all(safeLimit));
  }
  return results.sort((a, b) => Number(b.eventAt) - Number(a.eventAt) || String(a.recordId).localeCompare(String(b.recordId))).slice(0, safeLimit)
    .map((row) => ({ ...row, eventAt: Number(row.eventAt) }));
}

function recordSupportChange(kind, recordId, { historical = false } = {}) {
  const normalizedKind = normalizeSupportKind(kind);
  const record = findEligibleSupport(normalizedKind, recordId);
  if (!record?.communityUserId) return [];
  prepareKnownUser(record.communityUserId);
  return achievements().evaluateUser(record.communityUserId, {
    historical,
    notify: !historical,
  });
}

module.exports = {
  recordRedemption,
  setRedemptionStatus,
  getRedemption,
  claimRedemption,
  getStats,
  assignSupportRecord,
  listUnassigned,
  recordSupportChange,
};
