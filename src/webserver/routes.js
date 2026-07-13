const express = require('express');
const routes = express.Router();
const db = require('../app/db');
const config = require('../config');
const AdminUser = require('../models/adminUser.model');
const Donation = require('../models/donation.model');
const ScheduledDonation = require('../models/scheduledDonation.model');
const ScheduledMeme = require('../models/scheduledMeme.model');
const speech = require('../utils/speech');
const {
  ensureInitialAdmin,
  verifyPassword,
  createPasswordHash,
  DEFAULT_PASSWORD,
  requireAdmin,
  requireCsrf,
  setSessionCookie,
  clearSessionCookie,
} = require('../services/adminAuth.service');
const { getSettings, getRuntimeSettings, getSettingsView, updateSettings } = require('../services/adminSettings.service');
const { createAndSendDonation, refreshDonationAlertsConnection } = require('../services/donations.service');
const randomMeme = require('../rewards/randomMeme');
const { publishChatMessage } = require('../services/overlayChat.service');
const {
  buildHomePageData,
  buildStatsPageData,
  getSummaryApiData,
  getStatsApiData,
  loadChatterStats,
} = require('../services/streamerSite.service');

const adminForm = express.urlencoded({ extended: false, limit: '32kb' });

function isDbReady() {
  return db?.connection?.readyState === 1;
}

function adminNavigation(currentPage) {
  return [
    { label: 'Обзор', href: '/admin', isActive: currentPage === 'dashboard' },
    { label: 'Настройки', href: '/admin/settings', isActive: currentPage === 'settings' },
    { label: 'Донаты по расписанию', href: '/admin/donations', isActive: currentPage === 'donations' },
    { label: 'Все донаты', href: '/admin/donations/history', isActive: currentPage === 'donation-history' },
    { label: 'Мемы по расписанию', href: '/admin/memes', isActive: currentPage === 'memes' },
    { label: 'Пользователи', href: '/admin/users', isActive: currentPage === 'users' },
  ];
}

function formatAdminDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.TIMEZONE }).format(new Date(value));
}

function toAdminDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((map, part) => ({ ...map, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function getFormError(error) {
  return error?.response?.data?.message || error?.message || 'Не удалось выполнить действие.';
}

function parseScheduledAt(value) {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) throw new Error('Укажите дату и время в будущем.');
  return parsed;
}

function parseAmount(value) {
  const amount = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Сумма должна быть больше нуля.');
  return Math.round(amount * 100) / 100;
}

function adminPage(currentPage, data) {
  return {
    layout: 'admin',
    currentPage,
    navigation: adminNavigation(currentPage),
    pageTitle: `Админка — ${currentPage}`,
    ...data,
  };
}

function getPublicHost(req) {
  return req.get('x-forwarded-host') || req.get('host') || req.hostname;
}

routes.get('/admin/login', (req, res) => {
  if (!config.ADMIN_SESSION_SECRET) {
    return res.status(503).render('pages/admin-login', { layout: 'admin', pageTitle: 'Админка недоступна', configurationError: 'Задайте ADMIN_SESSION_SECRET в .env и перезапустите приложение.' });
  }
  if (!config.CHANNEL) {
    return res.status(503).render('pages/admin-login', { layout: 'admin', pageTitle: 'Админка недоступна', configurationError: 'Задайте CHANNEL в .env и перезапустите приложение.' });
  }
  return res.render('pages/admin-login', { layout: 'admin', pageTitle: 'Вход в админку', error: req.query.error || null, temporaryPassword: DEFAULT_PASSWORD });
});

routes.post('/admin/login', adminForm, async (req, res, next) => {
  try {
    if (!isDbReady()) return res.redirect('/admin/login?error=MongoDB%20недоступна');
    await ensureInitialAdmin();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await AdminUser.findOne({ username });
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      return res.redirect('/admin/login?error=Неверный%20логин%20или%20пароль');
    }
    user.lastLoginAt = new Date();
    await user.save();
    setSessionCookie(req, res, user);
    return res.redirect(user.mustChangePassword ? '/admin/change-password' : '/admin');
  } catch (error) {
    return next(error);
  }
});

routes.post('/admin/logout', adminForm, requireAdmin, requireCsrf, (req, res) => {
  clearSessionCookie(res);
  return res.redirect('/admin/login');
});

routes.get('/admin/change-password', requireAdmin, (req, res) => res.render('pages/admin-change-password', adminPage('change-password', {
  pageTitle: 'Смена пароля',
  mustChangePassword: req.adminUser.mustChangePassword,
  error: req.query.error || null,
})));

routes.post('/admin/change-password', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  const password = String(req.body.password || '');
  const confirmation = String(req.body.confirmation || '');
  if (password.length < 12) return res.redirect('/admin/change-password?error=Пароль+должен+содержать+минимум+12+символов');
  if (password !== confirmation) return res.redirect('/admin/change-password?error=Пароли+не+совпадают');
  if (password === DEFAULT_PASSWORD) return res.redirect('/admin/change-password?error=Нельзя+оставить+временный+пароль');
  const user = await AdminUser.findById(req.adminUser._id);
  user.passwordHash = createPasswordHash(password);
  user.mustChangePassword = false;
  await user.save();
  return res.redirect('/admin?success=Пароль+изменён');
});

