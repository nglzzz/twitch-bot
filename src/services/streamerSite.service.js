const config = require('../config');
const db = require('../app/db');
const chatLogModel = require('../models/chatLog.model');
const viewerModel = require('../models/viewer.model');
const StreamSession = require('../models/streamSession.model');
const MemeLog = require('../models/memeLog.model');
const { getLatestChatters, getRecentMessages } = require('../chat/chatters');
const { getChannelInfo } = require('../twitchApi/channelInfo');

const DAY_IN_MS = 1000 * 60 * 60 * 24;
const RECENT_MESSAGES_LIMIT = 10;
const TOP_CHATTERS_LIMIT = 20;
const VIEWER_HISTORY_LIMIT = 12;
const STREAMS_LIMIT = 30;
const TOP_MEMERS_LIMIT = 10;
const TOP_MEMES_LIMIT = 10;
const CHATTER_STATS_LIMIT = 20;
const DEFAULT_CHANNEL = (config.CHANNEL || 'nglzzz').toLowerCase();

function isDbReady() {
  return db?.connection?.readyState === 1;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatShortDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

function formatStreamUptime(startedAt) {
  if (!startedAt) {
    return '—';
  }

  const diff = Date.now() - new Date(startedAt).getTime();

  if (Number.isNaN(diff) || diff <= 0) {
    return '—';
  }

  const totalMinutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days > 0) {
    parts.push(`${days} д`);
  }

  if (hours > 0 || days > 0) {
    parts.push(`${hours} ч`);
  }

  parts.push(`${minutes} мин`);

  return parts.join(' ');
}

function formatDuration(from, to) {
  if (!from) {
    return '—';
  }

  const end = to ? new Date(to) : new Date();
  const diff = end.getTime() - new Date(from).getTime();

  if (Number.isNaN(diff) || diff <= 0) {
    return '—';
  }

  const totalMinutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours} ч`);
  }

  parts.push(`${minutes} мин`);

  return parts.join(' ');
}

function sanitizeHost(hostname) {
  const sourceHost = config.SITE_PUBLIC_HOST || config.PUBLIC_HOST || hostname || 'localhost';
  const host = String(sourceHost)
    .trim()
    .split(',')[0]
    .trim()
    .replace(/^https?:\/\//, '')
    .split(':')[0]
    .toLowerCase();

  if (!host || host === '0.0.0.0') {
    return 'localhost';
  }

  return host;
}

function buildTwitchEmbeds(hostname) {
  const parent = sanitizeHost(hostname);

  return {
    parent,
    playerUrl: `https://player.twitch.tv/?channel=${DEFAULT_CHANNEL}&parent=${parent}&muted=true`,
    chatUrl: `https://www.twitch.tv/embed/${DEFAULT_CHANNEL}/chat?parent=${parent}&darkpopout`,
  };
}

function buildSocialLinks() {
  return [
    {
      label: 'Twitch',
      url: `https://www.twitch.tv/${DEFAULT_CHANNEL}`,
      description: 'Основной канал и лайв-эфиры',
    },
    {
      label: 'Boosty',
      url: 'https://boosty.to/nglzzz',
      description: 'Поддержка и эксклюзивный контент',
    },
    {
      label: 'Telegram',
      url: 'https://t.me/nglzzzTV',
      description: 'Новости и анонсы стримов',
    },
    {
      label: 'Telegram Chat',
      url: 'https://t.me/nglzzzChat',
      description: 'Комьюнити-чат зрителей',
    },
    {
      label: 'Discord',
      url: 'https://discord.gg/uKCbdCGwTb',
      description: 'Голосовой и текстовый сервер',
    },
    {
      label: 'YouTube',
      url: 'https://www.youtube.com/@nglzzz',
      description: 'Основной YouTube-канал',
    },
    {
      label: 'TikTok',
      url: 'https://www.tiktok.com/@gore_streamer?lang=ru-RU',
      description: 'Короткие видео и моменты',
    },
    {
      label: 'DonationAlerts',
      url: 'https://www.donationalerts.com/c/nglzzz',
      description: 'Поддержка стримера',
    },
  ];
}

