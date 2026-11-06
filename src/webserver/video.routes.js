'use strict';

const express = require('express');
const config = require('../config');
const repo = require('../repositories/video.repo');
const { getVideoService, getSettingsStore } = require('../services/video');
const { rememberPublicBase } = require('../services/music');
const { applyForm, LIMIT_ROLES } = require('../services/video/videoSettings.service');
const { ROLES, ROLE_LABELS } = require('../services/music/musicSettings.service');
const { adminRequest, formatDuration } = require('../services/video/videoFormat');
const providers = require('../video/providers');
const { safeJson } = require('./music.routes');

// Страница плеера встраивает ролики с разных площадок.
const PLAYER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com https://player.twitch.tv https://player.vimeo.com",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://www.tiktok.com https://player.twitch.tv https://clips.twitch.tv https://player.vimeo.com https://streamable.com',
  "connect-src 'self' ws: wss:",
  'img-src * data: blob:',
  'media-src * blob: data:',
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
].join('; ');

const SETTINGS_TABS = [
  { id: 'settings', label: 'Настройки' },
  { id: 'history', label: 'История' },
  { id: 'blacklist', label: 'Чёрные списки' },
];

const STATUS_LABELS = { played: 'показано', skipped: 'пропущено', failed: 'ошибка', removed: 'удалено', queued: 'в очереди', playing: 'идёт' };
const SOURCE_LABELS = { chat: 'Чат', donation: 'Донат', admin: 'Стример' };
const REASON_LABELS = {
  vote: 'голосование', paid_end: 'кончилось оплаченное время', removed: 'удалено', blacklisted: 'чёрный список',
  skipped: 'скип', cancelled: 'отменил заказчик', message_deleted: 'сообщение удалено', cleared: 'очередь очищена',
};
const ROLE_LIMIT_LABELS = { everyone: 'Все', follower: 'Фолловеры', subscriber: 'Подписчики', vip: 'VIP', moderator: 'Модераторы' };
const PROVIDER_OPTIONS = [
  { key: 'youtube', label: 'YouTube — видео' },
  { key: 'shorts', label: 'YouTube Shorts' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'twitchClips', label: 'Twitch — клипы' },
  { key: 'twitchVods', label: 'Twitch — записи трансляций' },
  { key: 'vimeo', label: 'Vimeo' },
  { key: 'streamable', label: 'Streamable' },
];

function websocketPort() {
  return config.DOCKER_WEBSOCKET_PORT || config.WEBSOCKET_PORT || 8081;
}

