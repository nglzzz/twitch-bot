const config = require('../config');
const { isDbReady } = require('../app/db');
const chatLogRepo = require('../repositories/chatLog.repo');
const viewerRepo = require('../repositories/viewer.repo');
const streamSessionRepo = require('../repositories/streamSession.repo');
const memeLogRepo = require('../repositories/memeLog.repo');
const donationRepo = require('../repositories/donation.repo');
const { getLatestChatters, getRecentMessages } = require('../chat/chatters');
const { getChannelInfo } = require('../twitchApi/channelInfo');

const DAY_IN_MS = 1000 * 60 * 60 * 24;
const RECENT_MESSAGES_LIMIT = 10;
const TOP_CHATTERS_LIMIT = 20;
const VIEWER_HISTORY_LIMIT = 24;
const STREAMS_LIMIT = 30;
const TOP_MEMERS_LIMIT = 10;
const TOP_MEMES_LIMIT = 10;
const DONATION_LIMIT = 20;
const TOP_DONORS_LIMIT = 10;
const DEFAULT_CHANNEL = (config.CHANNEL || 'nglzzz').toLowerCase();
const TIMEZONE = config.TIMEZONE || 'Europe/Minsk';

/**
 * Resolve a raw stream filter value into a usable streamSessionId.
 * - "latest" (case-insensitive) resolves to the most recent stream_session id
 * - any other non-empty string is returned as-is (TEXT PK в SQLite)
 * - empty/null → null (no filter)
 */
async function resolveStreamSessionId(rawId) {
  if (!rawId) {
    return null;
  }

  const value = String(rawId).trim();

  if (!value) {
    return null;
  }

  if (value.toLowerCase() === 'latest') {
    if (!isDbReady()) {
      return null;
    }

    try {
      return streamSessionRepo.findLatestId();
    } catch (error) {
      console.error('Error resolving latest stream session:', error.message);
      return null;
    }
  }

  return value;
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
    timeZone: TIMEZONE,
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
    timeZone: TIMEZONE,
  }).format(new Date(value));
}

function formatStreamPeriod(startedAt, endedAt) {
  if (!startedAt) {
    return '—';
  }

  const start = formatShortDateTime(startedAt);

  if (!endedAt) {
    return `${start} → идёт сейчас`;
  }

  const startDay = new Date(startedAt);
  const endDay = new Date(endedAt);
  const crossesMidnight =
    startDay.toDateString() !== endDay.toDateString();

  const end = crossesMidnight ? formatShortDateTime(endedAt) : formatTime(endedAt);

  return `${start} → ${end}`;
}

function formatTime(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
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
    timeZone: TIMEZONE,
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

/**
 * Pick up to `maxPoints` items from `arr` (already in chronological order)
 * spread evenly across the whole range, so a long sequence collapses to a
 * representative timeline without losing its start or end.
 */
function sampleEvenly(arr, maxPoints) {
  if (!Array.isArray(arr) || arr.length <= maxPoints) {
    return arr || [];
  }

  if (maxPoints <= 0) {
    return [];
  }

  const result = [];
  const lastIndex = arr.length - 1;
  const step = lastIndex / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i += 1) {
    result.push(arr[Math.min(Math.round(i * step), lastIndex)]);
  }

  return result;
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
      key: 'twitch',
      url: `https://www.twitch.tv/${DEFAULT_CHANNEL}`,
      description: 'Основной канал и лайв-эфиры',
    },
    {
      label: 'Boosty',
      key: 'boosty',
      url: 'https://boosty.to/nglzzz',
      description: 'Эксклюзивный контент и подписки',
    },
    {
      label: 'YouTube',
      key: 'youtube',
      url: 'https://www.youtube.com/@nglzzz',
      description: 'Видео и нарезки',
    },
    {
      label: 'Telegram',
      key: 'telegram',
      url: 'https://t.me/nglzzzTV',
      description: 'Новости и анонсы',
    },
    {
      label: 'Telegram Chat',
      key: 'telegram',
      url: 'https://t.me/nglzzzChat',
      description: 'Чат комьюнити',
    },
    {
      label: 'Discord',
      key: 'discord',
      url: 'https://discord.gg/uKCbdCGwTb',
      description: 'Голосовой сервер',
    },
    {
      label: 'TikTok',
      key: 'tiktok',
      url: 'https://www.tiktok.com/@gore_streamer?lang=ru-RU',
      description: 'Короткие видео',
    },
    {
      label: 'DonationAlerts',
      key: 'donate',
      url: 'https://www.donationalerts.com/c/nglzzz',
      description: 'Разовая поддержка',
    },
  ];
}

