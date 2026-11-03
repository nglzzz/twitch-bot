'use strict';

const ACHIEVEMENTS = require('../data/achievements');

const DAY_MS = 24 * 60 * 60 * 1000;
const FOLLOW_CHECK_MAX_AGE_MS = DAY_MS;
const FOLLOW_CHECK_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getFollowDays(stats, now = Date.now()) {
  if (stats.followStatus !== true && Number(stats.followStatus) !== 1) return 0;
  const followedAt = toTimestamp(stats.currentFollowedAt);
  const checkedAt = toTimestamp(stats.followCheckedAt);
  if (!followedAt || !checkedAt || checkedAt > now + FOLLOW_CHECK_FUTURE_TOLERANCE_MS) return 0;
  if (now - checkedAt > FOLLOW_CHECK_MAX_AGE_MS || followedAt > now) return 0;
  return Math.floor((now - followedAt) / DAY_MS);
}

function metricValues(stats, gameModes, now = Date.now()) {
  return {
    messages: Number(stats.totalMessages) || 0,
    streamMessages: Number(stats.maxMessagesPerStream) || 0,
    streams: Number(stats.streamsAttended) || 0,
    follow: stats.followedAt ? 1 : 0,
    followDays: getFollowDays(stats, now),
    quizAnswers: Number(stats.quizAnswers) || 0,
    quizModeWins: Number(gameModes.quiz) || 0,
    anagramWins: Number(gameModes.anagram) || 0,
    gameWins: Number(gameModes.game) || 0,
    movieWins: Number(gameModes.movie) || 0,
    pointsSpent: Number(stats.pointsSpent) || 0,
    memesSent: Number(stats.memesSent) || 0,
    donationsCount: Number(stats.donationsCount) || 0,
  };
}

function makeAchievements(stats = {}, gameModes = {}, now = Date.now()) {
  const values = metricValues(stats, gameModes, now);
  return ACHIEVEMENTS.map((achievement) => {
    const current = values[achievement.metric] || 0;
    const unlocked = current >= achievement.target;
    const progress = Math.min(current, achievement.target);
    return {
      ...achievement,
      unlocked,
      current,
      progress,
      percent: current > 0 ? Math.max(1, Math.min(100, Math.round((current / achievement.target) * 100))) : 0,
      progressLabel: achievement.metric === 'follow'
        ? (unlocked ? 'Фоллов подтверждён Twitch' : 'Ожидаем подтверждение Twitch')
        : achievement.metric === 'followDays'
          ? `${progress} / ${achievement.target} дн.`
          : `${progress.toLocaleString('ru-RU')} / ${achievement.target.toLocaleString('ru-RU')}`,
    };
  });
}

module.exports = {
  ACHIEVEMENTS,
  DAY_MS,
  FOLLOW_CHECK_MAX_AGE_MS,
  getFollowDays,
  makeAchievements,
  metricValues,
  toTimestamp,
};
