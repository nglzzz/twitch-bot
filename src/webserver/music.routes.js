'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const repo = require('../repositories/music.repo');
const { getMusicService, getSettingsStore, rememberPublicBase } = require('../services/music');
const { applyForm, ROLES, ROLE_LABELS } = require('../services/music/musicSettings.service');
const { formatDuration, adminRequest } = require('../services/music/musicFormat');
const youtube = require('../music/providers/youtube.provider');

const OBS_CSP = [
  "default-src 'self' 'unsafe-inline' data:",
  "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
  'connect-src *',
  'img-src * data: blob:',
  'font-src * data:',
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'media-src * blob: data:',
].join('; ');

const ADMIN_TABS = [
  { id: 'player', label: 'Плеер' },
  { id: 'history', label: 'История' },
  { id: 'settings', label: 'Настройки' },
  { id: 'blacklist', label: 'Чёрные списки' },
  { id: 'obs', label: 'OBS' },
];

const STATUS_LABELS = { played: 'сыграл', skipped: 'пропущен', failed: 'ошибка', removed: 'удалён', queued: 'в очереди', playing: 'играет' };
const SOURCE_LABELS = { chat: 'Чат', donation: 'Донат', admin: 'Админка', backup: 'Бэкап' };
const REASON_LABELS = { vote: 'голосование', interrupted: 'прерван заказом', removed: 'удалён', blacklisted: 'чёрный список', skipped: 'скип', superseded: 'заменён заказом' };

function tokensEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

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