function buildSupportLinks() {
  return {
    primary: {
      label: 'Boosty',
      url: 'https://boosty.to/nglzzz',
      description: 'Подпишись на Boosty — получи доступ к эксклюзивным постам, закрытому контенту и роли в чате',
    },
    secondary: {
      label: 'DonationAlerts',
      url: 'https://www.donationalerts.com/c/nglzzz',
      description: 'Хочешь задобрить стримера? Закинь донат на мечту!',
    },
  };
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
    const since = Date.now() - DAY_IN_MS;
    const streamId = streamSessionId || null;

    // Топ чаттеров: при выборе конкретного стрима — по нему,
    // без фильтра («Все стримы») — за всё время.
    const recentMessages = chatLogRepo.findRecent({ streamSessionId: streamId, limit: RECENT_MESSAGES_LIMIT });
    const totalMessages24h = chatLogRepo.countSince({ streamSessionId: streamId, since });
    const totalMessagesAllTime = chatLogRepo.countSince({ streamSessionId: streamId });
    const uniqueChatters24h = chatLogRepo.distinctUsersSince({ streamSessionId: streamId, since });
    const topChatters = chatLogRepo.getTopChatters({ streamSessionId: streamId, limit: TOP_CHATTERS_LIMIT });

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
      topChattersSource: streamId ? 'stream' : 'allTime',
      topChatters: mappedTopChatters.length > 0 ? mappedTopChatters : fallbackTopChatters,
      hasTopChatters: mappedTopChatters.length > 0 || fallbackTopChatters.length > 0,
      totalMessages24h,
      totalMessages24hLabel: formatNumber(totalMessages24h),
      totalMessagesAllTime,
      totalMessagesAllTimeLabel: formatNumber(totalMessagesAllTime),
      uniqueChatters24h,
      uniqueChatters24hLabel: formatNumber(uniqueChatters24h),
      activeChattersNow: memoryActiveChatters,
      activeChattersNowLabel: formatNumber(memoryActiveChatters),
      note: null,
    };
  } catch (error) {
    return {
      ...fallback,
      note: `Не удалось прочитать chatLog: ${error.message}`,
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
    const since = Date.now() - DAY_IN_MS;
    const streamId = streamSessionId || null;

    // При фильтре по стриму — без лимита (limit 0); иначе — только за 24ч, до 288 срезов.
    const snapshots = streamId
      ? viewerRepo.findSnapshots({ streamSessionId: streamId })
      : viewerRepo.findSnapshots({ since, limit: 288 });
    const totalSnapshots = viewerRepo.countSnapshots({ streamSessionId: streamId });

    if (snapshots.length === 0) {
      return {
        ...fallback,
        source: 'database',
        dbAvailable: true,
        filteredByStream: Boolean(streamId),
        totalSnapshots,
        totalSnapshotsLabel: formatNumber(totalSnapshots),
      };
    }

    // Snapshots are sorted ascending by createdAt, so the last one is the most recent.
    const latestSnapshot = snapshots[snapshots.length - 1];
    const viewerCounts = snapshots.map((snapshot) => (snapshot.viewers || []).length);
    const uniqueViewers = new Set(
      snapshots.flatMap((snapshot) => (snapshot.viewers || []).map((viewer) => String(viewer).toLowerCase()))
    );
    const maxViewerCount = Math.max(...viewerCounts);
    const averageViewerCount = Math.round(
      viewerCounts.reduce((sum, count) => sum + count, 0) / viewerCounts.length
    );
    // Evenly sample across the full timeline so a long stream (e.g. one that
    // spans two days) is represented end-to-end, instead of only its first hour.
    const historySource = sampleEvenly(snapshots, VIEWER_HISTORY_LIMIT);
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
      filteredByStream: Boolean(streamId),
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
      note: `Не удалось прочитать viewer-лог: ${error.message}`,
    };
  }
}

