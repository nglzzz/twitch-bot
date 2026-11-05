'use strict';

const communityRepo = require('../repositories/community.repo');
const achievementRepo = require('../repositories/achievement.repo');
const { db } = require('../repositories/base');
const { ACHIEVEMENTS, makeAchievements } = require('./achievementRules');

function collectStats(userId) {
  if (typeof communityRepo.findIdentityById !== 'function') return null;
  const identity = communityRepo.findIdentityById(userId);
  if (!identity) return null;
  const chat = communityRepo.getChatStats({ userId, username: identity.username });
  const gameModes = communityRepo.getModeWins(userId);
  const contributions = require('../repositories/communityContributions.repo').getStats(userId);
  const subscriptions = require('../repositories/communityPaidSubscriptions.repo').getStats(userId);
  const stats = {
    totalMessages: chat.totalMessages,
    maxMessagesPerStream: chat.maxMessagesPerStream,
    streamsAttended: chat.streamsAttended,
    quizAnswers: communityRepo.getQuizScore(userId),
    followedAt: identity.followedAt,
    followStatus: identity.followStatus,
    currentFollowedAt: identity.currentFollowedAt,
    followCheckedAt: identity.followCheckedAt,
    ...contributions,
    ...subscriptions,
  };
  return { identity, chat, stats, gameModes, contributions };
}

function unlockedIds(snapshot, now) {
  if (!snapshot) return [];
  return makeAchievements(snapshot.stats, snapshot.gameModes, now)
    .filter((achievement) => achievement.unlocked)
    .map((achievement) => achievement.id);
}

function seedBaseline(userId, { now = Date.now() } = {}) {
  if (achievementRepo.hasBaseline(userId)) return false;
  const snapshot = collectStats(String(userId));
  if (!snapshot) return false;
  return achievementRepo.seedBaseline({ userId: String(userId), earnedIds: unlockedIds(snapshot, now), initializedAt: now });
}

function evaluateUser(userId, { now = Date.now(), notify = true, historical = false } = {}) {
  if (!userId) return [];
  if (!achievementRepo.hasBaseline(userId)) {
    seedBaseline(userId, { now });
    return [];
  }
  const snapshot = collectStats(String(userId));
  if (!snapshot) return [];
  const alreadyEarned = new Set(achievementRepo.getEarned(userId).map((item) => item.achievementId));
  const newlyEarned = makeAchievements(snapshot.stats, snapshot.gameModes, now)
    .filter((achievement) => achievement.unlocked && !alreadyEarned.has(achievement.id));
  return db.transaction(() => {
    const saved = [];
    for (const achievement of newlyEarned) {
      if (achievementRepo.insertEarned({
        userId: String(userId),
        achievementId: achievement.id,
        earnedAt: now,
        historical,
        announce: notify,
      })) saved.push({ ...achievement, earnedAt: now, isHistorical: historical });
    }
    return saved;
  })();
}

function getEarned(userId) {
  return achievementRepo.getEarned(userId);
}

function evaluateFollowMilestones({ now = Date.now(), limit = 100 } = {}) {
  const rules = ACHIEVEMENTS.filter((rule) => rule.metric === 'followDays');
  if (!rules.length) return 0;
  const conditions = rules.map(() => `(u.current_followed_at <= ? AND NOT EXISTS (
    SELECT 1 FROM community_achievement a WHERE a.user_id = u.user_id AND a.achievement_id = ?))`).join(' OR ');
  const parameters = rules.flatMap((rule) => [now - rule.target * 86400000, rule.id]);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)));
  const users = db.prepare(`SELECT u.user_id AS userId FROM community_user u
    WHERE u.follow_status = 1 AND u.current_followed_at > 0
      AND u.follow_checked_at >= ? AND u.follow_checked_at <= ? AND (${conditions})
    ORDER BY u.current_followed_at, u.user_id LIMIT ?`)
    .all(now - 86400000, now + 300000, ...parameters, safeLimit);
  let unlocked = 0;
  for (const user of users) {
    seedBaseline(user.userId, { now });
    unlocked += evaluateUser(user.userId, { now }).length;
  }
  return unlocked;
}

function getRecentAchievements({ userId = null, limit = 12 } = {}) {
  return achievementRepo.listRecent({ userId, limit }).map((entry) => {
    const definition = ACHIEVEMENTS.find((achievement) => achievement.id === entry.achievementId);
    if (!definition) return null;
    const publicEntry = {
      login: entry.login,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      achievementId: entry.achievementId,
      earnedAt: entry.earnedAt,
      isHistorical: entry.isHistorical,
    };
    return { ...publicEntry, title: definition.title, description: definition.description, icon: definition.icon };
  }).filter(Boolean);
}

function formatAnnouncement(item, definitions = ACHIEVEMENTS) {
  const titlesById = new Map(definitions.map((achievement) => [achievement.id, achievement.title]));
  const titles = item.achievements.map(({ id }) => titlesById.get(id)).filter(Boolean);
  if (!item.login || titles.length === 0) return null;
  const shown = titles.slice(0, 3).map((title) => `«${title}»`);
  const extras = titles.length - shown.length;
  const earned = extras > 0 ? `${shown.join(', ')} и ещё ${extras}` : shown.join(' и ');
  return `@${item.login} получает достижени${titles.length > 1 ? 'я' : 'е'}: ${earned}! Поздравляем!`;
}

function createAnnouncementWorker({ chat, isDbReady = () => require('../app/db').isDbReady(), repository = achievementRepo, intervalMs = 3000, maxUsersPerPoll = 1, channel = null, now = Date.now, logger = console } = {}) {
  if (!chat || typeof chat.getClient !== 'function') throw new TypeError('A chat client is required');
  let timer = null;
  let running = false;
  let polling = false;

  async function poll() {
    if (polling || !isDbReady()) return 0;
    polling = true;
    try {
      const client = chat.getClient();
      if (typeof client.readyState === 'function' && client.readyState() !== 'OPEN') return 0;
      const targetChannel = channel || require('../config').CHANNEL;
      if (!targetChannel || typeof client.say !== 'function') return 0;
      const pending = repository.getPendingAnnouncements({ limit: 100 }).slice(0, Math.max(1, Math.min(10, Number(maxUsersPerPoll) || 1)));
      let sent = 0;
      for (const item of pending) {
        const message = formatAnnouncement(item);
        if (!message) continue;
        try {
          const result = await client.say(targetChannel, message);
          if (result === false) continue;
          repository.markAnnounced({
            userId: item.userId,
            achievementIds: item.achievements.map(({ id }) => id),
            announcedAt: now(),
          });
          sent += 1;
        } catch (error) {
          logger.warn('[Achievements] Could not announce achievement:', error.message);
          break;
        }
      }
      return sent;
    } finally {
      polling = false;
    }
  }

  function start() {
    if (running) return worker;
    running = true;
    poll().catch((error) => logger.error('[Achievements] Announcement poll failed:', error.message));
    timer = setInterval(() => {
      poll().catch((error) => logger.error('[Achievements] Announcement poll failed:', error.message));
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return worker;
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  const worker = { start, stop, poll };
  return worker;
}

let processWorker = null;
function startAchievementAnnouncements(chat, options = {}) {
  if (!processWorker) processWorker = createAnnouncementWorker({ chat, ...options }).start();
  return processWorker;
}

module.exports = {
  collectStats,
  seedBaseline,
  evaluateUser,
  evaluateFollowMilestones,
  getEarned,
  getRecentAchievements,
  formatAnnouncement,
  createAnnouncementWorker,
  startAchievementAnnouncements,
  makeAchievements,
};