/** JSON для встраивания в <script>: экранируем всё, что может закрыть тег. */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function createMusicRouter({ requireAdmin, requireCsrf, adminPage }) {
  const router = express.Router();
  const json = express.json({ limit: '32kb' });
  const form = express.urlencoded({ extended: false, limit: '64kb' });

  const unavailable = (res) => res.status(503).json({ ok: false, message: 'База данных недоступна' });

  function requireObsToken(kind) {
    return (req, res, next) => {
      const settings = getSettingsStore().get();
      const expected = kind === 'dock' ? settings.obs.dockToken : settings.obs.overlayToken;
      const provided = req.get('x-music-token') || req.query.token || req.body?.token;
      if (!tokensEqual(provided, expected)) {
        if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.status(404).send('Not found');
        return res.status(401).json({ ok: false, message: 'Неверный токен' });
      }
      return next();
    };
  }

  // ---------- публичное ----------

  router.get('/music', (req, res) => {
    const music = getMusicService();
    res.render('pages/music', {
      pageTitle: 'NGLZZZ — заказ музыки',
      pageDescription: 'Что играет на стриме и очередь заказанных треков.',
      currentPage: 'music',
      navigation: require('../services/streamerSite.service').buildNavigation('music'),
      available: Boolean(music),
      initialJson: safeJson(music ? { state: music.getState(), queue: music.getQueue() } : null),
      websocketPort: websocketPort(),
    });
  });

  router.get('/api/music/state', (req, res) => {
    const music = getMusicService();
    if (!music) return unavailable(res);
    return res.json({ state: music.getState(), queue: music.getQueue() });
  });

  // ---------- OBS ----------

  router.get('/music/overlay', requireObsToken('overlay'), (req, res) => {
    const music = getMusicService();
    const settings = getSettingsStore().get();
    const mode = ['player', 'video'].includes(req.query.mode) ? req.query.mode : settings.obs.overlayMode;
    res.set('Content-Security-Policy', OBS_CSP);
    // Встроенный плеер YouTube требует Referer; helmet по умолчанию его отключает.
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.removeHeader('X-Frame-Options');
    res.render('pages/music-overlay', {
      layout: 'overlay',
      pageTitle: 'Музыка — оверлей',
      currentPage: 'music-overlay',
      mode,
      initialJson: safeJson(music ? { state: music.getState(), queue: music.getQueue() } : null),
      websocketPort: websocketPort(),
    });
  });

  router.get('/music/dock', requireObsToken('dock'), (req, res) => {
    const music = getMusicService();
    res.set('Content-Security-Policy', OBS_CSP);
    // Встроенный плеер YouTube требует Referer; helmet по умолчанию его отключает.
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.removeHeader('X-Frame-Options');
    res.render('pages/music-dock', {
      layout: 'overlay',
      pageTitle: 'Музыка — плеер',
      currentPage: 'music-dock',
      token: req.query.token,
      initialJson: safeJson(music ? { state: music.getState(), queue: music.getQueue() } : null),
      websocketPort: websocketPort(),
    });
  });

  router.post('/api/music/player/register', json, requireObsToken('dock'), (req, res) => {
    const music = getMusicService();
    if (!music) return unavailable(res);
    const playerId = String(req.body?.playerId || '').trim();
    if (!playerId) return res.status(422).json({ ok: false, message: 'playerId is required' });
    return res.json({ ok: true, state: music.registerPlayer(playerId, { takeover: req.body?.takeover !== false }) });
  });

  router.post('/api/music/player/report', json, requireObsToken('dock'), async (req, res, next) => {
    try {
      const music = getMusicService();
      if (!music) return unavailable(res);
      const body = req.body || {};
      return res.json(await music.playerReport({
        playerId: String(body.playerId || ''),
        event: String(body.event || ''),
        requestId: String(body.requestId || ''),
        position: body.position,
        errorCode: body.errorCode,
        seekSeq: body.seekSeq,
      }));
    } catch (error) { return next(error); }
  });

  async function control(music, action, value) {
    switch (action) {
      case 'play': return music.play();
      case 'pause': return music.pause();
      case 'skip': return music.skip('skipped');
      case 'volume': return music.setVolume(value);
      case 'seek': return music.seek(value);
      default: return { ok: false, message: 'Неизвестное действие' };
    }
  }

  router.post('/api/music/control', json, requireObsToken('dock'), async (req, res, next) => {
    try {
      const music = getMusicService();
      if (!music) return unavailable(res);
      const result = await control(music, String(req.body?.action || ''), req.body?.value);
      return res.json({ ...result, state: music.getState() });
    } catch (error) { return next(error); }
  });

  // ---------- админка ----------

  function renderAdmin(req, res) {
    // Адрес берём только из админки: Host публичных запросов может подделать кто угодно.
    rememberPublicBase(publicBase(req));
    const music = getMusicService();
    const tab = ADMIN_TABS.some((item) => item.id === req.query.tab) ? req.query.tab : 'player';
    const settings = getSettingsStore().get();
    const base = publicBase(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 50;
    let history = [];
    let historyTotal = 0;
    if (music && tab === 'history') {
      historyTotal = repo.countHistory();
      history = repo.findHistory({ limit: perPage, offset: (page - 1) * perPage }).map((item) => ({
        ...adminRequest(item),
        statusLabel: STATUS_LABELS[item.status] || item.status,
        reasonLabel: REASON_LABELS[item.statusReason] || item.statusReason || '',
        sourceLabel: SOURCE_LABELS[item.source] || item.source,
        finishedAtLabel: formatDate(item.finishedAt || item.updatedAt),
      }));
    }
    const totalPages = Math.max(1, Math.ceil(historyTotal / perPage));
    return res.render('pages/admin-music', adminPage('music', {
      pageTitle: 'Админка — музыка',
      available: Boolean(music),
      tab,
      tabs: ADMIN_TABS.map((item) => ({ ...item, isActive: item.id === tab, href: `/admin/music?tab=${item.id}` })),
      isPlayerTab: tab === 'player',
      isHistoryTab: tab === 'history',
      isSettingsTab: tab === 'settings',
      isBlacklistTab: tab === 'blacklist',
      isObsTab: tab === 'obs',
      settings,
      blockedTagsText: settings.filters.blockedTags.join('\n'),
      maxFreeDurationMin: Math.round((settings.limits.maxFreeDurationSec / 60) * 100) / 100,
      maxPaidDurationMin: Math.round((settings.limits.maxPaidDurationSec / 60) * 100) / 100,
      requestRoleOptions: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role], checked: settings.community.requestRoles.includes(role) })),
      skipRoleOptions: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role], selected: settings.community.skipRole === role })),
      playTypeOptions: [
        { value: 'all', label: 'Все', selected: settings.playTypes === 'all' },
        { value: 'free', label: 'Только бесплатные', selected: settings.playTypes === 'free' },
        { value: 'paid', label: 'Только донатные', selected: settings.playTypes === 'paid' },
      ],
      overlayModeOptions: [
        { value: 'player', label: 'Плеер (карточка трека)', selected: settings.obs.overlayMode === 'player' },
        { value: 'video', label: 'Видео на фоне', selected: settings.obs.overlayMode === 'video' },
      ],
      backupInfo: music ? music.getBackupInfo() : null,
      history,
      hasHistory: history.length > 0,
      historyPage: page,
      historyTotalPages: totalPages,
      historyPrevHref: page > 1 ? `/admin/music?tab=history&page=${page - 1}` : null,
      historyNextHref: page < totalPages ? `/admin/music?tab=history&page=${page + 1}` : null,
      blacklistedTracks: music ? repo.listBlacklistedTracks().map((item) => ({ ...item, createdAtLabel: formatDate(item.createdAt), url: item.provider === 'youtube' ? `https://www.youtube.com/watch?v=${item.externalId}` : '' })) : [],
      blacklistedUsers: music ? repo.listBlacklistedUsers().map((item) => ({ ...item, createdAtLabel: formatDate(item.createdAt) })) : [],
      overlayUrl: `${base}/music/overlay?token=${encodeURIComponent(settings.obs.overlayToken)}`,
      overlayVideoUrl: `${base}/music/overlay?token=${encodeURIComponent(settings.obs.overlayToken)}&mode=video`,
      dockUrl: `${base}/music/dock?token=${encodeURIComponent(settings.obs.dockToken)}`,
      publicUrl: `${base}/music`,
      initialJson: safeJson(music ? { state: music.getState(), queue: music.getQueue({ admin: true }) } : null),
      websocketPort: websocketPort(),
      success: req.query.success || null,
      error: req.query.error || null,
    }));
  }

  router.get('/admin/music', requireAdmin, (req, res, next) => {
    try { return renderAdmin(req, res); } catch (error) { return next(error); }
  });

  const redirect = (res, tab, key, message) => res.redirect(`/admin/music?tab=${tab}&${key}=${encodeURIComponent(message)}`);

  router.post('/admin/music/settings', form, requireAdmin, requireCsrf, (req, res) => {
    try {
      const store = getSettingsStore();
      store.save(applyForm(store.get(), req.body));
      const music = getMusicService();
      if (music) music.onSettingsChanged();
      return redirect(res, req.body._tab || 'settings', 'success', 'Настройки сохранены');
    } catch (error) { return redirect(res, 'settings', 'error', errorMessage(error)); }
  });

  router.post('/admin/music/obs/regenerate', form, requireAdmin, requireCsrf, (req, res) => {
    const kind = req.body.kind === 'dock' ? 'dock' : 'overlay';
    getSettingsStore().regenerateToken(kind);
    return redirect(res, 'obs', 'success', kind === 'dock' ? 'Ссылка плеера перевыпущена — обновите док в OBS' : 'Ссылка оверлея перевыпущена — обновите источник в OBS');
  });

  router.post('/admin/music/backup/reload', form, requireAdmin, requireCsrf, async (req, res) => {
    const music = getMusicService();
    if (music) await music.reloadBackup();
    const info = music ? music.getBackupInfo() : { count: 0 };
    return redirect(res, 'settings', info.count ? 'success' : 'error', info.count ? `Бэкап-плейлист загружен: ${info.count} треков` : 'Не удалось загрузить плейлист');
  });

  router.post('/admin/music/blacklist/track', form, requireAdmin, requireCsrf, async (req, res) => {
    try {
      if (req.body.action === 'remove') {
        repo.removeBlacklistedTrack(String(req.body.provider || 'youtube'), String(req.body.externalId || ''));
        return redirect(res, 'blacklist', 'success', 'Трек удалён из чёрного списка');
      }
      const resolved = await youtube.resolve(String(req.body.input || ''));
      if (!resolved?.track) throw new Error('Трек не найден');
      repo.addBlacklistedTrack({ provider: resolved.track.provider, externalId: resolved.track.externalId, title: resolved.track.title });
      return redirect(res, 'blacklist', 'success', `«${resolved.track.title}» добавлен в чёрный список`);
    } catch (error) { return redirect(res, 'blacklist', 'error', errorMessage(error)); }
  });

  router.post('/admin/music/blacklist/user', form, requireAdmin, requireCsrf, (req, res) => {
    const login = String(req.body.login || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{2,25}$/.test(login)) return redirect(res, 'blacklist', 'error', 'Некорректный ник');
    if (req.body.action === 'remove') repo.removeBlacklistedUser(login);
    else repo.addBlacklistedUser(login);
    return redirect(res, 'blacklist', 'success', req.body.action === 'remove' ? `@${login} удалён из чёрного списка` : `@${login} добавлен в чёрный список`);
  });

  // JSON API для интерактивного плеера админки (CSRF в теле запроса).
  const adminApi = (handler) => [json, requireAdmin, requireCsrf, async (req, res) => {
    const music = getMusicService();
    if (!music) return unavailable(res);
    try {
      const result = await handler(music, req.body || {}, req);
      return res.json({ ok: true, ...result, state: music.getState(), queue: music.getQueue({ admin: true }) });
    } catch (error) {
      return res.status(400).json({ ok: false, message: errorMessage(error) });
    }
  }];

  router.post('/admin/music/api/control', ...adminApi((music, body) => control(music, String(body.action || ''), body.value)));
  router.post('/admin/music/api/reorder', ...adminApi((music, body) => music.reorder(body.ids)));
  router.post('/admin/music/api/remove', ...adminApi((music, body) => music.removeRequest(String(body.id || ''))));
  router.post('/admin/music/api/blacklist', ...adminApi((music, body) => music.blacklistRequest(String(body.id || ''))));
  router.post('/admin/music/api/add', ...adminApi((music, body, req) => music.requestTrack({
    input: String(body.input || ''),
    requester: { login: req.adminUser.username, display: req.adminUser.displayName || req.adminUser.username },
    source: 'admin',
  })));
  router.get('/admin/music/api/queue', requireAdmin, (req, res) => {
    const music = getMusicService();
    if (!music) return unavailable(res);
    return res.json({ ok: true, state: music.getState(), queue: music.getQueue({ admin: true }) });
  });

  return router;
}

module.exports = { createMusicRouter, formatDuration, tokensEqual, safeJson };