async function loadStreamSessions() {
  if (!isDbReady()) {
    return { streams: [], hasStreams: false };
  }

  try {
    const streams = streamSessionRepo.findRecent(STREAMS_LIMIT);

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
      periodLabel: formatStreamPeriod(s.startedAt, s.endedAt),
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
    const streamId = streamSessionId || null;

    const totalMemes = memeLogRepo.count({ streamSessionId: streamId });
    const topMemers = memeLogRepo.getTopMemers({ streamSessionId: streamId, limit: TOP_MEMERS_LIMIT });
    const topMemes = memeLogRepo.getTopMemes({ streamSessionId: streamId, limit: TOP_MEMES_LIMIT });
    const recentMemes = memeLogRepo.findRecent({ streamSessionId: streamId, limit: 15 });

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
    const user = String(chatterName).toLowerCase().trim();

    const messages = chatLogRepo.findRecentByUser(user, 50);
    const stats = chatLogRepo.getUserLifetimeStats(user);
    const memeDataAgg = memeLogRepo.getUserMemeStats(user);
    const hourlyActivity = chatLogRepo.getUserHourlyActivity(user);
    const dailyActivity = chatLogRepo.getUserWeeklyActivity(user);
    const rank = chatLogRepo.getUserRank(user);
    const viewerSnapshots = viewerRepo.findSnapshotsByUser(user);

    if (!stats) {
      return { notFound: true, searchedUser: user };
    }

    const stat = stats;
    // streams — COUNT(DISTINCT stream_session_id), уже число.
    const streamsCount = Number(stat.streams) || 0;

    // Estimate watch time from viewer snapshots (each snapshot = 5 min interval)
    let watchTimeMinutes = 0;
    let watchTimeLabel = '—';
    let viewerSnapshotCount = 0;
    let firstSeenAsViewerAt = null;
    let lastSeenAsViewerAt = null;

    if (viewerSnapshots && viewerSnapshots.length > 0) {
      viewerSnapshotCount = viewerSnapshots.length;
      watchTimeMinutes = viewerSnapshotCount * 5;
      firstSeenAsViewerAt = viewerSnapshots[0].createdAt;
      lastSeenAsViewerAt = viewerSnapshots[viewerSnapshots.length - 1].createdAt;

      if (watchTimeMinutes >= 60) {
        const hours = Math.floor(watchTimeMinutes / 60);
        const mins = watchTimeMinutes % 60;
        watchTimeLabel = mins > 0 ? `${hours} ч ${mins} мин` : `${hours} ч`;
      } else {
        watchTimeLabel = `${watchTimeMinutes} мин`;
      }
    }

    // Build hourly activity array (0-23)
    const hourlyMap = new Array(24).fill(0);
    hourlyActivity.forEach(h => { hourlyMap[h._id] = h.count; });
    const peakHour = hourlyMap.indexOf(Math.max(...hourlyMap));
    const maxHourlyCount = Math.max(...hourlyMap);

    // Build daily activity array (1-7, приведено к нотации Mongo: 1=Sunday)
    const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const dailyMap = new Array(7).fill(0);
    dailyActivity.forEach(d => { dailyMap[d._id - 1] = d.count; });
    const peakDayIndex = dailyMap.indexOf(Math.max(...dailyMap));
    const maxDailyCount = Math.max(...dailyMap);

    // Process meme stats
    let memeData = null;
    if (memeDataAgg) {
      memeData = {
        totalMemes: memeDataAgg.totalMemes,
        totalMemesLabel: formatNumber(memeDataAgg.totalMemes),
        firstMemeAtLabel: formatDateTime(memeDataAgg.firstMemeAt),
        lastMemeAtLabel: formatDateTime(memeDataAgg.lastMemeAt),
        topMemes: (memeDataAgg.topMemes || []).map((m) => ({ stickerName: m.stickerName, count: m.count, countLabel: formatNumber(m.count) })),
        hasTopMemes: (memeDataAgg.topMemes || []).length > 0,
      };
    }

    // Determine activity level
    const total = stat.totalMessages;
    let activityLevel, activityLevelClass;
    if (total >= 1000) { activityLevel = 'Легенда чата'; activityLevelClass = 'legend'; }
    else if (total >= 500) { activityLevel = 'Ветеран'; activityLevelClass = 'veteran'; }
    else if (total >= 100) { activityLevel = 'Активный'; activityLevelClass = 'active'; }
    else if (total >= 20) { activityLevel = 'Постоялец'; activityLevelClass = 'regular'; }
    else { activityLevel = 'Новичок'; activityLevelClass = 'newbie'; }

    // Activity heatmap bars (normalize hourly)
    const hourlyBars = hourlyMap.map(count => ({
      hour: null,
      count,
      barHeight: maxHourlyCount > 0 ? Math.max(4, Math.round((count / maxHourlyCount) * 100)) : 0,
    }));

    // Daily bars
    const dailyBars = dayNames.map((name, i) => ({
      dayName: name,
      count: dailyMap[i],
      barWidth: maxDailyCount > 0 ? Math.max(4, Math.round((dailyMap[i] / maxDailyCount) * 100)) : 0,
    }));

    return {
      user: stat._id,
      displayName: stat.displayName || stat._id,
      totalMessages: stat.totalMessages,
      totalMessagesLabel: formatNumber(stat.totalMessages),
      firstMessageAt: stat.firstMessageAt,
      firstMessageAtLabel: formatDateTime(stat.firstMessageAt),
      lastMessageAt: stat.lastMessageAt,
      lastMessageAtLabel: formatDateTime(stat.lastMessageAt),
      streamsCount,
      streamsCountLabel: formatNumber(streamsCount),
      watchTimeMinutes,
      watchTimeLabel,
      viewerSnapshotCount,
      viewerSnapshotCountLabel: formatNumber(viewerSnapshotCount),
      firstSeenAsViewerAt,
      firstSeenAsViewerAtLabel: firstSeenAsViewerAt ? formatDateTime(firstSeenAsViewerAt) : null,
      lastSeenAsViewerAt,
      lastSeenAsViewerAtLabel: lastSeenAsViewerAt ? formatDateTime(lastSeenAsViewerAt) : null,
      avgMessagesPerStream: streamsCount > 0
        ? Math.round(stat.totalMessages / streamsCount)
        : stat.totalMessages,
      avgMessagesPerStreamLabel: streamsCount > 0
        ? formatNumber(Math.round(stat.totalMessages / streamsCount))
        : formatNumber(stat.totalMessages),
      rank: rank ? rank : null,
      rankLabel: rank ? `#${rank}` : '—',
      activityLevel,
      activityLevelClass,
      peakHourLabel: peakHour >= 0 && maxHourlyCount > 0
        ? `${String(peakHour).padStart(2, '0')}:00`
        : null,
      peakDayLabel: maxDailyCount > 0 ? dayNames[peakDayIndex] : null,
      hourlyBars,
      dailyBars,
      memeStats: memeData,
      recentMessages: messages.map(mapRecentMessage),
      hasRecentMessages: messages.length > 0,
    };
  } catch (error) {
    console.error('Error loading chatter stats:', error.message);
    return null;
  }
}

