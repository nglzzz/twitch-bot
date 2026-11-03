'use strict';

const { db, stmt, uuid } = require('./base');

const GAME_MODES = new Set(['quiz', 'anagram', 'game', 'movie']);
const IDENTITY_FIELDS = `user_id AS userId, username, display_name AS displayName,
  first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, followed_at AS followedAt,
  avatar_url AS avatarUrl, avatar_checked_at AS avatarCheckedAt,
  current_followed_at AS currentFollowedAt, follow_status AS followStatus,
  follow_checked_at AS followCheckedAt, identity_checked_at AS identityCheckedAt`;

function achievementService() {
  return require('../services/achievements.service');
}

function normalizeLogin(value) {
  const login = String(value || '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(login) ? login : null;
}

function normalizeUser(data) {
  const userId = String(data.userId || '').trim();
  const username = normalizeLogin(data.username);
  const displayName = String(data.displayName || '').trim().slice(0, 100) || username;
  if (!userId || userId.length > 64 || !username || !displayName) return null;
  return { userId, username, displayName };
}

function toTimestamp(value, fallback = Date.now()) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim() && !Number.isFinite(Number(value))) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function upsertUser(user, timestamp, followedAt = null) {
  stmt(`INSERT INTO community_user
    (user_id, username, display_name, first_seen_at, last_seen_at, followed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username = CASE WHEN excluded.last_seen_at >= MAX(community_user.last_seen_at, COALESCE(community_user.identity_checked_at, 0)) THEN excluded.username ELSE community_user.username END,
      display_name = CASE WHEN excluded.last_seen_at >= MAX(community_user.last_seen_at, COALESCE(community_user.identity_checked_at, 0)) THEN excluded.display_name ELSE community_user.display_name END,
      first_seen_at = MIN(community_user.first_seen_at, excluded.first_seen_at),
      last_seen_at = MAX(community_user.last_seen_at, excluded.last_seen_at),
      followed_at = CASE
        WHEN community_user.followed_at IS NULL THEN excluded.followed_at
        WHEN excluded.followed_at IS NULL THEN community_user.followed_at
        ELSE MIN(community_user.followed_at, excluded.followed_at)
      END,
      updated_at = MAX(community_user.updated_at, excluded.updated_at)`)
    .run(user.userId, user.username, user.displayName, timestamp, timestamp, followedAt, timestamp, timestamp);
}

function prepareUserForEvent(data, timestamp = Date.now()) {
  const user = normalizeUser(data);
  if (!user) throw new TypeError('A Twitch user ID and valid username are required');
  upsertUser(user, toTimestamp(timestamp));
  achievementService().seedBaseline(user.userId);
  return user;
}

function recordChat({
  userId,
  username,
  displayName,
  message,
  messageId = null,
  streamSessionId = null,
  createdAt = Date.now(),
} = {}) {
  const login = normalizeLogin(username);
  if (!login || typeof message !== 'string' || !message.trim()) {
    throw new TypeError('A valid username and message are required');
  }

  const identity = normalizeUser({ userId, username: login, displayName: displayName || login });
  const timestamp = toTimestamp(createdAt);
  const safeMessageId = messageId ? String(messageId).slice(0, 128) : null;

  const save = db.transaction(() => {
    if (safeMessageId && stmt('SELECT 1 FROM chat_log WHERE message_id = ?').get(safeMessageId)) {
      return { inserted: false, userId: identity ? identity.userId : null };
    }
    if (identity) prepareUserForEvent(identity, timestamp);
    const result = stmt(`INSERT OR IGNORE INTO chat_log
      (id, user, user_id, message_id, display_name, message, stream_session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), login, identity ? identity.userId : null, safeMessageId,
        String(displayName || login).slice(0, 100), message, streamSessionId || null, timestamp, timestamp);

    if (result.changes && identity) achievementService().evaluateUser(identity.userId);
    return { inserted: Boolean(result.changes), userId: identity ? identity.userId : null };
  });

  return save();
}

function recordFollow({ userId, username, displayName, followedAt = Date.now() } = {}) {
  const user = normalizeUser({ userId, username, displayName });
  if (!user) throw new TypeError('A Twitch user ID and valid username are required');
  const timestamp = toTimestamp(followedAt);
  // Replayed follows must retain their event time: using receipt time would
  // let a former login owner displace its current owner in identity lookups.
  const save = db.transaction(() => {
    prepareUserForEvent(user, timestamp);
    upsertUser(user, timestamp, timestamp);
    setFollowState({ userId: user.userId, isFollowing: true, followedAt: timestamp, checkedAt: timestamp });
  });
  save();
  return findIdentityById(user.userId);
}

function recordQuizWin({ userId, username, displayName, mode, streamId = null, createdAt = Date.now() } = {}) {
  const user = normalizeUser({ userId, username, displayName });
  if (!user) throw new TypeError('A Twitch user ID and valid username are required');
  const normalizedMode = String(mode || '').toLowerCase();
  if (!GAME_MODES.has(normalizedMode)) throw new TypeError('Unsupported game mode');

  const timestamp = toTimestamp(createdAt);
  const save = db.transaction(() => {
    prepareUserForEvent(user, timestamp);
    stmt(`INSERT INTO community_game_win (id, user_id, mode, stream_id, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(uuid(), user.userId, normalizedMode, streamId ? String(streamId) : null, timestamp);
    achievementService().evaluateUser(user.userId);
  });
  save();
}

function findIdentityByLogin(login) {
  const username = normalizeLogin(login);
  if (!username) return null;
  return stmt(`SELECT ${IDENTITY_FIELDS}
    FROM community_user WHERE username = ? COLLATE NOCASE
    ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC LIMIT 1`).get(username) || null;
}

function findIdentityById(userId) {
  if (!userId) return null;
  return stmt(`SELECT ${IDENTITY_FIELDS} FROM community_user WHERE user_id = ?`).get(String(userId)) || null;
}

function safeAvatarUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url.hostname === 'jtvnw.net' || url.hostname.endsWith('.jtvnw.net') ? url.href : null;
  } catch (_) { return null; }
}