routes.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const [recentDonations, pendingDonations, pendingMemes, totals] = await Promise.all([
      Donation.find().sort({ createdAt: -1 }).limit(12).lean(),
      ScheduledDonation.countDocuments({ status: 'pending' }),
      ScheduledMeme.countDocuments({ status: 'pending' }),
      Donation.aggregate([{ $match: { status: 'sent' } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    ]);
    return res.render('pages/admin-dashboard', adminPage('dashboard', {
      recentDonations: recentDonations.map((item) => ({ ...item, amountLabel: `${item.amount} ${item.currency}`, createdAtLabel: formatAdminDate(item.createdAt) })),
      hasRecentDonations: recentDonations.length > 0,
      totalDonations: totals[0]?.count || 0,
      totalAmount: (totals[0]?.amount || 0).toLocaleString('ru-RU'),
      pendingDonations,
      pendingMemes,
      success: req.query.success || null,
      error: req.query.error || null,
    }));
  } catch (error) { return next(error); }
});

routes.post('/admin/test-donation', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  try {
    await createAndSendDonation({
      donorName: String(req.body.donorName || '').trim() || 'Anonymous',
      donorId: `manual-${Date.now()}`,
      amount: parseAmount(req.body.amount),
      currency: String(req.body.currency || 'RUB').toUpperCase(),
      message: String(req.body.message || '').trim(),
    }, 'manual');
    return res.redirect('/admin?success=Тестовый+донат+отправлен+в+StreamElements');
  } catch (error) {
    return res.redirect(`/admin?error=${encodeURIComponent(getFormError(error))}`);
  }
});

routes.get('/admin/settings', requireAdmin, async (req, res, next) => {
  try {
    const settings = await getSettings();
    return res.render('pages/admin-settings', adminPage('settings', { settings: getSettingsView(settings), success: req.query.success || null, error: req.query.error || null }));
  } catch (error) { return next(error); }
});

routes.post('/admin/settings', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  try {
    await updateSettings(req.body);
    await refreshDonationAlertsConnection();
    return res.redirect('/admin/settings?success=Настройки+сохранены');
  } catch (error) {
    return res.redirect(`/admin/settings?error=${encodeURIComponent(getFormError(error))}`);
  }
});

routes.get('/admin/donations', requireAdmin, async (req, res, next) => {
  try {
    const items = await ScheduledDonation.find().sort({ scheduledFor: 1 }).limit(100).lean();
    return res.render('pages/admin-donations', adminPage('donations', {
      scheduledDonations: items.map((item) => ({ ...item, scheduledForLabel: formatAdminDate(item.scheduledFor), amountLabel: `${item.amount} ${item.currency}`, errorLabel: item.error || '' })),
      hasScheduledDonations: items.length > 0,
      defaultScheduledFor: toAdminDateInput(new Date(Date.now() + 10 * 60 * 1000)),
      success: req.query.success || null,
      error: req.query.error || null,
    }));
  } catch (error) { return next(error); }
});