async function loadStreamOverview(streamSessionId) {
  if (!streamSessionId || !isDbReady()) {
    return null;
  }

  try {
    const stream = streamSessionRepo.findById(streamSessionId);
    const donationStats = donationRepo.getSentTotals({ streamSessionId });

    if (!stream) {
      return null;
    }

    return {
      id: stream._id,
      title: stream.title || 'Без названия',
      gameName: stream.gameName || '—',
      status: stream.status,
      startedAt: stream.startedAt,
      endedAt: stream.endedAt,
      periodLabel: formatStreamPeriod(stream.startedAt, stream.endedAt),
      durationLabel: formatDuration(stream.startedAt, stream.endedAt),
      maxViewers: stream.maxViewers || 0,
      maxViewersLabel: formatNumber(stream.maxViewers),
      avgViewers: stream.avgViewers || 0,
      avgViewersLabel: formatNumber(stream.avgViewers),
      uniqueViewers: stream.uniqueViewers || 0,
      uniqueViewersLabel: formatNumber(stream.uniqueViewers),
      messagesCount: stream.messagesCount || 0,
      messagesCountLabel: formatNumber(stream.messagesCount),
      uniqueChatters: stream.uniqueChatters || 0,
      uniqueChattersLabel: formatNumber(stream.uniqueChatters),
      memesCount: stream.memesCount || 0,
      memesCountLabel: formatNumber(stream.memesCount),
      donationsCount: donationStats.donationsCount,
      donationsCountLabel: formatNumber(donationStats.donationsCount),
      donationsAmount: donationStats.donationsAmount,
      donationsAmountLabel: `${formatNumber(donationStats.donationsAmount)} ₽`,
    };
  } catch (error) {
    console.error('Error loading stream overview:', error.message);
    return null;
  }
}