async function loadStreamData() {
  const emptyState = {
    status: 'unknown',
    statusLabel: 'Нет live-данных',
    title: 'Мини-сайт стримера NGLZZZ',
    gameName: '—',
    viewerCount: null,
    viewerCountLabel: '—',
    startedAt: null,
    startedAtLabel: '—',
    uptimeLabel: '—',
    language: '—',
    thumbnailUrl: null,
    error: null,
  };

  if (!config.TWITCH_API_CLIENT_ID || !config.TWITCH_ACCESS_TOKEN) {
    return {
      ...emptyState,
      error: 'Twitch API не настроен, поэтому live-метрики недоступны.',
    };
  }

  try {
    const [stream] = await getChannelInfo(DEFAULT_CHANNEL);

    if (!stream) {
      return {
        ...emptyState,
        status: 'offline',
        statusLabel: 'Сейчас офлайн',
        title: 'Стрим сейчас не в эфире',
      };
    }

    return {
      status: 'online',
      statusLabel: 'В эфире',
      title: stream.title,
      gameName: stream.game_name || 'Без категории',
      viewerCount: stream.viewer_count ?? null,
      viewerCountLabel: formatNumber(stream.viewer_count),
      startedAt: stream.started_at,
      startedAtLabel: formatDateTime(stream.started_at),
      uptimeLabel: formatStreamUptime(stream.started_at),
      language: stream.language || '—',
      thumbnailUrl: stream.thumbnail_url
        ? stream.thumbnail_url.replace('{width}', '960').replace('{height}', '540')
        : null,
      error: null,
    };
  } catch (error) {
    return {
      ...emptyState,
      error: error.message || 'Не удалось получить данные Twitch API.',
    };
  }
}

function mapRecentMessage(message) {
  return {
    id: message.id || `${message.user}-${message.createdAt}`,
    user: message.user,
    displayName: message.displayName || message.user,
    text: message.message || message.text,
    createdAt: message.createdAt,
    createdAtLabel: formatShortDateTime(message.createdAt),
  };
}