routes.post('/admin/donations', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  try {
    await ScheduledDonation.create({
      donorName: String(req.body.donorName || '').trim() || 'Anonymous',
      amount: parseAmount(req.body.amount),
      currency: String(req.body.currency || 'RUB').toUpperCase(),
      message: String(req.body.message || '').trim().slice(0, 255),
      scheduledFor: parseScheduledAt(req.body.scheduledFor),
      createdBy: req.adminUser._id,
    });
    return res.redirect('/admin/donations?success=Донат+поставлен+в+расписание');
  } catch (error) { return res.redirect(`/admin/donations?error=${encodeURIComponent(getFormError(error))}`); }
});

routes.post('/admin/donations/:id/send-now', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  const item = await ScheduledDonation.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['pending', 'failed'] } },
    { $set: { status: 'processing', error: null } },
    { new: true }
  );
  if (!item) return res.redirect('/admin/donations?error=Задача+уже+отправляется+или+отменена');
  try {
    await createAndSendDonation(item, 'scheduled');
    item.status = 'sent';
    item.sentAt = new Date();
    await item.save();
    return res.redirect('/admin/donations?success=Донат+отправлен+сейчас');
  } catch (error) {
    item.status = 'failed';
    item.error = error.response?.data?.message || error.message;
    await item.save();
    return res.redirect(`/admin/donations?error=${encodeURIComponent(`Не удалось отправить: ${item.error}`)}`);
  }
});

routes.post('/admin/donations/:id/cancel', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  await ScheduledDonation.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { $set: { status: 'cancelled' } });
  return res.redirect('/admin/donations?success=Задача+отменена');
});

routes.get('/admin/donations/history', requireAdmin, async (req, res, next) => {
  try {
    const filter = String(req.query.test || 'all');
    const query = filter === 'yes' ? { isTest: true } : (filter === 'no' ? { isTest: false } : {});
    const donations = await Donation.find(query).sort({ createdAt: -1 }).limit(300).lean();
    return res.render('pages/admin-donation-history', adminPage('donation-history', {
      donations: donations.map((donation) => ({
        ...donation,
        isTest: donation.isTest ?? donation.source !== 'donationalerts',
        testLabel: (donation.isTest ?? donation.source !== 'donationalerts') ? 'Тестовый' : 'Реальный',
        sourceLabel: donation.source === 'donationalerts' ? 'DonationAlerts' : (donation.source === 'scheduled' ? 'Расписание' : 'Админка'),
        amountLabel: `${donation.amount} ${donation.currency}`,
        createdAtLabel: formatAdminDate(donation.createdAt),
      })),
      hasDonations: donations.length > 0,
      activeFilter: filter,
    }));
  } catch (error) { return next(error); }
});

routes.get('/admin/memes', requireAdmin, async (req, res, next) => {
  try {
    const items = await ScheduledMeme.find().sort({ scheduledFor: 1 }).limit(100).lean();
    let memeOptions = [];
    let memeCatalogError = '';
    if (config.MEMEALERTS_JWT) {
      try {
        const runtimeSettings = await getRuntimeSettings();
        const catalogue = await randomMeme.fetchAllMemes(runtimeSettings.memeAlertsChannelId);
        memeOptions = catalogue.map((meme) => ({ id: meme.id, name: meme.name || meme.title || meme.id, image: meme.image || meme.imageUrl || meme.preview || '' }));
      } catch (error) {
        memeCatalogError = error.message;
      }
    } else {
      memeCatalogError = 'MEMEALERTS_JWT не настроен.';
    }
    return res.render('pages/admin-memes', adminPage('memes', {
      scheduledMemes: items.map((item) => ({ ...item, selectionLabel: item.selection === 'random' ? 'случайный из каталога' : item.stickerId, senderLabel: (item.sender || 'test') === 'test' ? 'тестовый пользователь' : 'владелец канала', scheduledForLabel: formatAdminDate(item.scheduledFor), errorLabel: item.error || '' })),
      hasScheduledMemes: items.length > 0,
      memeOptions,
      hasMemeOptions: memeOptions.length > 0,
      memeCatalogError,
      defaultScheduledFor: toAdminDateInput(new Date(Date.now() + 10 * 60 * 1000)),
      success: req.query.success || null,
      error: req.query.error || null,
    }));
  } catch (error) { return next(error); }
});