async function loadDonationStats(streamSessionId) {
  const fallback = {
    dbAvailable: false,
    recentDonations: [],
    hasRecentDonations: false,
    topDonors: [],
    hasTopDonors: false,
  };

  if (!isDbReady()) {
    return fallback;
  }

  try {
    const streamId = streamSessionId || null;

    const recentDonations = donationRepo.findMany({ streamSessionId: streamId, status: 'sent', limit: DONATION_LIMIT });
    const topDonors = donationRepo.getTopDonors({ streamSessionId: streamId, limit: TOP_DONORS_LIMIT });

    const mappedRecent = recentDonations.map((donation) => ({
      donorName: donation.donorName,
      amountLabel: `${formatNumber(donation.amount)} ₽`,
      message: donation.message,
      createdAtLabel: formatShortDateTime(donation.createdAt),
    }));

    const mappedTopDonors = topDonors.map((entry, index) => ({
      position: index + 1,
      donorName: entry._id,
      donationsCount: entry.donationsCount,
      donationsCountLabel: formatNumber(entry.donationsCount),
      totalAmount: entry.totalAmount,
      totalAmountLabel: `${formatNumber(entry.totalAmount)} ₽`,
      lastAtLabel: formatShortDateTime(entry.lastAt),
    }));

    return {
      dbAvailable: true,
      recentDonations: mappedRecent,
      hasRecentDonations: mappedRecent.length > 0,
      topDonors: mappedTopDonors,
      hasTopDonors: mappedTopDonors.length > 0,
    };
  } catch (error) {
    console.error('Error loading donation stats:', error.message);
    return { ...fallback, dbAvailable: isDbReady() };
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
      totalDonations: 0,
      totalDonationsLabel: '—',
      totalDonationsAmount: 0,
      totalDonationsAmountLabel: '—',
      peakViewersAllTime: 0,
      peakViewersAllTimeLabel: '—',
      peakViewersAllTimeAtLabel: '—',
      avgStreamDuration: '—',
    };
  }

  try {
    const totalStreams = streamSessionRepo.countAll();
    const totalMessages = chatLogRepo.countAll();
    const totalMemes = memeLogRepo.countAll();
    const uniqueChatters = chatLogRepo.countDistinctUsers();
    const peakStream = streamSessionRepo.findPeakByViewers();
    const donationStats = donationRepo.getSentTotals({});

    // Calculate average stream duration
    const avgDurationMsValue = streamSessionRepo.avgDurationMs();

    let avgStreamDuration = '—';
    if (avgDurationMsValue) {
      avgStreamDuration = formatDuration(
        new Date(0),
        new Date(avgDurationMsValue)
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
      totalDonations: donationStats.donationsCount,
      totalDonationsLabel: formatNumber(donationStats.donationsCount),
      totalDonationsAmount: donationStats.donationsAmount,
      totalDonationsAmountLabel: `${formatNumber(donationStats.donationsAmount)} ₽`,
      peakViewersAllTime: peakStream ? peakStream.maxViewers : 0,
      peakViewersAllTimeLabel: formatNumber(peakStream ? peakStream.maxViewers : 0),
      peakViewersAllTimeAtLabel: peakStream ? formatDate(peakStream.lastSeenAt || peakStream.startedAt) : '—',
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
      label: 'Статус стрима',
      value: stream.statusLabel,
      accent: stream.status === 'online' ? 'success' : 'neutral',
      description: stream.status === 'online' && stream.gameName !== '—'
        ? `Сейчас в эфире: ${stream.gameName}`
        : 'Следи за анонсами в Telegram',
    },
    {
      label: 'Зрителей сейчас',
      value: stream.status === 'online' ? stream.viewerCountLabel : viewerStats.latestViewerCountLabel,
      accent: 'primary',
      description: stream.status === 'online'
        ? 'Смотери прямо сейчас на Twitch'
        : 'Последний онлайн на стриме',
    },
    {
      label: 'Сообщений за 24 часа',
      value: chatStats.totalMessages24hLabel,
      accent: 'secondary',
      description: 'Насколько живой наш чат',
    },
    {
      label: 'Уникальных зрителей за 24 часа',
      value: viewerStats.uniqueViewers24hLabel,
      accent: 'secondary',
      description: 'Сколько человек заглянуло на стрим',
    },
  ];
}

