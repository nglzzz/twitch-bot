'use strict';

const { stmt, uuid, toEpochMs, mapRow, mapRows, updateById } = require('./base');

const MAP_OPTS = { boolFields: [] };

function _map(row) {
  return mapRow(row, MAP_OPTS);
}

function findById(id) {
  return _map(stmt('SELECT * FROM scheduled_donation WHERE id = ?').get(id));
}

function findByStatuses(statuses, { limit = 100 } = {}) {
  const placeholders = statuses.map(() => '?').join(',');
  const rows = stmt(
    `SELECT * FROM scheduled_donation WHERE status IN (${placeholders}) ORDER BY scheduled_for ASC LIMIT ?`
  ).all(...statuses, limit);
  return mapRows(rows, MAP_OPTS);
}

function countPending() {
  return stmt("SELECT COUNT(*) AS c FROM scheduled_donation WHERE status = 'pending'").get().c;
}

function create(data) {
  const id = uuid();
  const now = Date.now();
  stmt(
    `INSERT INTO scheduled_donation
      (id, donor_name, amount, message, currency, scheduled_for, status, sent_at, error, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.donorName ?? null,
    data.amount ?? 0,
    data.message ?? '',
    data.currency ?? 'RUB',
    toEpochMs(data.scheduledFor),
    data.status ?? 'pending',
    toEpochMs(data.sentAt),
    data.error ?? null,
    data.createdBy ?? null,
    now,
    now
  );
  return findById(id);
}

function update(id, patch) {
  updateById('scheduled_donation', id, patch);
  return findById(id);
}

/**
 * Атомарный захват просроченной задачи: pending → processing.
 * Сопоставляет findOneAndUpdate({status:'pending', scheduledFor:{$lte:now}}, {$set:{status:'processing'}}, {sort:{scheduledFor:1}, new:true}).
 * Возвращает захваченный документ или null.
 */
function claimDue(now = Date.now()) {
  const row = stmt(
    `UPDATE scheduled_donation
       SET status = 'processing', error = NULL, updated_at = ?
     WHERE id = (
       SELECT id FROM scheduled_donation
       WHERE status = 'pending' AND scheduled_for <= ?
       ORDER BY scheduled_for ASC LIMIT 1
     )
     RETURNING *`
  ).get(now, now);
  return _map(row);
}

/**
 * Перевод в processing при ручной отправке (только если pending/failed).
 */
function claimForManualSend(id) {
  const row = stmt(
    `UPDATE scheduled_donation
       SET status = 'processing', error = NULL, updated_at = ?
     WHERE id = ? AND status IN ('pending', 'failed')
     RETURNING *`
  ).get(Date.now(), id);
  return _map(row);
}

function cancelIfPending(id) {
  const row = stmt(
    `UPDATE scheduled_donation
       SET status = 'cancelled', updated_at = ?
     WHERE id = ? AND status = 'pending'
     RETURNING *`
  ).get(Date.now(), id);
  return _map(row);
}

/**
 * Удаление по id.
 */
function removeById(id) {
  stmt('DELETE FROM scheduled_donation WHERE id = ?').run(id);
}

module.exports = {
  findById,
  findByStatuses,
  countPending,
  create,
  update,
  claimDue,
  claimForManualSend,
  cancelIfPending,
  removeById,
};
