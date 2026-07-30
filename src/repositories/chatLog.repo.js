'use strict';

const { stmt, uuid, mapRows } = require('./base');

const MAP_OPTS = {};

/**
 * Вставка сообщения. Возвращает созданный id.
 */
function insert(data) {
  const id = uuid();
  const now = Date.now();
  stmt(
    `INSERT INTO chat_log (id, user, display_name, message, stream_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.user ?? null,
    data.displayName ?? null,
    data.message ?? null,
    data.streamSessionId ?? null,
    now,
    now
  );
  return id;
}

/**
 * Последние сообщения, отсортированные от новых к старым.
 * streamFilter задаётся через streamSessionId (null = за всё время).
 */
function findRecent({ streamSessionId = null, limit = 10 } = {}) {
  const rows = streamSessionId
    ? stmt('SELECT * FROM chat_log WHERE stream_session_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(streamSessionId, limit)
    : stmt('SELECT * FROM chat_log ORDER BY created_at DESC LIMIT ?')
        .all(limit);
  return mapRows(rows, MAP_OPTS);
}

/**
 * Последние сообщения конкретного пользователя, от новых к старым.
 */
function findRecentByUser(user, limit = 50) {
  return mapRows(
    stmt('SELECT * FROM chat_log WHERE user = ? ORDER BY created_at DESC LIMIT ?').all(user, limit),
    MAP_OPTS
  );
}

/**
 * Количество сообщений с заданного момента (since — epoch-ms).
 */
function countSince({ streamSessionId = null, since = null } = {}) {
  if (streamSessionId && since !== null) {
    return stmt('SELECT COUNT(*) AS c FROM chat_log WHERE stream_session_id = ? AND created_at >= ?')
      .get(streamSessionId, since).c;
  }
  if (streamSessionId) {
    return stmt('SELECT COUNT(*) AS c FROM chat_log WHERE stream_session_id = ?')
      .get(streamSessionId).c;
  }
  if (since !== null) {
    return stmt('SELECT COUNT(*) AS c FROM chat_log WHERE created_at >= ?').get(since).c;
  }
  return stmt('SELECT COUNT(*) AS c FROM chat_log').get().c;
}

function countAll() {
  return stmt('SELECT COUNT(*) AS c FROM chat_log').get().c;
}

/**
 * Количество сообщений в диапазоне [since, until] — для подсчёта messagesCount
 * при завершении стрима. until может быть null (открытый конец).
 */
function countBetween(since, until) {
  if (since !== null && until !== null) {
    return stmt('SELECT COUNT(*) AS c FROM chat_log WHERE created_at >= ? AND created_at <= ?').get(since, until).c;
  }
  if (since !== null) {
    return stmt('SELECT COUNT(*) AS c FROM chat_log WHERE created_at >= ?').get(since).c;
  }
  return countAll();
}

/**
 * Количество уникальных пользователей с заданного момента.
 */
function distinctUsersSince({ streamSessionId = null, since = null } = {}) {
  if (streamSessionId && since !== null) {
    return stmt('SELECT COUNT(DISTINCT user) AS c FROM chat_log WHERE stream_session_id = ? AND created_at >= ?')
      .get(streamSessionId, since).c;
  }
  if (streamSessionId) {
    return stmt('SELECT COUNT(DISTINCT user) AS c FROM chat_log WHERE stream_session_id = ?').get(streamSessionId).c;
  }
  if (since !== null) {
    return stmt('SELECT COUNT(DISTINCT user) AS c FROM chat_log WHERE created_at >= ?').get(since).c;
  }
  return stmt('SELECT COUNT(DISTINCT user) AS c FROM chat_log').get().c;
}

function countDistinctUsers() {
  return stmt('SELECT COUNT(DISTINCT user) AS c FROM chat_log').get().c;
}

/**
 * Топ-чаттеры по числу сообщений (агр. #1).
 * Возвращает массив { user, displayName, messagesCount, lastMessageAt }.
 */
function getTopChatters({ streamSessionId = null, limit = 20 } = {}) {
  const rows = streamSessionId
    ? stmt(
        `SELECT user,
                MAX(display_name) AS display_name,
                COUNT(*)          AS messages_count,
                MAX(created_at)   AS last_message_at
         FROM chat_log WHERE stream_session_id = ?
         GROUP BY user
         ORDER BY messages_count DESC, last_message_at DESC
         LIMIT ?`
      ).all(streamSessionId, limit)
    : stmt(
        `SELECT user,
                MAX(display_name) AS display_name,
                COUNT(*)          AS messages_count,
                MAX(created_at)   AS last_message_at
         FROM chat_log
         GROUP BY user
         ORDER BY messages_count DESC, last_message_at DESC
         LIMIT ?`
      ).all(limit);

  return rows.map((r) => ({
    _id: r.user,
    displayName: r.display_name,
    messagesCount: r.messages_count,
    lastMessageAt: r.last_message_at,
  }));
}

/**
 * Сводка по одному пользователю за всё время (агр. #4).
 * streams — COUNT(DISTINCT stream_session_id) (NULL игнорируется SQL).
 */
function getUserLifetimeStats(user) {
  const row = stmt(
    `SELECT user,
            MAX(display_name)            AS display_name,
            COUNT(*)                     AS total_messages,
            MIN(created_at)              AS first_message_at,
            MAX(created_at)              AS last_message_at,
            COUNT(DISTINCT stream_session_id) AS streams
     FROM chat_log WHERE user = ?`
  ).get(user);

  if (!row || !row.total_messages) {
    return null;
  }

  return {
    _id: row.user,
    displayName: row.display_name,
    totalMessages: row.total_messages,
    firstMessageAt: row.first_message_at,
    lastMessageAt: row.last_message_at,
    streams: row.streams,
  };
}

/**
 * Часовая активность пользователя (агр. #6): GROUP BY час дня (UTC), 0..23.
 * Возвращает массив { _id: hour, count }.
 */
function getUserHourlyActivity(user) {
  const rows = stmt(
    `SELECT CAST(strftime('%H', created_at / 1000, 'unixepoch') AS INTEGER) AS hour,
            COUNT(*) AS count
     FROM chat_log WHERE user = ?
     GROUP BY hour ORDER BY hour ASC`
  ).all(user);
  return rows.map((r) => ({ _id: r.hour, count: r.count }));
}

/**
 * Дневная активность пользователя (агр. #7): GROUP BY день недели (0=Вс..6=Сб).
 * Возвращает массив { _id: dow, count }. dow приведён к нотации Mongo (1=Вс).
 */
function getUserWeeklyActivity(user) {
  const rows = stmt(
    `SELECT CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER) AS dow,
            COUNT(*) AS count
     FROM chat_log WHERE user = ?
     GROUP BY dow ORDER BY dow ASC`
  ).all(user);
  // SQLite %w: 0=Вс..6=Сб; Mongo $dayOfWeek: 1=Вс..7=Сб. Код потребителя делает dailyMap[d._id - 1].
  return rows.map((r) => ({ _id: r.dow + 1, count: r.count }));
}

/**
 * Глобальный ранг пользователя по числу сообщений (агр. #8).
 * Возвращает 1-индекс ранга или null, если пользователь не найден.
 */
function getUserRank(user) {
  const row = stmt(
    `SELECT COUNT(*) + 1 AS rank
     FROM (SELECT user, COUNT(*) AS c FROM chat_log GROUP BY user)
     WHERE c > (SELECT COUNT(*) FROM chat_log WHERE user = ?)`
  ).get(user);
  if (!row || !row.rank) {
    return null;
  }
  // Если у пользователя 0 сообщений, ранг не определён.
  const userCount = stmt('SELECT COUNT(*) AS c FROM chat_log WHERE user = ?').get(user).c;
  return userCount > 0 ? row.rank : null;
}

module.exports = {
  insert,
  findRecent,
  findRecentByUser,
  countSince,
  countAll,
  countBetween,
  distinctUsersSince,
  countDistinctUsers,
  getTopChatters,
  getUserLifetimeStats,
  getUserHourlyActivity,
  getUserWeeklyActivity,
  getUserRank,
};
