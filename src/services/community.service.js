'use strict';

const communityRepo = require('../repositories/community.repo');
const achievementService = require('./achievements.service');
const contributionsRepo = require('../repositories/communityContributions.repo');
const { makeAchievements } = require('./achievementRules');
const { encodeHistoryCursor } = require('../helpers/communityCursor');
const config = require('../config');

const MODES = [
  { value: 'all', label: 'Все игры' },
  { value: 'quiz', label: 'Викторина' },
  { value: 'anagram', label: 'Анаграммы' },
  { value: 'game', label: 'Игры по эмодзи' },
  { value: 'movie', label: 'Фильмы по эмодзи' },
];

const GAME_LABELS = {
  quiz: 'Викторина',
  anagram: 'Анаграммы',
  game: 'Игры по эмодзи',
  movie: 'Фильмы по эмодзи',
};

const GAME_ICONS = { quiz: '❓', anagram: '🔤', game: '🎮', movie: '🎬' };

const BOARDS = [
  { value: 'chat', label: 'Голоса чата' },
  { value: 'games', label: 'Знатоки игр' },
];

function getCharacterization(stats, gameModes) {
  if (stats.quizAnswers >= 100) {
    return {
      title: 'Эрудит чата',
      text: `${stats.quizAnswers.toLocaleString('ru-RU')} правильных ответов в играх чата.`,
    };
  }
  if (stats.maxMessagesPerStream >= 100) {
    return {
      title: 'Голос эфира',
      text: `До ${stats.maxMessagesPerStream.toLocaleString('ru-RU')} сообщений за один стрим.`,
    };
  }
  if (stats.streamsAttended >= 25) {
    return {
      title: 'Постоянный гость',
      text: `Участие в чате на ${stats.streamsAttended.toLocaleString('ru-RU')} разных стримах.`,
    };
  }
  const favoriteMode = Object.entries(gameModes).sort((left, right) => right[1] - left[1])[0];
  if (favoriteMode && favoriteMode[1] > 0) {
    return {
      title: GAME_LABELS[favoriteMode[0]],
      text: `${favoriteMode[1].toLocaleString('ru-RU')} побед в режиме «${GAME_LABELS[favoriteMode[0]]}».`,
    };
  }
  if (stats.totalMessages >= 100) {
    return {
      title: 'Голос чата',
      text: `${stats.totalMessages.toLocaleString('ru-RU')} сообщений в сохранённом чате.`,
    };
  }
  return {
    title: 'Новый голос',
    text: 'Статистика будет расти вместе с общением и играми на стриме.',
  };
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.TIMEZONE }).format(new Date(value));
}

function buildFollowDetails(identity) {
  const isFollowing = identity.followStatus === 1 || identity.followStatus === true;
  const knownNegative = identity.followStatus === 0 || identity.followStatus === false;
  const start = isFollowing ? identity.currentFollowedAt : null;
  const days = start ? Math.max(0, Math.floor((Date.now() - start) / 86400000)) : 0;
  const fresh = identity.followCheckedAt && Date.now() - identity.followCheckedAt <= 86400000;
  return {
    currentFollowedAtLabel: start ? formatDateTime(start) : null,
    followDays: days,
    followDurationLabel: start ? `${days.toLocaleString('ru-RU')} дн.` : '—',
    followStatusClass: fresh && isFollowing ? 'is-following' : knownNegative ? 'is-not-following' : 'is-follow-unknown',
    followStatusLabel: isFollowing ? (fresh ? 'Фолловер канала' : 'Фоллоу был подтверждён ранее')
      : knownNegative ? (fresh ? 'Сейчас не фолловит канал' : 'Не фолловил при последней проверке') : 'Статус фоллоу не подтверждён',
    followSourceNote: identity.followCheckedAt
      ? `Последняя проверка Twitch: ${formatDateTime(identity.followCheckedAt)}. Достижения за срок требуют актуального подтверждения.`
      : 'Twitch пока не подтвердил дату фоллоу. Когда данные станут доступны, они появятся здесь.',
  };
}

