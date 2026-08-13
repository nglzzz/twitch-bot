'use strict';

const { stmt, uuid, toEpochMs, mapRow, mapRows, updateById } = require('./base');

const MAP_OPTS = { boolFields: [] };

function _toCamelSession(row) {
  return mapRow(row, MAP_OPTS);
}

function findById(id) {
  const row = stmt('SELECT * FROM stream_session WHERE id = ?').get(id);
  return _toCamelSession(row);
}

function findOneLiveLatest() {
  // Сопоставляет StreamSession.findOne({ status: 'live' }).sort({ startedAt: -1 })
  const row = stmt("SELECT * FROM stream_session WHERE status = 'live' ORDER BY started_at DESC LIMIT 1").get();
  return _toCamelSession(row);
}

function findLatestId() {
  // Сопоставляет findOne({}).sort({ startedAt: -1 }).select('_id')
  const row = stmt('SELECT id FROM stream_session ORDER BY started_at DESC LIMIT 1').get();
  return row ? row.id : null;
}

function findRecent(limit) {
  // Сопоставляет find({}).sort({ startedAt: -1 }).limit(STREAMS_LIMIT)
  return mapRows(
    stmt('SELECT * FROM stream_session ORDER BY started_at DESC LIMIT ?').all(limit),
    MAP_OPTS
  );
}

function findPeakByViewers() {
  // Сопоставляет findOne({}).sort({ maxViewers: -1 })
  const row = stmt('SELECT * FROM stream_session ORDER BY max_viewers DESC LIMIT 1').get();
  return _toCamelSession(row);
}

function countAll() {
  return stmt('SELECT COUNT(*) AS c FROM stream_session').get().c;
}

/**
 * Средняя длительность завершённых стримов в миллисекундах.
 * Сопоставляет aggregate $subtract/$avg по endedAt-startedAt.
 * @returns {number|null}
 */
function avgDurationMs() {
  const row = stmt(
    "SELECT AVG(ended_at - started_at) AS avg FROM stream_session "
    + "WHERE status = 'ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL"
  ).get();
  const v = row && row.avg;
  return v === null || v === undefined ? null : v;
}

/**
 * Создаёт новую сессию стрима. Возвращает созданный документ (camelCase, с _id).
 */
function create(data) {
  const id = uuid();
  const now = Date.now();
  const startedAt = toEpochMs(data.startedAt) || now;
  stmt(
    `INSERT INTO stream_session
      (id, stream_id, title, game_name, started_at, ended_at, status, last_seen_at,
       max_viewers, avg_viewers, viewer_snapshot_count, viewer_snapshot_sum,
       unique_viewers, messages_count, unique_chatters, memes_count,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`
  ).run(
    id,
    data.streamId ?? null,
    data.title ?? null,
    data.gameName ?? null,
    startedAt,
    data.status ?? 'live',
    toEpochMs(data.lastSeenAt) || now,
    now,
    now
  );
  return findById(id);
}

/**
 * Обновляет произвольные поля сессии (camelCase-ключи).
 */
function update(id, patch) {
  updateById('stream_session', id, patch);
  return findById(id);
}

/**
 * Инкрементальная статистика зрителей — эквивалент метода экземпляра
 * streamSession.updateViewers(currentCount): обновляет счётчик/сумму/макс/среднее
 * и lastSeenAt одним атомарным UPDATE.
 */
function applyViewerUpdate(id, currentCount) {
  const now = Date.now();
  stmt(
    `UPDATE stream_session SET
       viewer_snapshot_count = viewer_snapshot_count + 1,
       viewer_snapshot_sum   = viewer_snapshot_sum + ?,
       max_viewers           = MAX(max_viewers, ?),
       avg_viewers           = CAST(ROUND((viewer_snapshot_sum + ?) * 1.0 / (viewer_snapshot_count + 1)) AS INTEGER),
       last_seen_at          = ?,
       updated_at            = ?
     WHERE id = ?`
  ).run(currentCount, currentCount, currentCount, now, now, id);
}

module.exports = {
  findById,
  findOneLiveLatest,
  findLatestId,
  findRecent,
  findPeakByViewers,
  countAll,
  avgDurationMs,
  create,
  update,
  applyViewerUpdate,
};
