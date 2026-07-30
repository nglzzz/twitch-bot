'use strict';

const { stmt, uuid, mapRow, mapRows, updateById } = require('./base');

const MAP_OPTS = { jsonFields: ['raw'], boolFields: ['is_test'] };

function _map(row) {
  return mapRow(row, MAP_OPTS);
}

function findOneByExternalId(source, externalId) {
  if (!externalId) {
    return null;
  }
  const row = stmt('SELECT * FROM donation WHERE source = ? AND external_id = ? LIMIT 1').get(source, externalId);
  return _map(row);
}

function findById(id) {
  const row = stmt('SELECT * FROM donation WHERE id = ?').get(id);
  return _map(row);
}

function findMany({ streamSessionId = null, status = null, isTest = null, limit = 20, orderByCreatedAtDesc = true } = {}) {
  const conditions = [];
  const params = [];
  if (streamSessionId) {
    conditions.push('stream_session_id = ?');
    params.push(streamSessionId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (isTest !== null && isTest !== undefined) {
    conditions.push('is_test = ?');
    params.push(isTest ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = orderByCreatedAtDesc ? 'ORDER BY created_at DESC' : '';
  const sql = `SELECT * FROM donation ${where} ${order} LIMIT ?`;
  params.push(limit);
  return mapRows(stmt(sql).all(...params), MAP_OPTS);
}

/**
 * Сумма/count отправленных донатов. Если streamSessionId задан — по стриму, иначе глобально (агр. #9/#12).
 * Возвращает { donationsCount, donationsAmount }.
 */
function getSentTotals({ streamSessionId = null } = {}) {
  const row = streamSessionId
    ? stmt(
        "SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s FROM donation "
        + "WHERE status = 'sent' AND stream_session_id = ?"
      ).get(streamSessionId)
    : stmt("SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s FROM donation WHERE status = 'sent'").get();
  return { donationsCount: row.c, donationsAmount: row.s };
}

/**
 * Топ-доноров по сумме (агр. #10).
 */
function getTopDonors({ streamSessionId = null, limit = 10 } = {}) {
  const rows = streamSessionId
    ? stmt(
        `SELECT donor_name,
                COUNT(*)     AS donations_count,
                SUM(amount)  AS total_amount,
                MAX(created_at) AS last_at
         FROM donation WHERE status = 'sent' AND stream_session_id = ?
         GROUP BY donor_name ORDER BY total_amount DESC, last_at DESC LIMIT ?`
      ).all(streamSessionId, limit)
    : stmt(
        `SELECT donor_name,
                COUNT(*)     AS donations_count,
                SUM(amount)  AS total_amount,
                MAX(created_at) AS last_at
         FROM donation WHERE status = 'sent'
         GROUP BY donor_name ORDER BY total_amount DESC, last_at DESC LIMIT ?`
      ).all(limit);

  return rows.map((r) => ({
    _id: r.donor_name,
    donationsCount: r.donations_count,
    totalAmount: r.total_amount,
    lastAt: r.last_at,
  }));
}

/**
 * Создаёт запись о донации. Возвращает созданный документ (с _id).
 */
function create(data) {
  const id = uuid();
  const now = Date.now();
  stmt(
    `INSERT INTO donation
      (id, source, is_test, external_id, donor_name, donor_id, message, amount, currency,
       stream_session_id, stream_elements_activity_id, status, error, raw, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.source ?? null,
    data.isTest ? 1 : 0,
    data.externalId ?? null,
    data.donorName ?? null,
    data.donorId ?? '',
    data.message ?? '',
    data.amount ?? 0,
    data.currency ?? 'RUB',
    data.streamSessionId ?? null,
    data.streamElementsActivityId ?? null,
    data.status ?? 'pending',
    data.error ?? null,
    data.raw !== undefined && data.raw !== null ? JSON.stringify(data.raw) : null,
    now,
    now
  );
  return findById(id);
}

/**
 * Частичное обновление (camelCase-ключи) + возвращает обновлённый документ.
 */
function update(id, patch) {
  updateById('donation', id, patch);
  return findById(id);
}

module.exports = {
  create,
  update,
  findById,
  findOneByExternalId,
  findMany,
  getSentTotals,
  getTopDonors,
};