function updateTwitchUser({ userId, username, displayName, avatarUrl, checkedAt = Date.now() }) {
  const user = normalizeUser({ userId, username, displayName });
  if (!user) throw new TypeError('A valid Twitch identity is required');
  const timestamp = toTimestamp(checkedAt);
  db.transaction(() => {
    stmt(`INSERT INTO community_user (user_id, username, display_name, first_seen_at, last_seen_at,
        avatar_url, avatar_checked_at, identity_checked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = CASE WHEN excluded.identity_checked_at >= MAX(community_user.last_seen_at, COALESCE(community_user.identity_checked_at, 0)) THEN excluded.username ELSE community_user.username END,
        display_name = CASE WHEN excluded.identity_checked_at >= MAX(community_user.last_seen_at, COALESCE(community_user.identity_checked_at, 0)) THEN excluded.display_name ELSE community_user.display_name END,
        avatar_url = CASE WHEN excluded.avatar_checked_at >= COALESCE(community_user.avatar_checked_at, 0) THEN excluded.avatar_url ELSE community_user.avatar_url END,
        avatar_checked_at = MAX(COALESCE(community_user.avatar_checked_at, 0), excluded.avatar_checked_at),
        identity_checked_at = MAX(COALESCE(community_user.identity_checked_at, 0), excluded.identity_checked_at)`)
      .run(user.userId, user.username, user.displayName, timestamp, timestamp, safeAvatarUrl(avatarUrl), timestamp, timestamp, timestamp, timestamp);
    achievementService().seedBaseline(user.userId);
  })();
  return findIdentityById(user.userId);
}

function setFollowState({ userId, isFollowing, followedAt, checkedAt = Date.now(), historical = false }) {
  if (!findIdentityById(userId)) return null;
  const timestamp = toTimestamp(checkedAt);
  const startedAt = isFollowing ? (typeof followedAt === 'number' ? followedAt : Date.parse(followedAt)) : null;
  if (isFollowing && (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > timestamp)) {
    throw new TypeError('A valid confirmed follow date is required');
  }
  db.transaction(() => {
    achievementService().seedBaseline(userId);
    const result = stmt(`UPDATE community_user SET follow_status = ?, current_followed_at = ?,
        follow_checked_at = ?, followed_at = CASE
          WHEN ? IS NULL THEN followed_at
          WHEN followed_at IS NULL THEN ? ELSE MIN(followed_at, ?) END
      WHERE user_id = ? AND (follow_checked_at IS NULL OR follow_checked_at <= ?)`)
      .run(isFollowing ? 1 : 0, startedAt, timestamp, startedAt, startedAt, startedAt, String(userId), timestamp);
    if (result.changes) achievementService().evaluateUser(userId, { historical, notify: !historical, now: timestamp });
  })();
  return findIdentityById(userId);
}