function getRecentAchievements({ userId = null, limit = 10 } = {}) {
  return achievementService.getRecentAchievements({ userId, limit }).map(({ userId: internalId, ...entry }) => ({
    ...entry,
    avatarUrl: communityRepo.safeAvatarUrl(entry.avatarUrl),
    initial: String(entry.displayName || entry.login || '').slice(0, 1).toUpperCase(),
    profileHref: `/users/${encodeURIComponent(entry.login)}`,
    earnedAtLabel: formatDateTime(entry.earnedAt),
  }));
}

function getMessageHistory(identity, before = null) {
  const history = communityRepo.getMessageHistory({ userId: identity.userId, username: identity.username, cursor: before, limit: 30 });
  const last = history.messages[history.messages.length - 1];
  const base = `/users/${encodeURIComponent(identity.username)}`;
  const nextCursor = history.hasMore && last ? encodeHistoryCursor(last) : null;
  return {
    messages: history.messages.map(({ id, ...message }) => ({ ...message, createdAtLabel: formatDateTime(message.createdAt) })),
    hasMessages: history.messages.length > 0,
    hasMore: history.hasMore,
    nextCursor,
    nextHref: nextCursor ? `${base}?before=${encodeURIComponent(nextCursor)}#community-profile-history` : null,
    previousHref: before ? `${base}#community-profile-history` : null,
    note: 'В архив входят сохранённые обычные сообщения. Команды бота здесь не учитываются.',
  };
}

function getProfile(login, { before = null } = {}) {
  const identity = communityRepo.findProfileIdentity(login);
  if (!identity) return null;

  const chat = communityRepo.getChatStats({ userId: identity.userId, username: identity.username });
  const gameModes = communityRepo.getModeWins(identity.userId);
  const quizAnswers = communityRepo.getQuizScore(identity.userId);
  const ranks = communityRepo.getProfileRanks({ userId: identity.userId, username: identity.username });
  const contributions = contributionsRepo.getStats(identity.userId);
  const subscriptions = require('../repositories/communityPaidSubscriptions.repo').getStats(identity.userId);
  const stats = {
    ...contributions,
    ...subscriptions,
    totalMessages: chat.totalMessages,
    streamsAttended: chat.streamsAttended,
    maxMessagesPerStream: chat.maxMessagesPerStream,
    quizAnswers,
    chatRank: ranks.chatRank,
    gameRank: ranks.gameRank,
  };
  const earned = new Map(achievementService.getEarned(identity.userId).map((award) => [award.achievementId, award]));
  const achievements = makeAchievements({ ...stats, followedAt: identity.followedAt,
    followStatus: identity.followStatus, currentFollowedAt: identity.currentFollowedAt,
    followCheckedAt: identity.followCheckedAt }, gameModes).map((card) => {
    const saved = earned.get(card.id);
    return { ...card, unlocked: card.metric === 'followDays' ? Boolean(saved) : card.unlocked || Boolean(saved),
      earnedAt: saved ? saved.earnedAt : null,
      earnedAtLabel: saved ? formatDateTime(saved.earnedAt) : null,
      isHistorical: saved ? saved.isHistorical : card.unlocked,
      progress: saved ? card.target : card.progress,
      percent: saved ? 100 : card.percent,
      progressLabel: saved ? (card.metric === 'follow' ? 'Фоллоу подтверждён' : `${card.target.toLocaleString('ru-RU')} / ${card.target.toLocaleString('ru-RU')}${card.metric === 'followDays' ? ' дн.' : ''}`) : card.progressLabel,
    };
  });
  const earnedAchievements = achievements.filter((achievement) => achievement.unlocked).length;
  const experience = earnedAchievements * 100;
  const characterization = getCharacterization(stats, gameModes);
  const notes = [
    'В статистику сообщений попадает обычный текст чата; команды бота отдельно не учитываются.',
    'Разбивка побед по режимам ведётся с запуска профилей. Общий счёт включает сохранённые ранее очки.',
  ];

  if (chat.legacyMessages > 0) {
    notes.push('Часть ранних сообщений привязана к нику без Twitch ID. После смены или повторной выдачи ника эта историческая оценка может быть неточной.');
  }
  if (identity.source === 'quiz') {
    notes.push('Профиль появился благодаря сохранённым очкам игр. Подробная история чата собирается с момента включения профилей.');
  }
  if (identity.source === 'legacy-chat') {
    notes.push('Эта статистика восстановлена по старому нику в журнале чата; стабильный Twitch ID для записей отсутствует.');
  }
  const firstSeen = [chat.firstMessageAt, identity.firstSeenAt].filter(Number.isFinite);
  const lastSeen = [chat.lastMessageAt, identity.lastSeenAt].filter(Number.isFinite);
  const firstSeenAt = firstSeen.length ? Math.min(...firstSeen) : null;
  const lastSeenAt = lastSeen.length ? Math.max(...lastSeen) : null;

  const formatDate = (value) => value
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: config.TIMEZONE }).format(new Date(value))
    : '—';

  return {
    available: true,
    login: identity.username,
    displayName: identity.displayName || identity.username,
    initial: String(identity.displayName || identity.username).trim().slice(0, 1).toUpperCase(),
    title: characterization.title,
    characterization: characterization.text,
    firstSeenAt,
    lastSeenAt,
    followedAt: identity.followedAt || null,
    currentFollowedAt: identity.currentFollowedAt || null,
    avatarUrl: communityRepo.safeAvatarUrl(identity.avatarUrl),
    contributions: { ...contributions, hasPointsBalance: false },
    ...buildFollowDetails(identity),
    history: getMessageHistory(identity, before),
    recentAchievements: identity.userId ? getRecentAchievements({ userId: identity.userId, limit: 6 }) : [],
    firstSeenAtLabel: formatDate(firstSeenAt),
    firstMessageAt: chat.firstMessageAt,
    firstMessageAtLabel: formatDate(chat.firstMessageAt),
    lastSeenAtLabel: formatDate(lastSeenAt),
    followedAtLabel: identity.followedAt ? formatDateTime(identity.followedAt) : null,
    twitchUrl: `https://www.twitch.tv/${identity.username}`,
    stats,
    gameModes: Object.entries(GAME_LABELS).map(([id, label]) => ({
      id,
      label,
      icon: GAME_ICONS[id],
      wins: Number(gameModes[id]) || 0,
      winsLabel: 'побед',
    })),
    achievements,
    earnedAchievements,
    achievementCount: achievements.length,
    experience,
    level: Math.floor(Math.sqrt(experience / 100)) + 1,
    notes,
  };
}