routes.post('/admin/memes', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  try {
    const selection = req.body.selection === 'sticker' ? 'sticker' : 'random';
    const sender = req.body.sender === 'owner' ? 'owner' : 'test';
    const stickerId = String(req.body.stickerId || '').trim();
    if (selection === 'sticker' && !stickerId) throw new Error('Выберите мем из каталога.');
    const quantity = Math.min(Math.max(parseInt(req.body.quantity, 10) || 1, 1), 200);
    const intervalMinutes = Math.min(Math.max(parseInt(req.body.intervalMinutes, 10) || 5, 1), 24 * 60);
    const firstTime = parseScheduledAt(req.body.scheduledFor);
    const payload = Array.from({ length: quantity }, (_, index) => ({
      stickerId: selection === 'sticker' ? stickerId : '',
      selection,
      sender,
      message: String(req.body.message || '').trim().slice(0, 255),
      isSoundOnly: req.body.isSoundOnly === 'on',
      scheduledFor: new Date(firstTime.getTime() + index * intervalMinutes * 60 * 1000),
      createdBy: req.adminUser._id,
    }));
    await ScheduledMeme.insertMany(payload);
    return res.redirect(`/admin/memes?success=${encodeURIComponent(`Запланировано мемов: ${quantity}`)}`);
  } catch (error) { return res.redirect(`/admin/memes?error=${encodeURIComponent(getFormError(error))}`); }
});

routes.post('/admin/memes/:id/cancel', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  await ScheduledMeme.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { $set: { status: 'cancelled' } });
  return res.redirect('/admin/memes?success=Задача+отменена');
});

routes.get('/admin/users', requireAdmin, async (req, res, next) => {
  try {
    const users = await AdminUser.find().sort({ createdAt: 1 }).lean();
    return res.render('pages/admin-users', adminPage('users', {
      users: users.map((user) => ({ ...user, createdAtLabel: formatAdminDate(user.createdAt), lastLoginAtLabel: formatAdminDate(user.lastLoginAt), isCurrent: String(user._id) === String(req.adminUser._id) })),
      temporaryPassword: DEFAULT_PASSWORD,
      success: req.query.success || null,
      error: req.query.error || null,
    }));
  } catch (error) { return next(error); }
});

routes.post('/admin/users', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/i.test(username)) throw new Error('Логин: 3–25 символов, буквы, цифры и _.');
    await AdminUser.create({ username, displayName: String(req.body.displayName || '').trim() || username, passwordHash: createPasswordHash(DEFAULT_PASSWORD), mustChangePassword: true });
    return res.redirect('/admin/users?success=Пользователь+создан');
  } catch (error) { return res.redirect(`/admin/users?error=${encodeURIComponent(error.code === 11000 ? 'Такой+пользователь+уже+существует' : getFormError(error))}`); }
});

routes.post('/admin/users/:id/toggle', adminForm, requireAdmin, requireCsrf, async (req, res) => {
  if (String(req.params.id) === String(req.adminUser._id)) return res.redirect('/admin/users?error=Нельзя+отключить+себя');
  const user = await AdminUser.findById(req.params.id);
  if (user) { user.isActive = !user.isActive; await user.save(); }
  return res.redirect('/admin/users?success=Статус+пользователя+обновлён');
});