function listDueFollowChecks({ before = Date.now() - 24 * 60 * 60 * 1000, limit = 10 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 10)));
  return stmt(`SELECT ${IDENTITY_FIELDS} FROM community_user
    WHERE follow_checked_at IS NULL OR follow_checked_at <= ?
    ORDER BY COALESCE(follow_checked_at, 0), user_id LIMIT ?`).all(Number(before), safeLimit);
}

function getMessageHistory({ userId = null, username, cursor = null, limit = 30 }) {
  const login = normalizeLogin(username);
  if (!login) return { messages: [], hasMore: false };
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 30)));
  const identityPredicate = userId
    ? '(c.user_id = ? OR (c.user_id IS NULL AND lower(c.user) = ?))'
    : '(c.user_id IS NULL AND lower(c.user) = ?)';
  const parameters = userId ? [String(userId), login] : [login];
  const cursorPredicate = cursor ? 'AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))' : '';
  if (cursor) parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
  const rows = stmt(`SELECT c.id, c.message AS text, c.created_at AS createdAt,
      s.title AS streamTitle
    FROM chat_log c LEFT JOIN stream_session s ON c.stream_session_id = s.id
    WHERE ${identityPredicate} ${cursorPredicate}
    ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(...parameters, safeLimit + 1);
  return { messages: rows.slice(0, safeLimit), hasMore: rows.length > safeLimit };
}

function findProfileIdentity(login) {
  const username = normalizeLogin(login);
  if (!username) return null;

  const user = findIdentityByLogin(username);
  if (user) return { ...user, source: 'community' };

  const quizUser = stmt(`SELECT user_id AS userId, username, display_name AS displayName,
      updated_at AS lastSeenAt
    FROM quiz_score WHERE username = ? COLLATE NOCASE LIMIT 1`).get(username);
  if (quizUser) {
    const currentUser = findIdentityById(quizUser.userId);
    if (currentUser) return { ...currentUser, source: 'community' };
    return { ...quizUser, firstSeenAt: null, followedAt: null, source: 'quiz' };
  }

  const legacyUser = stmt(`SELECT lower(user) AS username, MAX(display_name) AS display_name,
      MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
    FROM chat_log WHERE lower(user) = ? AND user_id IS NULL
    GROUP BY lower(user) LIMIT 1`).get(username);
  if (!legacyUser) return null;
  return {
    userId: null,
    username: legacyUser.username,
    displayName: legacyUser.display_name || legacyUser.username,
    firstSeenAt: legacyUser.first_seen_at,
    lastSeenAt: legacyUser.last_seen_at,
    followedAt: null,
    source: 'legacy-chat',
  };
}

function getChatStats({ userId = null, username } = {}) {
  const login = normalizeLogin(username);
  if (!login) return emptyChatStats();

  const predicate = userId ? '(user_id = ? OR (user_id IS NULL AND lower(user) = ?))' : '(user_id IS NULL AND lower(user) = ?)';
  const params = userId ? [String(userId), login] : [login];
  const row = stmt(`WITH matched_messages AS (
      SELECT stream_session_id, created_at, user_id FROM chat_log WHERE ${predicate}
    )
    SELECT COUNT(*) AS totalMessages,
      MIN(created_at) AS firstMessageAt,
      MAX(created_at) AS lastMessageAt,
      COUNT(DISTINCT stream_session_id) AS streamsAttended,
      COALESCE((SELECT MAX(message_count) FROM (
        SELECT COUNT(*) AS message_count FROM matched_messages
        WHERE stream_session_id IS NOT NULL GROUP BY stream_session_id
      )), 0) AS maxMessagesPerStream,
      SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS legacyMessages
    FROM matched_messages`).get(...params);

  return {
    totalMessages: Number(row.totalMessages) || 0,
    firstMessageAt: row.firstMessageAt || null,
    lastMessageAt: row.lastMessageAt || null,
    streamsAttended: Number(row.streamsAttended) || 0,
    maxMessagesPerStream: Number(row.maxMessagesPerStream) || 0,
    legacyMessages: Number(row.legacyMessages) || 0,
  };
}

function emptyChatStats() {
  return { totalMessages: 0, firstMessageAt: null, lastMessageAt: null, streamsAttended: 0, maxMessagesPerStream: 0, legacyMessages: 0 };
}

function getModeWins(userId) {
  if (!userId) return {};
  return stmt(`SELECT mode, COUNT(*) AS wins FROM community_game_win
    WHERE user_id = ? GROUP BY mode`).all(String(userId))
    .reduce((modes, row) => ({ ...modes, [row.mode]: Number(row.wins) }), {});
}

function getQuizScore(userId) {
  if (!userId) return 0;
  const row = stmt('SELECT points FROM quiz_score WHERE user_id = ?').get(String(userId));
  return row ? Number(row.points) || 0 : 0;
}

function getProfileRanks({ userId = null, username } = {}) {
  const login = normalizeLogin(username);
  if (!login) return { chatRank: null, gameRank: null };

  const gameRank = userId ? stmt(`WITH ranked_users AS (
      SELECT user_id, username,
        ROW_NUMBER() OVER (PARTITION BY lower(username) ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC) AS login_rank
      FROM community_user
    ), visible_scores AS (
      SELECT s.user_id, COALESCE(u.username, s.username) AS login, s.points
      FROM quiz_score s LEFT JOIN ranked_users u ON u.user_id = s.user_id
      WHERE (u.user_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM community_user owner WHERE lower(owner.username) = lower(s.username)
        )) OR u.login_rank = 1
    ), ranked_scores AS (
      SELECT user_id, ROW_NUMBER() OVER (ORDER BY points DESC, login COLLATE NOCASE ASC) AS position
      FROM visible_scores
    )
    SELECT position FROM ranked_scores WHERE user_id = ?`).get(String(userId)) : null;

  const chatRank = stmt(`WITH ranked_users AS (
      SELECT user_id, username, display_name,
        ROW_NUMBER() OVER (PARTITION BY lower(username) ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC) AS login_rank
      FROM community_user
    ), grouped AS (
      SELECT COALESCE(c.user_id, legacy_owner.user_id, 'legacy:' || lower(c.user)) AS profile_key,
        COALESCE(owner.username, legacy_owner.username, lower(c.user)) AS username,
        COUNT(*) AS score
      FROM chat_log c
      LEFT JOIN ranked_users owner ON c.user_id = owner.user_id AND owner.login_rank = 1
      LEFT JOIN ranked_users legacy_owner
        ON c.user_id IS NULL AND lower(c.user) = lower(legacy_owner.username) AND legacy_owner.login_rank = 1
      WHERE c.user_id IS NULL OR owner.user_id IS NOT NULL
      GROUP BY profile_key
    ), ranked AS (
      SELECT profile_key, ROW_NUMBER() OVER (ORDER BY score DESC, username COLLATE NOCASE ASC) AS position
      FROM grouped
    )
    SELECT position FROM ranked WHERE profile_key IN (?, ?)
    ORDER BY CASE WHEN profile_key = ? THEN 0 ELSE 1 END LIMIT 1`)
    .get(userId || `legacy:${login}`, `legacy:${login}`, userId || `legacy:${login}`);

  return {
    chatRank: chatRank ? Number(chatRank.position) : null,
    gameRank: gameRank ? Number(gameRank.position) : null,
  };
}

function getLeaderboard({ board = 'games', mode = 'all', limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  if (board === 'chat') {
    return stmt(`WITH ranked_users AS (
        SELECT user_id, username, display_name,
          ROW_NUMBER() OVER (PARTITION BY lower(username) ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC) AS login_rank
        FROM community_user
      ), grouped AS (
        SELECT COALESCE(c.user_id, legacy_owner.user_id, 'legacy:' || lower(c.user)) AS profile_key,
          COALESCE(owner.username, legacy_owner.username, lower(c.user)) AS username,
          COALESCE(owner.display_name, legacy_owner.display_name, MAX(c.display_name), lower(c.user)) AS display_name,
          COUNT(*) AS score
        FROM chat_log c
        LEFT JOIN ranked_users owner ON c.user_id = owner.user_id AND owner.login_rank = 1
        LEFT JOIN ranked_users legacy_owner
          ON c.user_id IS NULL AND lower(c.user) = lower(legacy_owner.username) AND legacy_owner.login_rank = 1
        WHERE c.user_id IS NULL OR owner.user_id IS NOT NULL
        GROUP BY profile_key
      )
      SELECT username AS login, display_name AS displayName, score
      FROM grouped ORDER BY score DESC, username COLLATE NOCASE ASC LIMIT ?`).all(safeLimit)
      .map((row, index) => ({ ...row, score: Number(row.score), position: index + 1 }));
  }

  if (board === 'mode' && GAME_MODES.has(mode)) {
    return stmt(`WITH ranked_users AS (
        SELECT user_id, username, display_name,
          ROW_NUMBER() OVER (PARTITION BY lower(username) ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC) AS login_rank
        FROM community_user
      )
      SELECT u.username AS login, u.display_name AS displayName, COUNT(w.id) AS score
      FROM ranked_users u JOIN community_game_win w ON w.user_id = u.user_id
      WHERE w.mode = ? AND u.login_rank = 1 GROUP BY u.user_id
      ORDER BY score DESC, u.username COLLATE NOCASE ASC LIMIT ?`).all(mode, safeLimit)
      .map((row, index) => ({ ...row, score: Number(row.score), position: index + 1 }));
  }

  return stmt(`WITH ranked_users AS (
      SELECT user_id, username, display_name,
        ROW_NUMBER() OVER (PARTITION BY lower(username) ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC) AS login_rank
      FROM community_user
    )
    SELECT s.user_id AS userId,
      COALESCE(u.username, s.username) AS login,
      COALESCE(u.display_name, s.display_name, s.username) AS displayName,
      s.points AS score
    FROM quiz_score s LEFT JOIN ranked_users u ON u.user_id = s.user_id
    WHERE (u.user_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM community_user owner WHERE lower(owner.username) = lower(s.username)
      )) OR u.login_rank = 1
    ORDER BY s.points DESC, login COLLATE NOCASE ASC LIMIT ?`).all(safeLimit)
    .map(({ userId, ...row }, index) => ({ ...row, score: Number(row.score), position: index + 1 }));
}

function getCommunityStats() {
  const row = stmt(`SELECT
      (SELECT COUNT(*) FROM chat_log) AS totalMessages,
      (SELECT COUNT(*) FROM quiz_score) AS players,
      (SELECT COALESCE(SUM(points), 0) FROM quiz_score) AS totalAnswers,
      (SELECT COUNT(DISTINCT stream_session_id) FROM chat_log WHERE stream_session_id IS NOT NULL) AS activeStreams`)
    .get();
  return {
    totalPlayers: Number(row.players) || 0,
    totalMessages: Number(row.totalMessages) || 0,
    totalAnswers: Number(row.totalAnswers) || 0,
    activeStreams: Number(row.activeStreams) || 0,
  };
}

function countPlayers(board = 'games', mode = 'all') {
  if (board === 'chat') {
    return stmt(`WITH ranked_users AS (
      SELECT user_id, username, ROW_NUMBER() OVER (
        PARTITION BY lower(username) ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC
      ) AS login_rank FROM community_user
    ) SELECT COUNT(*) AS total FROM (
      SELECT COALESCE(c.user_id, legacy_owner.user_id, 'legacy:' || lower(c.user)) AS profile_key
      FROM chat_log c
      LEFT JOIN ranked_users owner ON c.user_id = owner.user_id AND owner.login_rank = 1
      LEFT JOIN ranked_users legacy_owner
        ON c.user_id IS NULL AND lower(c.user) = lower(legacy_owner.username) AND legacy_owner.login_rank = 1
      WHERE c.user_id IS NULL OR owner.user_id IS NOT NULL
      GROUP BY profile_key
    )`).get().total;
  }
  if (board === 'mode' && GAME_MODES.has(mode)) {
    return stmt(`WITH ranked_users AS (
      SELECT user_id, ROW_NUMBER() OVER (
        PARTITION BY lower(username) ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC
      ) AS login_rank FROM community_user
    ) SELECT COUNT(DISTINCT w.user_id) AS total FROM community_game_win w
      JOIN ranked_users u ON u.user_id = w.user_id AND u.login_rank = 1 WHERE w.mode = ?`).get(mode).total;
  }
  return stmt(`WITH ranked_users AS (
      SELECT user_id, username, ROW_NUMBER() OVER (
        PARTITION BY lower(username) ORDER BY MAX(COALESCE(identity_checked_at, 0), last_seen_at) DESC, user_id DESC
      ) AS login_rank FROM community_user
    ) SELECT COUNT(*) AS total FROM quiz_score s LEFT JOIN ranked_users u ON u.user_id = s.user_id
      WHERE (u.user_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM community_user owner WHERE lower(owner.username) = lower(s.username)
      )) OR u.login_rank = 1`).get().total;
}

module.exports = {
  GAME_MODES,
  normalizeLogin,
  safeAvatarUrl,
  prepareUserForEvent,
  recordChat,
  recordFollow,
  recordQuizWin,
  findIdentityByLogin,
  findIdentityById,
  updateTwitchUser,
  setFollowState,
  listDueFollowChecks,
  getMessageHistory,
  findProfileIdentity,
  getChatStats,
  getModeWins,
  getQuizScore,
  getProfileRanks,
  getLeaderboard,
  getCommunityStats,
  countPlayers,
};