function buildProfile(hostname) {
  const embeds = buildTwitchEmbeds(hostname);

  return {
    name: DEFAULT_CHANNEL.toUpperCase(),
    handle: DEFAULT_CHANNEL,
    tagline: 'Стример, который делает стримы интересными',
    description: 'Добро пожаловать на официальный сайт NGLZZZ! Здесь ты найдёшь удобный плеер с чатом, свежие новости, топ комьюнити и способы поддержки канала.',
    links: buildSocialLinks(),
    supportLinks: buildSupportLinks(),
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
  const streamSessionId = await resolveStreamSessionId(filters?.streamId);
  const chatterName = filters?.chatter || null;

  const [shared, streamSessions, memeStats, overallStats, chatterStats, streamOverview, donationStats] = await Promise.all([
    buildSharedSiteData(hostname),
    loadStreamSessions(),
    loadMemeStats(streamSessionId),
    loadOverallStats(),
    chatterName ? loadChatterStats(chatterName) : Promise.resolve(null),
    loadStreamOverview(streamSessionId),
    loadDonationStats(streamSessionId),
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
    streamOverview,
    donationStats,
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
  const streamSessionId = await resolveStreamSessionId(filters?.streamId);

  const [shared, streamSessions, memeStats, overallStats, streamOverview, donationStats] = await Promise.all([
    buildSharedSiteData(hostname),
    loadStreamSessions(),
    loadMemeStats(streamSessionId),
    loadOverallStats(),
    loadStreamOverview(streamSessionId),
    loadDonationStats(streamSessionId),
  ]);

  return {
    generatedAt: shared.generatedAt,
    stream: shared.stream,
    viewerStats: shared.viewerStats,
    chatStats: shared.chatStats,
    streamSessions,
    memeStats,
    overallStats,
    streamOverview,
    donationStats,
  };
}

module.exports = {
  buildHomePageData,
  buildStatsPageData,
  getSummaryApiData,
  getStatsApiData,
  loadChatterStats,
};