function publicBase(req) {
  if (config.SITE_PUBLIC_URL) return config.SITE_PUBLIC_URL.replace(/\/+$/, '');
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${host}`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: config.TIMEZONE }).format(new Date(value));
}

function errorMessage(error) {
  return error?.message || 'Не удалось выполнить действие.';
}

const minutes = (sec) => Math.round((sec / 60) * 100) / 100;

function createVideoRouter({ requireAdmin, requireCsrf, adminPage }) {
  const router = express.Router();
  const json = express.json({ limit: '32kb' });
  const form = express.urlencoded({ extended: false, limit: '64kb' });
  const unavailable = (res) => res.status(503).json({ ok: false, message: 'База данных недоступна' });

  // ---------- публичное ----------

  router.get('/video', (req, res) => {
    const video = getVideoService();
    res.render('pages/video', {
      pageTitle: 'NGLZZZ — заказ видео',
      pageDescription: 'Какое видео идёт на стриме и очередь заказов.',
      currentPage: 'video',
      navigation: require('../services/streamerSite.service').buildNavigation('video'),
      available: Boolean(video),
      initialJson: safeJson(video ? { state: video.getState(), queue: video.getQueue() } : null),
      websocketPort: websocketPort(),
    });
  });

  router.get('/api/video/state', (req, res) => {
    const video = getVideoService();
    if (!video) return unavailable(res);
    return res.json({ state: video.getState(), queue: video.getQueue() });
  });

  // ---------- страница плеера (её захватывают в OBS) ----------

  router.get('/admin/video', requireAdmin, (req, res) => {
    rememberPublicBase(publicBase(req));
    const video = getVideoService();
    res.set('Content-Security-Policy', PLAYER_CSP);
    // Встроенные плееры требуют Referer; helmet по умолчанию его отключает.
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.render('pages/admin-video', {
      layout: 'overlay',
      pageTitle: 'Видео — плеер',
      currentPage: 'admin-video',
      available: Boolean(video),
      initialJson: safeJson(video ? { state: video.getState({ admin: true }), queue: video.getQueue({ admin: true }) } : null),
      websocketPort: websocketPort(),
      settingsUrl: '/admin/video/settings',
    });
  });

  // ---------- настройки ----------

  function renderSettings(req, res) {
    rememberPublicBase(publicBase(req));
    const video = getVideoService();
    const tab = SETTINGS_TABS.some((item) => item.id === req.query.tab) ? req.query.tab : 'settings';
    const s = getSettingsStore().get();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 50;
    let history = [];
    let historyTotal = 0;
    if (video && tab === 'history') {
      historyTotal = repo.countHistory();
      history = repo.findHistory({ limit: perPage, offset: (page - 1) * perPage }).map((item) => ({
        ...adminRequest(item),
        statusLabel: STATUS_LABELS[item.status] || item.status,
        reasonLabel: REASON_LABELS[item.statusReason] || item.statusReason || '',
        sourceLabel: SOURCE_LABELS[item.source] || item.source,
        finishedAtLabel: formatDate(item.finishedAt || item.updatedAt),
        hasVotes: item.votesSkip || item.votesKeep,
      }));
    }
    const totalPages = Math.max(1, Math.ceil(historyTotal / perPage));
    const base = publicBase(req);
    return res.render('pages/admin-video-settings', adminPage('video', {
      pageTitle: 'Админка — видео',
      available: Boolean(video),
      tab,
      tabs: SETTINGS_TABS.map((item) => ({ ...item, isActive: item.id === tab, href: `/admin/video/settings?tab=${item.id}` })),
      isSettingsTab: tab === 'settings',
      isHistoryTab: tab === 'history',
      isBlacklistTab: tab === 'blacklist',
      settings: s,
      playerUrl: `${base}/admin/video`,
      publicUrl: `${base}/video`,
      maxFreeDurationMin: minutes(s.limits.maxFreeDurationSec),
      maxPaidDurationMin: minutes(s.limits.maxPaidDurationSec),
      skipWordsText: s.voting.skipWords.join('\n'),
      keepWordsText: s.voting.keepWords.join('\n'),
      providerOptions: PROVIDER_OPTIONS.map((item) => ({ ...item, name: `providers.${item.key}`, checked: s.providers[item.key] })),
      roleLimitOptions: LIMIT_ROLES.map((role) => ({ role, label: ROLE_LIMIT_LABELS[role], name: `limits.roleLimits.${role}`, value: s.limits.roleLimits[role] })),
      skipRoleOptions: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role], selected: s.control.skipRole === role })),
      linkModeOptions: [
        { value: 'any', label: 'Любая ссылка в чате', selected: s.chat.linkMode === 'any' },
        { value: 'command', label: 'Только командой !video', selected: s.chat.linkMode === 'command' },
      ],
      replyOptions: [
        { value: 'all', label: 'На все заказы', selected: s.chat.replies === 'all' },
        { value: 'errors', label: 'Только об ошибках', selected: s.chat.replies === 'errors' },
        { value: 'none', label: 'Не отвечать', selected: s.chat.replies === 'none' },
      ],
      voteActionOptions: [
        { value: 'warning', label: 'Пауза и отсчёт — стример может отменить', selected: s.voting.action === 'warning' },
        { value: 'skip', label: 'Пропустить сразу', selected: s.voting.action === 'skip' },
      ],
      paidEndOptions: [
        { value: 'warning', label: 'Пауза и отсчёт — стример может досмотреть', selected: s.paid.endAction === 'warning' },
        { value: 'cut', label: 'Сразу следующее видео', selected: s.paid.endAction === 'cut' },
      ],
      history,
      hasHistory: history.length > 0,
      historyTotal,
      historyPage: page,
      historyTotalPages: totalPages,
      historyPrevHref: page > 1 ? `/admin/video/settings?tab=history&page=${page - 1}` : null,
      historyNextHref: page < totalPages ? `/admin/video/settings?tab=history&page=${page + 1}` : null,
      blacklistedItems: video ? repo.listBlacklistedItems().map((item) => ({ ...item, createdAtLabel: formatDate(item.createdAt) })) : [],
      blacklistedUsers: video ? repo.listBlacklistedUsers().map((item) => ({ ...item, createdAtLabel: formatDate(item.createdAt) })) : [],
      blacklistedChannels: video ? repo.listBlacklistedChannels().map((item) => ({ ...item, createdAtLabel: formatDate(item.createdAt) })) : [],
      success: req.query.success || null,
      error: req.query.error || null,
    }));
  }

  router.get('/admin/video/settings', requireAdmin, (req, res, next) => {
    try { return renderSettings(req, res); } catch (error) { return next(error); }
  });

  const redirect = (res, tab, key, message) => res.redirect(`/admin/video/settings?tab=${tab}&${key}=${encodeURIComponent(message)}`);

  router.post('/admin/video/settings', form, requireAdmin, requireCsrf, (req, res) => {
    try {
      const store = getSettingsStore();
      store.save(applyForm(store.get(), req.body));
      const video = getVideoService();
      if (video) video.onSettingsChanged();
      return redirect(res, 'settings', 'success', 'Настройки сохранены');
    } catch (error) { return redirect(res, 'settings', 'error', errorMessage(error)); }
  });

  router.post('/admin/video/history/clear', form, requireAdmin, requireCsrf, (req, res) => {
    repo.clearHistory();
    return redirect(res, 'history', 'success', 'История очищена');
  });

  router.post('/admin/video/blacklist/item', form, requireAdmin, requireCsrf, async (req, res) => {
    try {
      if (req.body.action === 'remove') {
        repo.removeBlacklistedItem(String(req.body.provider || ''), String(req.body.externalId || ''));
        return redirect(res, 'blacklist', 'success', 'Видео удалено из чёрного списка');
      }
      const link = providers.find(String(req.body.input || ''));
      const track = link ? await providers.resolve(link) : null;
      if (!track) throw new Error('Не удалось найти видео по ссылке');
      repo.addBlacklistedItem({ provider: track.provider, externalId: track.externalId, title: track.title });
      return redirect(res, 'blacklist', 'success', `«${track.title}» добавлено в чёрный список`);
    } catch (error) { return redirect(res, 'blacklist', 'error', errorMessage(error)); }
  });

  router.post('/admin/video/blacklist/channel', form, requireAdmin, requireCsrf, async (req, res) => {
    try {
      if (req.body.action === 'remove') {
        repo.removeBlacklistedChannel(String(req.body.provider || ''), String(req.body.channelId || ''));
        return redirect(res, 'blacklist', 'success', 'Канал удалён из чёрного списка');
      }
      const link = providers.find(String(req.body.input || ''));
      const track = link ? await providers.resolve(link) : null;
      if (!track || !track.channelId) throw new Error('Не удалось определить канал — укажите ссылку на любое видео с него');
      repo.addBlacklistedChannel({ provider: track.provider, channelId: track.channelId, name: track.author });
      return redirect(res, 'blacklist', 'success', `Канал «${track.author || track.channelId}» добавлен в чёрный список`);
    } catch (error) { return redirect(res, 'blacklist', 'error', errorMessage(error)); }
  });

  router.post('/admin/video/blacklist/user', form, requireAdmin, requireCsrf, (req, res) => {
    const login = String(req.body.login || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{2,25}$/.test(login)) return redirect(res, 'blacklist', 'error', 'Некорректный ник');
    if (req.body.action === 'remove') repo.removeBlacklistedUser(login);
    else repo.addBlacklistedUser(login);
    return redirect(res, 'blacklist', 'success', req.body.action === 'remove' ? `@${login} удалён из чёрного списка` : `@${login} добавлен в чёрный список`);
  });

  // ---------- JSON API плеера (CSRF в теле запроса) ----------

  async function control(video, action, value, req) {
    switch (action) {
      case 'play': return video.play();
      case 'pause': return video.pause();
      case 'toggle': return video.getState().status === 'playing' ? video.pause() : video.play();
      case 'skip': return video.skip('skipped');
      case 'seek': return video.seek(value);
      case 'volume': return video.setVolume(value);
      case 'playbackRate': return video.setPlaybackRate(value);
      case 'loop': return video.setLoop(value);
      case 'lock': return video.toggleLock();
      case 'cancelWarning': return video.cancelWarning();
      case 'accepting': return video.setAccepting(Boolean(value));
      case 'reorder': return Array.isArray(value) ? video.reorder(value.slice(0, 1000)) : { ok: false, message: 'Нужен список заявок' };
      case 'remove': return video.removeRequest(String(value || ''));
      case 'top': return video.moveToTop(String(value || ''));
      case 'blacklist': return video.blacklistRequest(String(value?.id || value || ''), { channel: Boolean(value?.channel), user: Boolean(value?.user) });
      case 'clear': return video.clearQueue();
      case 'add': return video.requestVideo({
        input: String(value || ''),
        requester: { login: req.adminUser.username, display: req.adminUser.displayName || req.adminUser.username },
        source: 'admin',
      });
      default: return { ok: false, message: 'Неизвестное действие' };
    }
  }

  // light: отвечать только результатом (отчёты плеера приходят каждую секунду, состояние идёт по WebSocket).
  const adminApi = (handler, { light = false } = {}) => [json, requireAdmin, (req, res, next) => {
    // requireCsrf отвечает HTML-страницей; для JSON API отвечаем JSON.
    const { csrfToken } = require('../services/adminAuth.service');
    if (!req.adminSession || typeof csrfToken !== 'function' || req.body?._csrf !== csrfToken(req.adminSession)) {
      return res.status(403).json({ ok: false, message: 'Сессия устарела — обновите страницу.' });
    }
    return next();
  }, async (req, res) => {
    const video = getVideoService();
    if (!video) return unavailable(res);
    try {
      const result = await handler(video, req.body || {}, req);
      if (light && req.body.event !== 'playing' && req.body.event !== 'paused') return res.json(result || { ok: true });
      return res.json({ ...result, ok: result?.ok !== false, state: video.getState({ admin: true }), queue: video.getQueue({ admin: true }) });
    } catch (error) {
      return res.status(400).json({ ok: false, message: errorMessage(error) });
    }
  }];

  router.post('/admin/video/api/control', ...adminApi((video, body, req) => control(video, String(body.action || ''), body.value, req)));
  router.post('/admin/video/api/player/register', ...adminApi((video, body) => {
    const playerId = String(body.playerId || '').trim();
    if (!playerId) return { ok: false, message: 'playerId is required' };
    video.registerPlayer(playerId, { takeover: body.takeover !== false });
    return { ok: true };
  }));
  router.post('/admin/video/api/player/report', ...adminApi((video, body) => video.playerReport({
    playerId: String(body.playerId || ''),
    event: String(body.event || ''),
    requestId: String(body.requestId || ''),
    position: body.position,
    duration: body.duration,
    errorCode: body.errorCode,
    seekSeq: body.seekSeq,
    seq: body.seq,
    playbackSeq: body.playbackSeq,
  }), { light: true }));
  router.get('/admin/video/api/state', requireAdmin, (req, res) => {
    const video = getVideoService();
    if (!video) return unavailable(res);
    return res.json({ ok: true, state: video.getState({ admin: true }), queue: video.getQueue({ admin: true }) });
  });

  return router;
}

module.exports = { createVideoRouter, formatDuration };
