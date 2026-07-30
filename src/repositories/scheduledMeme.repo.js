'use strict';

const { stmt, uuid, toEpochMs, mapRow, mapRows, updateById, normalizeValue } = require('./base');

const MAP_OPTS = { boolFields: ['is_sound_only'] };

function _map(row) {
  return mapRow(row, MAP_OPTS);
}

function findByStatuses(statuses, { limit = 100 } = {}) {
  const placeholders = statuses.map(() => '?').join(',');
  const rows = stmt(
    `SELECT * FROM scheduled_meme WHERE status IN (${placeholders}) ORDER BY scheduled_for ASC LIMIT ?`
  ).all(...statuses, limit);
  return mapRows(rows, MAP_OPTS);
}

function countPending() {
  return stmt("SELECT COUNT(*) AS c FROM scheduled_meme WHERE status = 'pending'").get().c;
}

function create(data) {
  const id = uuid();
  const now = Date.now();
  stmt(
    `INSERT INTO scheduled_meme
      (id, sticker_id, selection, sender, message, is_sound_only, scheduled_for, status, sent_at, error, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.stickerId ?? '',
    data.selection ?? 'random',
    data.sender ?? 'test',
    data.message ?? '',
    data.isSoundOnly ? 1 : 0,
    toEpochMs(data.scheduledFor),
    data.status ?? 'pending',
    toEpochMs(data.sentAt),
    data.error ?? null,
    data.createdBy ?? null,
    now,
    now
  );
  return id;
}

function insertMany(items) {
  const insertStmt = stmt(
    `INSERT INTO scheduled_meme
      (id, sticker_id, selection, sender, message, is_sound_only, scheduled_for, status, sent_at, error, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = Date.now();
  const ids = [];
  const tx = require('./base').db.transaction((rows) => {
    for (const data of rows) {
      const id = uuid();
      insertStmt.run(
        id,
        data.stickerId ?? '',
        data.selection ?? 'random',
        data.sender ?? 'test',
        data.message ?? '',
        normalizeValue(data.isSoundOnly),
        toEpochMs(data.scheduledFor),
        data.status ?? 'pending',
        toEpochMs(data.sentAt),
        data.error ?? null,
        data.createdBy ?? null,
        now,
        now
      );
      ids.push(id);
    }
  });
  tx(items);
  return ids;
}

function findById(id) {
  return _map(stmt('SELECT * FROM scheduled_meme WHERE id = ?').get(id));
}

function update(id, patch) {
  updateById('scheduled_meme', id, patch);
  return findById(id);
}

function claimDue(now = Date.now()) {
  const row = stmt(
    `UPDATE scheduled_meme
       SET status = 'processing', error = NULL, updated_at = ?
     WHERE id = (
       SELECT id FROM scheduled_meme
       WHERE status = 'pending' AND scheduled_for <= ?
       ORDER BY scheduled_for ASC LIMIT 1
     )
     RETURNING *`
  ).get(now, now);
  return _map(row);
}

function cancelIfPending(id) {
  const row = stmt(
    `UPDATE scheduled_meme
       SET status = 'cancelled', updated_at = ?
     WHERE id = ? AND status = 'pending'
     RETURNING *`
  ).get(Date.now(), id);
  return _map(row);
}

module.exports = {
  findByStatuses,
  countPending,
  create,
  insertMany,
  findById,
  update,
  claimDue,
  cancelIfPending,
};
