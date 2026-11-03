'use strict';

const { db, stmt } = require('./base');

function hasBaseline(userId) {
  if (!userId) return false;
  return Boolean(stmt('SELECT 1 FROM community_achievement_state WHERE user_id = ?').get(String(userId)));
}

function seedBaseline({ userId, earnedIds, initializedAt = Date.now() }) {
  if (!userId) throw new TypeError('userId is required');
  return db.transaction(() => {
    const result = stmt('INSERT OR IGNORE INTO community_achievement_state (user_id, initialized_at) VALUES (?, ?)')
      .run(String(userId), Number(initializedAt));
    if (!result.changes) return false;
    const insert = stmt('INSERT OR IGNORE INTO community_achievement (user_id, achievement_id, earned_at, is_historical, announced_at) VALUES (?, ?, ?, 1, ?)');
    for (const id of new Set(earnedIds || [])) insert.run(String(userId), String(id), Number(initializedAt), Number(initializedAt));
    return true;
  })();
}

function insertEarned({ userId, achievementId, earnedAt = Date.now(), historical = false, announce = true }) {
  if (!userId || !achievementId) throw new TypeError('userId and achievementId are required');
  const timestamp = Number(earnedAt);
  const announcedAt = historical || !announce ? timestamp : null;
  return stmt('INSERT OR IGNORE INTO community_achievement (user_id, achievement_id, earned_at, is_historical, announced_at) VALUES (?, ?, ?, ?, ?)')
    .run(String(userId), String(achievementId), timestamp, historical ? 1 : 0, announcedAt).changes === 1;
}

function getEarned(userId) {
  if (!userId) return [];
  return stmt('SELECT achievement_id AS achievementId, earned_at AS earnedAt, is_historical AS isHistorical, announced_at AS announcedAt FROM community_achievement WHERE user_id = ? ORDER BY earned_at, achievement_id')
    .all(String(userId)).map((row) => ({
      achievementId: row.achievementId,
      earnedAt: Number(row.earnedAt),
      isHistorical: Boolean(row.isHistorical),
      announcedAt: row.announcedAt === null ? null : Number(row.announcedAt),
    }));
}

function listRecent({ userId = null, limit = 12 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 12)));
  const select = `WITH ranked_users AS (
      SELECT user_id, username, display_name, avatar_url,
        ROW_NUMBER() OVER (
          PARTITION BY lower(username)
          ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC
        ) AS login_rank
      FROM community_user
    ) SELECT a.user_id AS userId, current_user.username AS login,
        current_user.display_name AS displayName, current_user.avatar_url AS avatarUrl,
        a.achievement_id AS achievementId, a.earned_at AS earnedAt,
        a.is_historical AS isHistorical
      FROM community_achievement a
      JOIN ranked_users current_user ON current_user.user_id = a.user_id AND current_user.login_rank = 1`;
  const rows = userId
    ? stmt(select + ' WHERE a.user_id = ? ORDER BY a.earned_at DESC, a.achievement_id LIMIT ?').all(String(userId), safeLimit)
    : stmt(select + ' ORDER BY a.earned_at DESC, a.achievement_id LIMIT ?').all(safeLimit);
  return rows.map((row) => ({
    userId: row.userId,
    login: row.login,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl || null,
    achievementId: row.achievementId,
    earnedAt: Number(row.earnedAt),
    isHistorical: Boolean(row.isHistorical),
  }));
}

function getPendingAnnouncements({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const rows = stmt(`WITH ranked_users AS (
      SELECT user_id, username,
        ROW_NUMBER() OVER (
          PARTITION BY lower(username)
          ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC
        ) AS login_rank
      FROM community_user
    ) SELECT a.user_id AS userId, current_user.username AS login,
        a.achievement_id AS achievementId, a.earned_at AS earnedAt
      FROM community_achievement a
      JOIN ranked_users current_user ON current_user.user_id = a.user_id AND current_user.login_rank = 1
      WHERE a.announced_at IS NULL AND a.is_historical = 0
      ORDER BY a.earned_at ASC, a.user_id, a.achievement_id LIMIT ?`).all(safeLimit);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.userId)) grouped.set(row.userId, { userId: row.userId, login: row.login, achievements: [] });
    grouped.get(row.userId).achievements.push({ id: row.achievementId, earnedAt: Number(row.earnedAt) });
  }
  return [...grouped.values()];
}

function markAnnounced({ userId, achievementIds, announcedAt = Date.now() }) {
  const ids = [...new Set((achievementIds || []).map(String))];
  if (!userId || ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  return stmt('UPDATE community_achievement SET announced_at = ? WHERE user_id = ? AND announced_at IS NULL AND achievement_id IN (' + placeholders + ')')
    .run(Number(announcedAt), String(userId), ...ids).changes;
}

module.exports = { hasBaseline, seedBaseline, insertEarned, getEarned, listRecent, getPendingAnnouncements, markAnnounced };