function buildTopChattersFromMessages(messages) {
  const grouped = new Map();

  messages.forEach((message) => {
    const key = String(message.user || '').toLowerCase();

    if (!key) {
      return;
    }

    const current = grouped.get(key) || {
      user: key,
      displayName: message.displayName || message.user,
      messagesCount: 0,
      lastMessageAt: message.createdAt,
    };

    current.messagesCount += 1;
    current.lastMessageAt = message.createdAt;
    current.displayName = message.displayName || current.displayName;
    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .sort((left, right) => {
      if (right.messagesCount !== left.messagesCount) {
        return right.messagesCount - left.messagesCount;
      }

      return new Date(right.lastMessageAt) - new Date(left.lastMessageAt);
    })
    .slice(0, TOP_CHATTERS_LIMIT)
    .map((entry, index) => ({
      position: index + 1,
      user: entry.user,
      displayName: entry.displayName || entry.user,
      messagesCount: entry.messagesCount,
      messagesCountLabel: formatNumber(entry.messagesCount),
      lastMessageAtLabel: formatShortDateTime(entry.lastMessageAt),
    }));
}

async function loadChatStats(streamSessionId) {
  const memoryMessages = getRecentMessages();
  const memoryRecentMessages = memoryMessages
    .slice(-RECENT_MESSAGES_LIMIT)
    .reverse()
    .map(mapRecentMessage);
  const fallbackTopChatters = buildTopChattersFromMessages(memoryMessages);
  const memoryActiveChatters = getLatestChatters().length;

  const fallback = {
    source: 'memory',
    dbAvailable: false,
    recentMessages: memoryRecentMessages,
    hasRecentMessages: memoryRecentMessages.length > 0,
    topChatters: fallbackTopChatters,
    hasTopChatters: fallbackTopChatters.length > 0,
    totalMessages24h: null,
    totalMessages24hLabel: '—',
    totalMessagesAllTime: null,
    totalMessagesAllTimeLabel: '—',
    uniqueChatters24h: null,
    uniqueChatters24hLabel: '—',
    activeChattersNow: memoryActiveChatters,
    activeChattersNowLabel: formatNumber(memoryActiveChatters),
    note: 'Показываются только данные из оперативной памяти. Mongo-статистика станет доступна после подключения БД.',
  };

  if (!isDbReady()) {
    return fallback;
  }

  try {
    const since = new Date(Date.now() - DAY_IN_MS);
    const streamFilter = streamSessionId ? { streamSessionId } : {};

    const [recentMessages, totalMessages24h, totalMessagesAllTime, uniqueChatters24h, topChatters] = await Promise.all([
      chatLogModel.find(streamFilter).sort({ createdAt: -1 }).limit(RECENT_MESSAGES_LIMIT).lean(),
      chatLogModel.countDocuments({ ...streamFilter, createdAt: { $gte: since } }),
      streamSessionId
        ? chatLogModel.countDocuments(streamFilter)
        : chatLogModel.estimatedDocumentCount(),
      chatLogModel.distinct('user', { ...streamFilter, createdAt: { $gte: since } }),
      chatLogModel.aggregate([
        { $match: { ...streamFilter, createdAt: { $gte: since } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$user',
            displayName: { $first: '$displayName' },
            messagesCount: { $sum: 1 },
            lastMessageAt: { $first: '$createdAt' },
          },
        },
        { $sort: { messagesCount: -1, lastMessageAt: -1 } },
        { $limit: TOP_CHATTERS_LIMIT },
      ]),
    ]);

    const mappedRecentMessages = recentMessages.map(mapRecentMessage);
    const mappedTopChatters = topChatters.map((entry, index) => ({
      position: index + 1,
      user: entry._id,
      displayName: entry.displayName || entry._id,
      messagesCount: entry.messagesCount,
      messagesCountLabel: formatNumber(entry.messagesCount),
      lastMessageAtLabel: formatShortDateTime(entry.lastMessageAt),
    }));

    return {
      source: 'database',
      dbAvailable: true,
      recentMessages: mappedRecentMessages.length > 0 ? mappedRecentMessages : memoryRecentMessages,
      hasRecentMessages: mappedRecentMessages.length > 0 || memoryRecentMessages.length > 0,
      topChatters: mappedTopChatters.length > 0 ? mappedTopChatters : fallbackTopChatters,
      hasTopChatters: mappedTopChatters.length > 0 || fallbackTopChatters.length > 0,
      totalMessages24h,
      totalMessages24hLabel: formatNumber(totalMessages24h),
      totalMessagesAllTime,
      totalMessagesAllTimeLabel: formatNumber(totalMessagesAllTime),
      uniqueChatters24h: uniqueChatters24h.length,
      uniqueChatters24hLabel: formatNumber(uniqueChatters24h.length),
      activeChattersNow: memoryActiveChatters,
      activeChattersNowLabel: formatNumber(memoryActiveChatters),
      note: null,
    };
  } catch (error) {
    return {
      ...fallback,
      note: `Не удалось прочитать chatLog из MongoDB: ${error.message}`,
    };
  }
}

async function loadViewerStats(streamSessionId) {
  const fallback = {
    source: 'memory',
    dbAvailable: false,
    latestViewerCount: null,
    latestViewerCountLabel: '—',
    peakViewerCount24h: null,
    peakViewerCount24hLabel: '—',
    averageViewerCount24h: null,
    averageViewerCount24hLabel: '—',
    uniqueViewers24h: null,
    uniqueViewers24hLabel: '—',
    totalSnapshots: null,
    totalSnapshotsLabel: '—',
    viewerHistory: [],
    hasViewerHistory: false,
    note: 'Срезы зрителей появятся после накопления данных viewer-логов в MongoDB.',
  };

  if (!isDbReady()) {
    return fallback;
  }

  try {
    const since = new Date(Date.now() - DAY_IN_MS);
    const streamFilter = streamSessionId ? { streamSessionId } : {};
    const timeFilter = streamSessionId ? streamFilter : { createdAt: { $gte: since } };

    const [snapshots, totalSnapshots] = await Promise.all([
      viewerModel.find({ ...streamFilter, ...(!streamSessionId ? { createdAt: { $gte: since } } : {}) })
        .sort({ createdAt: -1 })
        .limit(288)
        .lean(),
      viewerModel.countDocuments(streamFilter),
    ]);

    if (snapshots.length === 0) {
      return {
        ...fallback,
        source: 'database',
        dbAvailable: true,
        totalSnapshots,
        totalSnapshotsLabel: formatNumber(totalSnapshots),
      };
    }

    const orderedSnapshots = snapshots.slice().reverse();
    const viewerCounts = snapshots.map((snapshot) => (snapshot.viewers || []).length);
    const uniqueViewers = new Set(
      snapshots.flatMap((snapshot) => (snapshot.viewers || []).map((viewer) => String(viewer).toLowerCase()))
    );
    const latestSnapshot = snapshots[0];
    const maxViewerCount = Math.max(...viewerCounts);
    const averageViewerCount = Math.round(
      viewerCounts.reduce((sum, count) => sum + count, 0) / viewerCounts.length
    );
    const historySource = orderedSnapshots.slice(-VIEWER_HISTORY_LIMIT);
    const historyMax = Math.max(...historySource.map((snapshot) => (snapshot.viewers || []).length), 1);

    const viewerHistory = historySource.map((snapshot) => {
      const viewersCount = (snapshot.viewers || []).length;

      return {
        createdAt: snapshot.createdAt,
        label: formatShortDateTime(snapshot.createdAt),
        viewersCount,
        viewersCountLabel: formatNumber(viewersCount),
        barWidth: `${Math.max(8, Math.round((viewersCount / historyMax) * 100))}%`,
      };
    });

    return {
      source: 'database',
      dbAvailable: true,
      latestViewerCount: (latestSnapshot.viewers || []).length,
      latestViewerCountLabel: formatNumber((latestSnapshot.viewers || []).length),
      peakViewerCount24h: maxViewerCount,
      peakViewerCount24hLabel: formatNumber(maxViewerCount),
      averageViewerCount24h: averageViewerCount,
      averageViewerCount24hLabel: formatNumber(averageViewerCount),
      uniqueViewers24h: uniqueViewers.size,
      uniqueViewers24hLabel: formatNumber(uniqueViewers.size),
      totalSnapshots,
      totalSnapshotsLabel: formatNumber(totalSnapshots),
      viewerHistory,
      hasViewerHistory: viewerHistory.length > 0,
      note: null,
    };
  } catch (error) {
    return {
      ...fallback,
      note: `Не удалось прочитать viewer-лог из MongoDB: ${error.message}`,
    };
  }
}

async function loadStreamSessions() {
  if (!isDbReady()) {
    return { streams: [], hasStreams: false };
  }

  try {
    const streams = await StreamSession
      .find({})
      .sort({ startedAt: -1 })
      .limit(STREAMS_LIMIT)
      .lean();

    const mapped = streams.map((s) => ({
      id: s._id,
      streamId: s.streamId,
      title: s.title || 'Без названия',
      gameName: s.gameName || '—',
      status: s.status,
      startedAt: s.startedAt,
      startedAtLabel: formatDateTime(s.startedAt),
      endedAt: s.endedAt,
      endedAtLabel: s.endedAt ? formatDateTime(s.endedAt) : '—',
      duration: formatDuration(s.startedAt, s.endedAt),
      durationLabel: formatDuration(s.startedAt, s.endedAt),
      maxViewers: s.maxViewers || 0,
      maxViewersLabel: formatNumber(s.maxViewers),
      avgViewers: s.avgViewers || 0,
      avgViewersLabel: formatNumber(s.avgViewers),
      uniqueViewers: s.uniqueViewers || 0,
      uniqueViewersLabel: formatNumber(s.uniqueViewers),
      messagesCount: s.messagesCount || 0,
      messagesCountLabel: formatNumber(s.messagesCount),
      uniqueChatters: s.uniqueChatters || 0,
      uniqueChattersLabel: formatNumber(s.uniqueChatters),
      memesCount: s.memesCount || 0,
      memesCountLabel: formatNumber(s.memesCount),
      dateLabel: formatDate(s.startedAt),
    }));

    return {
      streams: mapped,
      hasStreams: mapped.length > 0,
    };
  } catch (error) {
    console.error('Error loading stream sessions:', error.message);
    return { streams: [], hasStreams: false };
  }
}

async function loadMemeStats(streamSessionId) {
  const fallback = {
    dbAvailable: false,
    totalMemes: 0,
    totalMemesLabel: '—',
    topMemers: [],
    hasTopMemers: false,
    topMemes: [],
    hasTopMemes: false,
    recentMemes: [],
    hasRecentMemes: false,
  };

  if (!isDbReady()) {
    return fallback;
  }

  try {
    const streamFilter = streamSessionId ? { streamSessionId } : {};

    const [totalMemes, topMemers, topMemes, recentMemes] = await Promise.all([
      MemeLog.countDocuments(streamFilter),
      MemeLog.aggregate([
        { $match: { ...streamFilter } },
        {
          $group: {
            _id: '$user',
            userAlias: { $first: '$userAlias' },
            memesCount: { $sum: 1 },
            lastMemeAt: { $max: '$sentAt' },
          },
        },
        { $sort: { memesCount: -1, lastMemeAt: -1 } },
        { $limit: TOP_MEMERS_LIMIT },
      ]),
      MemeLog.aggregate([
        { $match: { ...streamFilter } },
        {
          $group: {
            _id: '$stickerName',
            stickerName: { $first: '$stickerName' },
            usageCount: { $sum: 1 },
            lastUsedAt: { $max: '$sentAt' },
          },
        },
        { $sort: { usageCount: -1, lastUsedAt: -1 } },
        { $limit: TOP_MEMES_LIMIT },
      ]),
      MemeLog.find(streamFilter)
        .sort({ sentAt: -1 })
        .limit(15)
        .lean(),
    ]);

    const mappedTopMemers = topMemers.map((entry, index) => ({
      position: index + 1,
      user: entry._id,
      displayName: entry.userAlias || entry._id,
      memesCount: entry.memesCount,
      memesCountLabel: formatNumber(entry.memesCount),
      lastMemeAtLabel: formatShortDateTime(entry.lastMemeAt),
    }));

    const mappedTopMemes = topMemes.map((entry, index) => ({
      position: index + 1,
      stickerName: entry._id || entry.stickerName,
      usageCount: entry.usageCount,
      usageCountLabel: formatNumber(entry.usageCount),
      lastUsedAtLabel: formatShortDateTime(entry.lastUsedAt),
    }));

    const mappedRecentMemes = recentMemes.map((meme) => ({
      id: meme._id,
      user: meme.user,
      displayName: meme.userAlias || meme.user,
      stickerName: meme.stickerName,
      sentAt: meme.sentAt,
      sentAtLabel: formatShortDateTime(meme.sentAt),
    }));

    return {
      dbAvailable: true,
      totalMemes,
      totalMemesLabel: formatNumber(totalMemes),
      topMemers: mappedTopMemers,
      hasTopMemers: mappedTopMemers.length > 0,
      topMemes: mappedTopMemes,
      hasTopMemes: mappedTopMemes.length > 0,
      recentMemes: mappedRecentMemes,
      hasRecentMemes: mappedRecentMemes.length > 0,
    };
  } catch (error) {
    console.error('Error loading meme stats:', error.message);
    return { ...fallback, dbAvailable: isDbReady() };
  }
}

async function loadChatterStats(chatterName) {
  if (!chatterName || !isDbReady()) {
    return null;
  }

  try {
    const user = String(chatterName).toLowerCase();

    const [messages, stats] = await Promise.all([
      chatLogModel
        .find({ user })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      chatLogModel.aggregate([
        { $match: { user } },
        {
          $group: {
            _id: '$user',
            displayName: { $first: '$displayName' },
            totalMessages: { $sum: 1 },
            firstMessageAt: { $min: '$createdAt' },
            lastMessageAt: { $max: '$createdAt' },
            streams: { $addToSet: '$streamSessionId' },
          },
        },
      ]),
    ]);

    if (!stats || stats.length === 0) {
      return null;
    }

    const stat = stats[0];
    const uniqueStreams = (stat.streams || []).filter(Boolean);

    return {
      user: stat._id,
      displayName: stat.displayName || stat._id,
      totalMessages: stat.totalMessages,
      totalMessagesLabel: formatNumber(stat.totalMessages),
      firstMessageAt: stat.firstMessageAt,
      firstMessageAtLabel: formatDateTime(stat.firstMessageAt),
      lastMessageAt: stat.lastMessageAt,
      lastMessageAtLabel: formatDateTime(stat.lastMessageAt),
      streamsCount: uniqueStreams.length,
      streamsCountLabel: formatNumber(uniqueStreams.length),
      recentMessages: messages.map(mapRecentMessage),
    };
  } catch (error) {
    console.error('Error loading chatter stats:', error.message);
    return null;
  }
}

async function loadOverallStats() {
  if (!isDbReady()) {
    return {
      dbAvailable: false,
      totalStreams: 0,
      totalStreamsLabel: '—',
      totalMessages: 0,
      totalMessagesLabel: '—',
      totalUniqueChatters: 0,
      totalUniqueChattersLabel: '—',
      totalMemes: 0,
      totalMemesLabel: '—',
      peakViewersAllTime: 0,
      peakViewersAllTimeLabel: '—',
      avgStreamDuration: '—',
    };
  }

  try {
    const [totalStreams, totalMessages, totalMemes, uniqueChattersAgg, peakStream] = await Promise.all([
      StreamSession.countDocuments({}),
      chatLogModel.estimatedDocumentCount(),
      MemeLog.countDocuments({}),
      chatLogModel.aggregate([
        { $group: { _id: '$user' } },
        { $count: 'total' },
      ]),
      StreamSession
        .findOne({})
        .sort({ maxViewers: -1 })
        .lean(),
    ]);

    const uniqueChatters = uniqueChattersAgg.length > 0 ? uniqueChattersAgg[0].total : 0;

    // Calculate average stream duration
    const durationAgg = await StreamSession.aggregate([
      { $match: { status: 'ended', startedAt: { $ne: null }, endedAt: { $ne: null } } },
      {
        $group: {
          _id: null,
          avgDurationMs: {
            $avg: { $subtract: ['$endedAt', '$startedAt'] },
          },
        },
      },
    ]);

    let avgStreamDuration = '—';
    if (durationAgg.length > 0 && durationAgg[0].avgDurationMs) {
      avgStreamDuration = formatDuration(
        new Date(0),
        new Date(durationAgg[0].avgDurationMs)
      );
    }

    return {
      dbAvailable: true,
      totalStreams,
      totalStreamsLabel: formatNumber(totalStreams),
      totalMessages,
      totalMessagesLabel: formatNumber(totalMessages),
      totalUniqueChatters: uniqueChatters,
      totalUniqueChattersLabel: formatNumber(uniqueChatters),
      totalMemes,
      totalMemesLabel: formatNumber(totalMemes),
      peakViewersAllTime: peakStream ? peakStream.maxViewers : 0,
      peakViewersAllTimeLabel: formatNumber(peakStream ? peakStream.maxViewers : 0),
      avgStreamDuration,
    };
  } catch (error) {
    console.error('Error loading overall stats:', error.message);
    return { dbAvailable: false };
  }
}

function buildNavigation(currentPage) {
  return [
    {
      label: 'Главная',
      href: '/',
      isActive: currentPage === 'home',
    },
    {
      label: 'Статистика',
      href: '/stats',
      isActive: currentPage === 'stats',
    },
    {
      label: 'Озвучка',
      href: '/speak',
      isActive: currentPage === 'speak',
    },
  ];
}

function buildSummaryCards(stream, viewerStats, chatStats) {
  return [
    {
      label: 'Статус',
      value: stream.statusLabel,
      accent: stream.status === 'online' ? 'success' : 'neutral',
      description: stream.gameName !== '—' ? `Категория: ${stream.gameName}` : 'Категория обновляется автоматически',
    },
    {
      label: 'Зрителей сейчас',
      value: stream.status === 'online' ? stream.viewerCountLabel : viewerStats.latestViewerCountLabel,
      accent: 'primary',
      description: stream.status === 'online'
        ? 'Данные берутся из Twitch API в момент загрузки страницы'
        : 'Если стрим офлайн, показывается последний сохранённый срез аудитории',
    },
    {
      label: 'Сообщений за 24 часа',
      value: chatStats.totalMessages24hLabel,
      accent: 'secondary',
      description: 'Чем дольше работает логирование, тем полезнее становится раздел статистики',
    },
    {
      label: 'Уникальных зрителей за 24 часа',
      value: viewerStats.uniqueViewers24hLabel,
      accent: 'secondary',
      description: 'Считается по viewer-срезам, которые бот собирает во время эфира',
    },
  ];
}

function buildProfile(hostname) {
  const embeds = buildTwitchEmbeds(hostname);

  return {
    name: DEFAULT_CHANNEL.toUpperCase(),
    handle: DEFAULT_CHANNEL,
    description: 'Мини-сайт о стримере на базе существующего Twitch-бота: с плеером, встроенным чатом и живой статистикой сообщества.',
    longDescription: 'Сайт использует текущую Node.js + Docker инфраструктуру проекта и умеет подтягивать live-данные Twitch, viewer-срезы из MongoDB и историю сообщений из чата.',
    links: buildSocialLinks(),
    embeds,
  };
}

async function buildSharedSiteData(hostname) {
  const [stream, viewerStats, chatStats] = await Promise.all([
    loadStreamData(),
    loadViewerStats(),
    loadChatStats(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    generatedAtLabel: formatDateTime(new Date()),
    profile: buildProfile(hostname),
    stream,
    viewerStats,
    chatStats,
    summaryCards: buildSummaryCards(stream, viewerStats, chatStats),
  };
}

async function buildHomePageData(hostname) {
  const shared = await buildSharedSiteData(hostname);

  return {
    pageTitle: 'NGLZZZ — стрим, чат и статистика',
    pageDescription: 'Мини-сайт стримера NGLZZZ с Twitch-плеером, чатом и статистикой зрителей.',
    navigation: buildNavigation('home'),
    currentPage: 'home',
    ...shared,
  };
}

async function buildStatsPageData(hostname, filters) {
  const streamSessionId = filters?.streamId || null;
  const chatterName = filters?.chatter || null;

  const [shared, streamSessions, memeStats, overallStats, chatterStats] = await Promise.all([
    buildSharedSiteData(hostname),
    loadStreamSessions(),
    loadMemeStats(streamSessionId),
    loadOverallStats(),
    chatterName ? loadChatterStats(chatterName) : Promise.resolve(null),
  ]);

  // If filtering by stream, reload viewer/chat stats with filter
  let viewerStats = shared.viewerStats;
  let chatStats = shared.chatStats;

  if (streamSessionId) {
    [viewerStats, chatStats] = await Promise.all([
      loadViewerStats(streamSessionId),
      loadChatStats(streamSessionId),
    ]);
  }

  return {
    pageTitle: 'NGLZZZ — подробная статистика',
    pageDescription: 'Статистика чата и viewer-срезов для стримера NGLZZZ.',
    navigation: buildNavigation('stats'),
    currentPage: 'stats',
    ...shared,
    viewerStats,
    chatStats,
    streamSessions,
    memeStats,
    overallStats,
    chatterStats,
    filters: {
      streamId: streamSessionId || '',
      chatter: chatterName || '',
    },
  };
}

async function getSummaryApiData(hostname) {
  const shared = await buildSharedSiteData(hostname);

  return {
    generatedAt: shared.generatedAt,
    profile: shared.profile,
    stream: shared.stream,
    summaryCards: shared.summaryCards,
  };
}

async function getStatsApiData(hostname, filters) {
  const streamSessionId = filters?.streamId || null;

  const [shared, streamSessions, memeStats, overallStats] = await Promise.all([
    buildSharedSiteData(hostname),
    loadStreamSessions(),
    loadMemeStats(streamSessionId),
    loadOverallStats(),
  ]);

  return {
    generatedAt: shared.generatedAt,
    stream: shared.stream,
    viewerStats: shared.viewerStats,
    chatStats: shared.chatStats,
    streamSessions,
    memeStats,
    overallStats,
  };
}

module.exports = {
  buildHomePageData,
  buildStatsPageData,
  getSummaryApiData,
  getStatsApiData,
  loadChatterStats,
};
