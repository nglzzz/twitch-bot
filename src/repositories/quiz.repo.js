'use strict';

const { stmt } = require('./base');

function hasStarted(streamId) {
  if (!streamId) return false;
  return Boolean(stmt('SELECT 1 FROM quiz_stream WHERE stream_id = ? LIMIT 1').get(String(streamId)));
}

function markStarted(streamId, startedAt = Date.now()) {
  if (!streamId) throw new TypeError('streamId is required');
  stmt('INSERT OR IGNORE INTO quiz_stream (stream_id, started_at) VALUES (?, ?)')
    .run(String(streamId), Number(startedAt));
  return hasStarted(streamId);
}

function addPoint({ userId, username, displayName }) {
  if (!userId || !username) throw new TypeError('userId and username are required');

  const normalizedUsername = String(username).trim().replace(/^@/, '').toLowerCase();
  const safeDisplayName = String(displayName || username).trim();
  const now = Date.now();

  stmt(`INSERT INTO quiz_score (user_id, username, display_name, points, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      points = quiz_score.points + 1,
      updated_at = excluded.updated_at`)
    .run(String(userId), normalizedUsername, safeDisplayName, now);

  return getScore(userId);
}

function getScore(userId) {
  if (!userId) return 0;
  const row = stmt('SELECT points FROM quiz_score WHERE user_id = ?').get(String(userId));
  return row ? Number(row.points) : 0;
}

function getTop() {
  return getLeaderboard(5).map((entry) => ({ username: entry.displayName, points: entry.points }));
}

function getLeaderboard(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  return stmt(`SELECT username, display_name AS displayName, points
    FROM quiz_score
    ORDER BY points DESC, username COLLATE NOCASE ASC
    LIMIT ?`).all(safeLimit).map((row, index) => ({
    position: index + 1,
    login: row.username,
    displayName: row.displayName || row.username,
    points: Number(row.points),
  }));
}

module.exports = {
  hasStarted,
  markStarted,
  addPoint,
  getScore,
  getTop,
  getLeaderboard,
};