routes.get('/', async (req, res, next) => {
  try {
    res.render('pages/home', await buildHomePageData(getPublicHost(req)));
  } catch (error) {
    next(error);
  }
});

routes.get('/stats', async (req, res, next) => {
  try {
    const filters = {
      streamId: req.query.stream || null,
      chatter: req.query.chatter || null,
    };
    res.render('pages/stats', await buildStatsPageData(getPublicHost(req), filters));
  } catch (error) {
    next(error);
  }
});

routes.get('/api/streamer/summary', async (req, res, next) => {
  try {
    res.json(await getSummaryApiData(getPublicHost(req)));
  } catch (error) {
    next(error);
  }
});

routes.get('/api/streamer/stats', async (req, res, next) => {
  try {
    const filters = {
      streamId: req.query.stream || null,
    };
    res.json(await getStatsApiData(getPublicHost(req), filters));
  } catch (error) {
    next(error);
  }
});

routes.get('/api/streamer/chatters/:user', async (req, res, next) => {
  try {
    const stats = await loadChatterStats(req.params.user);

    if (!stats) {
      return res.status(404).json({ error: 'Chatter not found' });
    }

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

routes.get('/api/diagnostics/db', (req, res) => {
  const status = typeof db.getDbStatus === 'function'
    ? db.getDbStatus()
    : {
      readyState: db?.connection?.readyState ?? 0,
      state: 'unknown',
    };

  res.json({
    ok: status.readyState === 1,
    mongo: status,
  });
});

routes.get('/speak', (req, res) => {
  const overlayMode = req.query.overlay === 'chat' ? 'chat' : (req.query.overlay === '1' ? 'speech' : null);
  const isOverlay = Boolean(overlayMode);
  res.set('Content-Security-Policy', 'default-src \'self\' \'unsafe-inline\' data:; connect-src *; font-src * data:; img-src * data:; media-src * blob: data:');
  res.set('X-Frame-Options', 'ALLOWALL');
  res.render('pages/speak', {
    pageTitle: 'NGLZZZ — озвучка сообщений',
    pageDescription: 'Страница озвучки сообщений чата и звуковых эффектов.',
    currentPage: 'speak',
    layout: isOverlay ? 'overlay' : 'main',
    isOverlay,
    isChatOverlay: overlayMode === 'chat',
    generatedAtLabel: new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: config.TIMEZONE,
    }).format(new Date()),
    navigation: [
      { label: 'Главная', href: '/', isActive: false },
      { label: 'Статистика', href: '/stats', isActive: false },
      { label: 'Озвучка', href: '/speak', isActive: true },
    ],
    websocketPort: config.DOCKER_WEBSOCKET_PORT || config.WEBSOCKET_PORT
  });
});

routes.post('/api/chat/messages', express.json({ limit: '16kb' }), (req, res) => {
  const token = config.OVERLAY_INGEST_TOKEN;
  const authorization = req.get('authorization') || '';
  const bearerToken = /^Bearer\s+(.+)$/i.exec(authorization);
  const providedToken = bearerToken ? bearerToken[1] : req.get('x-overlay-token');

  if (!token) {
    return res.status(503).json({ error: 'OVERLAY_INGEST_TOKEN is not configured' });
  }

  if (providedToken !== token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!req.body || typeof req.body.message !== 'string' || !req.body.message.trim()) {
    return res.status(422).json({ error: 'message is required' });
  }

  publishChatMessage(req.body);
  return res.status(202).json({ ok: true });
});

routes.get('/api/chat/recent', async (req, res, next) => {
  try {
    if (db?.connection?.readyState !== 1) {
      return res.json([]);
    }
    const chatLogModel = require('../models/chatLog.model');
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const messages = await chatLogModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(messages.reverse());
  } catch (error) {
    next(error);
  }
});

routes.get('/speech', async (req, res, next) => {
  try {
    const text = String(req.query.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const data = await speech.synthesizeSpeech(text, {
      pitch: req.query.pitch,
      rate: req.query.rate,
      voice: req.query.voice,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = routes;
