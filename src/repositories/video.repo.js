'use strict';

const { stmt, uuid, mapRow, mapRows, updateById, db } = require('./base');

const MAP_OPTS = { boolFields: ['is_paid', 'is_vertical'], jsonFields: ['co_requesters', 'embed'] };
const FINISHED = "('played', 'skipped', 'failed', 'removed')";

function mapRequest(row) {
  return mapRow(row, MAP_OPTS);
}

// --- settings (key/value JSON) ---

function getSettingsValue(key = 'primary') {
  const row = stmt('SELECT value FROM video_settings WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch (_) { return null; }
}

function saveSettingsValue(value, key = 'primary') {
  stmt(`INSERT INTO video_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), Date.now());
}

// --- requests ---

function intOrNull(value) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : Math.round(n);
}

function createRequest(data) {
  const now = Date.now();
  const id = uuid();
  stmt(`INSERT INTO video_request (
    id, provider, external_id, kind, title, author, channel_id, duration_sec, thumbnail, url, embed,
    is_vertical, view_count, published_at, requested_by, requested_by_display, requested_by_id, message_id,
    co_requesters, source, is_paid, amount, currency, amount_rub, donation_id, start_sec, play_limit_sec,
    position, status, status_reason, created_at, started_at, finished_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    data.provider,
    String(data.externalId),
    data.kind || 'video',
    String(data.title || '').slice(0, 300) || 'Без названия',
    data.author ? String(data.author).slice(0, 200) : null,
    data.channelId ? String(data.channelId) : null,
    intOrNull(data.durationSec),
    data.thumbnail || null,
    data.url || null,
    data.embed ? JSON.stringify(data.embed) : null,
    data.isVertical ? 1 : 0,
    intOrNull(data.viewCount),
    intOrNull(data.publishedAt),
    String(data.requestedBy || '').toLowerCase(),
    data.requestedByDisplay || data.requestedBy || null,
    data.requestedById || null,
    data.messageId || null,
    JSON.stringify(Array.isArray(data.coRequesters) ? data.coRequesters : []),
    data.source,
    data.isPaid ? 1 : 0,
    data.amount ?? null,
    data.currency ?? null,
    data.amountRub ?? null,
    data.donationId ?? null,
    Math.max(0, Math.round(Number(data.startSec) || 0)),
    data.playLimitSec ?? null,
    Number(data.position) || 0,
    data.status || 'queued',
    data.statusReason || null,
    now,
    data.startedAt ?? null,
    null,
    now,
  );
  return findById(id);
}

function findById(id) {
  return mapRequest(stmt('SELECT * FROM video_request WHERE id = ?').get(id));
}

function findByDonationId(donationId) {
  return mapRequest(stmt('SELECT * FROM video_request WHERE donation_id = ?').get(String(donationId)));
}

function updateRequest(id, patch) {
  updateById('video_request', id, patch);
  return findById(id);
}

/** Очередь без играющего видео, по позиции. */
function findQueued() {
  return mapRows(stmt("SELECT * FROM video_request WHERE status = 'queued' ORDER BY position ASC, created_at ASC").all(), MAP_OPTS);
}

function findAllPlaying() {
  return mapRows(stmt("SELECT * FROM video_request WHERE status = 'playing'").all(), MAP_OPTS);
}

function countActiveByRequester(login, isPaid) {
  const row = stmt(`SELECT COUNT(*) AS count FROM video_request
    WHERE lower(requested_by) = lower(?) AND is_paid = ? AND status IN ('queued', 'playing')`)
    .get(String(login), isPaid ? 1 : 0);
  return row ? row.count : 0;
}

function findActiveByItem(provider, externalId) {
  return mapRequest(stmt(`SELECT * FROM video_request
    WHERE provider = ? AND external_id = ? AND status IN ('queued', 'playing') ORDER BY created_at ASC LIMIT 1`)
    .get(provider, String(externalId)));
}

/** Было ли видео уже показано (для фильтра «только новые»). */
function wasPlayed(provider, externalId) {
  return Boolean(stmt("SELECT 1 FROM video_request WHERE provider = ? AND external_id = ? AND status IN ('played', 'skipped') LIMIT 1")
    .get(provider, String(externalId)));
}

/** Активная заявка, к которой относится сообщение чата (основное или «тоже хочу»). */
function findActiveByMessageId(messageId) {
  const id = String(messageId || '');
  if (!id) return null;
  const direct = mapRequest(stmt("SELECT * FROM video_request WHERE message_id = ? AND status IN ('queued', 'playing') LIMIT 1").get(id));
  if (direct) return direct;
  const like = `%"messageId":${JSON.stringify(id)}%`;
  return mapRequest(stmt("SELECT * FROM video_request WHERE co_requesters LIKE ? AND status IN ('queued', 'playing') LIMIT 1").get(like));
}

function findHistory({ limit = 50, offset = 0 } = {}) {
  return mapRows(stmt(`SELECT * FROM video_request WHERE status IN ${FINISHED} ORDER BY COALESCE(finished_at, updated_at) DESC LIMIT ? OFFSET ?`).all(limit, offset), MAP_OPTS);
}

function countHistory() {
  return stmt(`SELECT COUNT(*) AS count FROM video_request WHERE status IN ${FINISHED}`).get().count;
}

function clearHistory() {
  stmt(`DELETE FROM video_request WHERE status IN ${FINISHED}`).run();
}

/** Переписывает позиции очереди в заданном порядке (1..n). */
const applyOrder = (ids) => db.transaction((list) => {
  const update = stmt("UPDATE video_request SET position = ?, updated_at = ? WHERE id = ? AND status = 'queued'");
  const now = Date.now();
  list.forEach((id, index) => update.run(index + 1, now, id));
})(ids);

/** Снимает с очереди все заявки (кнопка «Очистить очередь»). */
function clearQueue(reason = 'cleared') {
  stmt("UPDATE video_request SET status = 'removed', status_reason = ?, finished_at = ?, updated_at = ? WHERE status = 'queued'")
    .run(reason, Date.now(), Date.now());
}

// --- blacklists ---

function listBlacklistedItems() {
  return mapRows(stmt('SELECT * FROM video_blacklist_item ORDER BY created_at DESC').all());
}

function isItemBlacklisted(provider, externalId) {
  return Boolean(stmt('SELECT 1 FROM video_blacklist_item WHERE provider = ? AND external_id = ?').get(provider, String(externalId)));
}

function addBlacklistedItem({ provider, externalId, title }) {
  stmt(`INSERT INTO video_blacklist_item (provider, external_id, title, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(provider, external_id) DO UPDATE SET title = excluded.title`)
    .run(provider, String(externalId), title || null, Date.now());
}

function removeBlacklistedItem(provider, externalId) {
  stmt('DELETE FROM video_blacklist_item WHERE provider = ? AND external_id = ?').run(provider, String(externalId));
}

function listBlacklistedUsers() {
  return mapRows(stmt('SELECT * FROM video_blacklist_user ORDER BY login ASC').all());
}

function isUserBlacklisted(login) {
  return Boolean(stmt('SELECT 1 FROM video_blacklist_user WHERE login = ?').get(String(login || '').toLowerCase()));
}

function addBlacklistedUser(login) {
  stmt('INSERT OR IGNORE INTO video_blacklist_user (login, created_at) VALUES (?, ?)').run(String(login).toLowerCase(), Date.now());
}

function removeBlacklistedUser(login) {
  stmt('DELETE FROM video_blacklist_user WHERE login = ?').run(String(login).toLowerCase());
}

function listBlacklistedChannels() {
  return mapRows(stmt('SELECT * FROM video_blacklist_channel ORDER BY created_at DESC').all());
}

function isChannelBlacklisted(provider, channelId) {
  if (!channelId) return false;
  return Boolean(stmt('SELECT 1 FROM video_blacklist_channel WHERE provider = ? AND channel_id = ?').get(provider, String(channelId)));
}

function addBlacklistedChannel({ provider, channelId, name }) {
  stmt(`INSERT INTO video_blacklist_channel (provider, channel_id, name, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(provider, channel_id) DO UPDATE SET name = excluded.name`)
    .run(provider, String(channelId), name || null, Date.now());
}

function removeBlacklistedChannel(provider, channelId) {
  stmt('DELETE FROM video_blacklist_channel WHERE provider = ? AND channel_id = ?').run(provider, String(channelId));
}

module.exports = {
  getSettingsValue,
  saveSettingsValue,
  createRequest,
  findById,
  findByDonationId,
  updateRequest,
  findQueued,
  findAllPlaying,
  countActiveByRequester,
  findActiveByItem,
  wasPlayed,
  findActiveByMessageId,
  findHistory,
  countHistory,
  clearHistory,
  applyOrder,
  clearQueue,
  listBlacklistedItems,
  isItemBlacklisted,
  addBlacklistedItem,
  removeBlacklistedItem,
  listBlacklistedUsers,
  isUserBlacklisted,
  addBlacklistedUser,
  removeBlacklistedUser,
  listBlacklistedChannels,
  isChannelBlacklisted,
  addBlacklistedChannel,
  removeBlacklistedChannel,
};
