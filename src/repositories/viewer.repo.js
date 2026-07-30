'use strict';

const { stmt, uuid, mapRow } = require('./base');

// viewers хранится как JSON-массив ников. При чтении парсится обратно в массив.
const MAP_OPTS = { jsonFields: ['viewers'] };

function insert(data) {
  const id = uuid();
  const now = Date.now();
  const viewers = Array.isArray(data.viewers) ? data.viewers : [];
  stmt(
    `INSERT INTO viewer (id, viewers, stream_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, JSON.stringify(viewers), data.streamSessionId ?? null, now, now);
  return id;
}

/**
 * Снапшоты с фильтром по стриму и/или моменту. Сортировка по возрастанию created_at.
 * limit === 0 (или null) — без лимита (поведение Mongoose .limit(0)).
 */
function findSnapshots({ streamSessionId = null, since = null, limit = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (streamSessionId) {
    conditions.push('stream_session_id = ?');
    params.push(streamSessionId);
  }
  if (since !== null && since !== undefined) {
    conditions.push('created_at >= ?');
    params.push(since);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM viewer ${where} ORDER BY created_at ASC${limit ? ' LIMIT ?' : ''}`;
  if (limit) {
    params.push(limit);
  }
  return stmt(sql).all(...params).map((r) => mapRow(r, MAP_OPTS));
}

function countSnapshots({ streamSessionId = null } = {}) {
  if (streamSessionId) {
    return stmt('SELECT COUNT(*) AS c FROM viewer WHERE stream_session_id = ?').get(streamSessionId).c;
  }
  return stmt('SELECT COUNT(*) AS c FROM viewer').get().c;
}

/**
 * Снапшоты, в массиве viewers которых присутствует user (массив-содержит, агр. по 1D).
 * Сортировка по возрастанию created_at.
 */
function findSnapshotsByUser(user) {
  const rows = stmt(
    `SELECT * FROM viewer
     WHERE EXISTS (SELECT 1 FROM json_each(viewers) WHERE value = ?)
     ORDER BY created_at ASC`
  ).all(user);
  return rows.map((r) => mapRow(r, MAP_OPTS));
}

module.exports = {
  insert,
  findSnapshots,
  countSnapshots,
  findSnapshotsByUser,
};