function getCommunity({ board = 'chat', mode = 'all', limit = 50 } = {}) {
  const selectedBoard = board === 'chat' ? 'chat' : 'games';
  const selectedMode = MODES.some((item) => item.value === mode) ? mode : 'all';
  const repoBoard = selectedBoard === 'chat' ? 'chat' : selectedMode === 'all' ? 'games' : 'mode';
  const players = communityRepo.getLeaderboard({ board: repoBoard, mode: selectedMode, limit })
    .map((player) => ({
      ...player,
      avatarUrl: communityRepo.safeAvatarUrl(communityRepo.findIdentityByLogin(player.login)?.avatarUrl),
      initial: String(player.displayName || player.login).trim().slice(0, 1).toUpperCase(),
      scoreLabel: selectedBoard === 'chat' ? 'сообщений' : (selectedMode === 'all' ? 'очков' : 'побед'),
      href: `/users/${encodeURIComponent(player.login)}`,
    }));
  const stats = communityRepo.getCommunityStats();
  stats.totalPlayers = communityRepo.countPlayers(repoBoard, selectedMode);

  return {
    available: true,
    recentAchievements: getRecentAchievements({ limit: 10 }),
    board: selectedBoard,
    mode: selectedMode,
    selectedBoard,
    selectedMode,
    selectedUser: '',
    leaderboardTitle: selectedBoard === 'chat'
      ? 'Самые активные участники чата'
      : (selectedMode === 'all' ? 'Общий зачёт игр чата' : `${MODES.find((item) => item.value === selectedMode).label}: лучшие игроки`),
    boards: BOARDS,
    modes: MODES,
    searchUser: '/users/',
    podium: players.slice(0, 3),
    players,
    stats,
    hasPlayers: players.length > 0,
    modeHistoryNote: selectedMode === 'all'
      ? null
      : 'Разбивка по режимам собирается с момента запуска профилей; общий рейтинг сохраняет всю историю очков.',
  };
}

module.exports = {
  getProfile,
  getCommunity,
  getCommunityPageData: getCommunity,
  makeAchievements,
  getRecentAchievements,
  getMessageHistory,
};
