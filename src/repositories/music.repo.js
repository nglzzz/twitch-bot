'use strict';

const { stmt, uuid, mapRow, mapRows, updateById, db } = require('./base');

const MAP_OPTS = { boolFields: ['is_paid'] };
const ACTIVE_STATUSES = ['queued', 'playing'];

function mapRequest(row) {
  return mapRow(row, MAP_OPTS);
}

// --- settings (key/value JSON) ---

function getSettingsValue(key = 'primary') {
  const row = stmt('SELECT value FROM music_settings WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch (_) { return null; }
}

function saveSettingsValue(value, key = 'primary') {
  stmt(`INSERT INTO music_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), Date.now());
}

// --- requests ---

function createRequest(data) {
  const now = Date.now();
  const id = uuid();
  stmt(`INSERT INTO music_request (
    id, provider, external_id, title, author, duration_sec, thumbnail, url,
    requested_by, requested_by_display, requested_by_id, source, is_paid,
    amount, currency, amount_rub, donation_id, start_sec, play_limit_sec,
    position, status, status_reason, created_at, started_at, finished_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    data.provider,
    data.externalId,
    String(data.title || '').slice(0, 300),
    data.author || null,
    Math.max(0, Math.round(Number(data.durationSec) || 0)),
    data.thumbnail || null,
    data.url || null,
    String(data.requestedBy || '').toLowerCase(),
    data.requestedByDisplay || data.requestedBy || null,
    data.requestedById || null,
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
  return mapRequest(stmt('SELECT * FROM music_request WHERE id = ?').get(id));
}

function findByDonationId(donationId) {
  return mapRequest(stmt('SELECT * FROM music_request WHERE donation_id = ?').get(String(donationId)));
}

function updateRequest(id, patch) {
  updateById('music_request', id, patch);
  return findById(id);
}

/** Очередь без играющего трека, по позиции. */
function findQueued() {
  return mapRows(stmt("SELECT * FROM music_request WHERE status = 'queued' ORDER BY position ASC, created_at ASC").all(), MAP_OPTS);
}

function findPlaying() {
  return mapRequest(stmt("SELECT * FROM music_request WHERE status = 'playing' ORDER BY started_at DESC LIMIT 1").get());
}

function findAllPlaying() {
  return mapRows(stmt("SELECT * FROM music_request WHERE status = 'playing'").all(), MAP_OPTS);
}

function countActiveByRequester(login, isPaid) {
  const row = stmt(`SELECT COUNT(*) AS count FROM music_request
    WHERE lower(requested_by) = lower(?) AND is_paid = ? AND status IN ('queued', 'playing') AND source != 'backup'`)
    .get(String(login), isPaid ? 1 : 0);
  return row ? row.count : 0;
}

function findActiveByTrack(provider, externalId) {
  return mapRequest(stmt(`SELECT * FROM music_request
    WHERE provider = ? AND external_id = ? AND status IN ('queued', 'playing') AND source != 'backup' LIMIT 1`)
    .get(provider, externalId));
}

function maxQueuedPosition() {
  const row = stmt("SELECT MAX(position) AS position FROM music_request WHERE status = 'queued'").get();
  return row && row.position !== null ? row.position : 0;
}

function findHistory({ limit = 50, offset = 0, includeBackup = true } = {}) {
  const sql = includeBackup
    ? "SELECT * FROM music_request WHERE status IN ('played', 'skipped', 'failed', 'removed') ORDER BY COALESCE(finished_at, updated_at) DESC LIMIT ? OFFSET ?"
    : "SELECT * FROM music_request WHERE status IN ('played', 'skipped', 'failed', 'removed') AND source != 'backup' ORDER BY COALESCE(finished_at, updated_at) DESC LIMIT ? OFFSET ?";
  return mapRows(stmt(sql).all(limit, offset), MAP_OPTS);
}

function countHistory({ includeBackup = true } = {}) {
  const sql = includeBackup
    ? "SELECT COUNT(*) AS count FROM music_request WHERE status IN ('played', 'skipped', 'failed', 'removed')"
    : "SELECT COUNT(*) AS count FROM music_request WHERE status IN ('played', 'skipped', 'failed', 'removed') AND source != 'backup'";
  return stmt(sql).get().count;
}

/** Переписывает позиции очереди в заданном порядке (1..n). */
const applyOrder = (ids) => db.transaction((list) => {
  const update = stmt("UPDATE music_request SET position = ?, updated_at = ? WHERE id = ? AND status = 'queued'");
  const now = Date.now();
  list.forEach((id, index) => update.run(index + 1, now, id));
})(ids);

// --- blacklists ---

function listBlacklistedTracks() {
  return mapRows(stmt('SELECT * FROM music_blacklist_track ORDER BY created_at DESC').all());
}

function isTrackBlacklisted(provider, externalId) {
  return Boolean(stmt('SELECT 1 FROM music_blacklist_track WHERE provider = ? AND external_id = ?').get(provider, externalId));
}

function addBlacklistedTrack({ provider, externalId, title }) {
  stmt(`INSERT INTO music_blacklist_track (provider, external_id, title, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(provider, external_id) DO UPDATE SET title = excluded.title`)
    .run(provider, externalId, title || null, Date.now());
}

function removeBlacklistedTrack(provider, externalId) {
  stmt('DELETE FROM music_blacklist_track WHERE provider = ? AND external_id = ?').run(provider, externalId);
}

function listBlacklistedUsers() {
  return mapRows(stmt('SELECT * FROM music_blacklist_user ORDER BY login ASC').all());
}

function isUserBlacklisted(login) {
  return Boolean(stmt('SELECT 1 FROM music_blacklist_user WHERE login = ?').get(String(login || '').toLowerCase()));
}

function addBlacklistedUser(login) {
  stmt('INSERT OR IGNORE INTO music_blacklist_user (login, created_at) VALUES (?, ?)').run(String(login).toLowerCase(), Date.now());
}

function removeBlacklistedUser(login) {
  stmt('DELETE FROM music_blacklist_user WHERE login = ?').run(String(login).toLowerCase());
}

module.exports = {
  ACTIVE_STATUSES,
  getSettingsValue,
  saveSettingsValue,
  createRequest,
  findById,
  findByDonationId,
  updateRequest,
  findQueued,
  findPlaying,
  findAllPlaying,
  countActiveByRequester,
  findActiveByTrack,
  maxQueuedPosition,
  findHistory,
  countHistory,
  applyOrder,
  listBlacklistedTracks,
  isTrackBlacklisted,
  addBlacklistedTrack,
  removeBlacklistedTrack,
  listBlacklistedUsers,
  isUserBlacklisted,
  addBlacklistedUser,
  removeBlacklistedUser,
};
