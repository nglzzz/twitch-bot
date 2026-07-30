'use strict';

const { stmt, uuid, toEpochMs, mapRow, mapRows } = require('./base');

const MAP_OPTS = { jsonFields: ['raw'] };

function findOneByEventId(eventId) {
  const row = stmt('SELECT * FROM meme_log WHERE event_id = ? LIMIT 1').get(eventId);
  return mapRow(row, MAP_OPTS);
}

function count({ streamSessionId = null } = {}) {
  if (streamSessionId) {
    return stmt('SELECT COUNT(*) AS c FROM meme_log WHERE stream_session_id = ?').get(streamSessionId).c;
  }
  return stmt('SELECT COUNT(*) AS c FROM meme_log').get().c;
}

function countAll() {
  return stmt('SELECT COUNT(*) AS c FROM meme_log').get().c;
}

function findRecent({ streamSessionId = null, limit = 15 } = {}) {
  const rows = streamSessionId
    ? stmt('SELECT * FROM meme_log WHERE stream_session_id = ? ORDER BY sent_at DESC LIMIT ?').all(streamSessionId, limit)
    : stmt('SELECT * FROM meme_log ORDER BY sent_at DESC LIMIT ?').all(limit);
  return mapRows(rows, MAP_OPTS);
}

/**
 * Топ-мемеров по числу отправленных мемов (агр. #2).
 */
function getTopMemers({ streamSessionId = null, limit = 10 } = {}) {
  const rows = streamSessionId
    ? stmt(
        `SELECT user,
                MAX(user_alias) AS user_alias,
                COUNT(*)        AS memes_count,
                MAX(sent_at)    AS last_meme_at
         FROM meme_log WHERE stream_session_id = ?
         GROUP BY user ORDER BY memes_count DESC, last_meme_at DESC LIMIT ?`
      ).all(streamSessionId, limit)
    : stmt(
        `SELECT user,
                MAX(user_alias) AS user_alias,
                COUNT(*)        AS memes_count,
                MAX(sent_at)    AS last_meme_at
         FROM meme_log
         GROUP BY user ORDER BY memes_count DESC, last_meme_at DESC LIMIT ?`
      ).all(limit);

  return rows.map((r) => ({
    _id: r.user,
    userAlias: r.user_alias,
    memesCount: r.memes_count,
    lastMemeAt: r.last_meme_at,
  }));
}

/**
 * Топ-мемов (стикеров) по числу использований (агр. #3).
 */
function getTopMemes({ streamSessionId = null, limit = 10 } = {}) {
  const rows = streamSessionId
    ? stmt(
        `SELECT sticker_name,
                COUNT(*)     AS usage_count,
                MAX(sent_at) AS last_used_at
         FROM meme_log WHERE stream_session_id = ?
         GROUP BY sticker_name ORDER BY usage_count DESC, last_used_at DESC LIMIT ?`
      ).all(streamSessionId, limit)
    : stmt(
        `SELECT sticker_name,
                COUNT(*)     AS usage_count,
                MAX(sent_at) AS last_used_at
         FROM meme_log
         GROUP BY sticker_name ORDER BY usage_count DESC, last_used_at DESC LIMIT ?`
      ).all(limit);

  return rows.map((r) => ({
    _id: r.sticker_name,
    stickerName: r.sticker_name,
    usageCount: r.usage_count,
    lastUsedAt: r.last_used_at,
  }));
}

/**
 * Сводка по мемам одного пользователя (агр. #5): всего, первый/последний, топ-стикеры.
 */
function getUserMemeStats(user) {
  const totals = stmt(
    `SELECT COUNT(*)     AS total_memes,
            MIN(sent_at) AS first_meme_at,
            MAX(sent_at) AS last_meme_at
     FROM meme_log WHERE user = ?`
  ).get(user);

  if (!totals || !totals.total_memes) {
    return null;
  }

  const top = stmt(
    `SELECT sticker_name, COUNT(*) AS cnt
     FROM meme_log WHERE user = ?
     GROUP BY sticker_name ORDER BY cnt DESC LIMIT 5`
  ).all(user).map((r) => ({ stickerName: r.sticker_name, count: r.cnt }));

  return {
    totalMemes: totals.total_memes,
    firstMemeAt: totals.first_meme_at,
    lastMemeAt: totals.last_meme_at,
    topMemes: top,
  };
}

function insert(data) {
  const id = uuid();
  const now = Date.now();
  stmt(
    `INSERT INTO meme_log
      (id, event_id, user, user_alias, sticker_name, kind, sent_at, stream_session_id, raw, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.eventId ?? null,
    data.user ?? null,
    data.userAlias ?? null,
    data.stickerName ?? null,
    data.kind ?? null,
    toEpochMs(data.sentAt) || now,
    data.streamSessionId ?? null,
    data.raw !== undefined && data.raw !== null ? JSON.stringify(data.raw) : null,
    now,
    now
  );
  return id;
}

module.exports = {
  insert,
  findOneByEventId,
  count,
  countAll,
  findRecent,
  getTopMemers,
  getTopMemes,
  getUserMemeStats,
};
