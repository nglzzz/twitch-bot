'use strict';

const express = require('express');
const config = require('../config');
const { normalizeSubscriberId } = require('../services/boostyCommunity.service');
const { formatMoney } = require('../services/adminDashboard.service');

function createCommunityAdminRouter({ requireAdmin, requireCsrf, navigation,
  repository = require('../repositories/communityContributions.repo'),
  community = require('../repositories/community.repo'),
  boostyCommunity = require('../services/boostyCommunity.service'),
} = {}) {
  if (typeof requireAdmin !== 'function' || typeof requireCsrf !== 'function' || typeof navigation !== 'function') {
    throw new TypeError('Admin authentication, CSRF, and navigation are required');
  }
  const router = express.Router();
  const form = express.urlencoded({ extended: false, limit: '16kb' });
  const formatDate = (value) => value ? new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: config.TIMEZONE,
  }).format(new Date(value)) : '—';

  // «300.0 RUB» → «300 ₽»
  const formatDonationTitle = (title) => {
    const match = /^(-?[\d.]+)\s+(\S+)$/.exec(String(title || ''));
    return match ? formatMoney(Number(match[1]), match[2]) : title;
  };

  const TABS = ['donations', 'memes', 'boosty'];
  const TAB_LABELS = { donations: 'Донаты', memes: 'Мемы', boosty: 'Boosty' };
  const tabFor = (kind) => (kind === 'meme' ? 'memes' : 'donations');

  router.get('/admin/community-events', requireAdmin, async (req, res, next) => {
    try {
      const decorate = (event) => ({ ...event, id: event.recordId,
        title: event.kind === 'donation' ? formatDonationTitle(event.title) : event.title,
        createdAtLabel: formatDate(event.eventAt),
        statusLabel: event.kind === 'donation' ? 'Поступление подтверждено источником' : 'Мем отправлен',
      });
      const memeEvents = repository.listUnassigned({ kind: 'meme', limit: 50 }).map(decorate);
      const donationEvents = repository.listUnassigned({ kind: 'donation', limit: 50 }).map(decorate);
      let boostySubscribers = [];
      let boostyError = null;
      try {
        const listBoostySubscribers = boostyCommunity.getAvailableActiveSubscribers || boostyCommunity.getActiveSubscribers;
        boostySubscribers = await listBoostySubscribers();
      }
      catch (error) { boostyError = error.message || 'Не удалось загрузить подписки Boosty.'; }
      const counts = { donations: donationEvents.length, memes: memeEvents.length, boosty: boostySubscribers.length };
      const requestedTab = typeof req.query.tab === 'string' && TABS.includes(req.query.tab) ? req.query.tab : null;
      // Без явного выбора открываем первую вкладку, где есть что привязывать.
      const activeTab = requestedTab || TABS.find((tab) => counts[tab] > 0) || TABS[0];
      const tabs = TABS.map((tab) => ({ id: tab, label: TAB_LABELS[tab], count: counts[tab], isActive: tab === activeTab }));
      return res.render('pages/admin-community-events', {
        tabs, activeTab,
        isDonationsTab: activeTab === 'donations', isMemesTab: activeTab === 'memes', isBoostyTab: activeTab === 'boosty',
        layout: 'admin', currentPage: 'community-events', navigation: navigation('community-events'),
        pageTitle: 'Привязка событий к участникам', memeEvents, donationEvents,
        hasMemeEvents: memeEvents.length > 0, hasDonationEvents: donationEvents.length > 0,
        boostySubscribers, hasBoostySubscribers: boostySubscribers.length > 0, boostyError,
        success: typeof req.query.success === 'string' ? req.query.success : null,
        error: typeof req.query.error === 'string' ? req.query.error : null,
        boostySuccess: typeof req.query.boostySuccess === 'string' ? req.query.boostySuccess : null,
        boostyError: typeof req.query.boostyError === 'string' ? req.query.boostyError : boostyError,
      });
    } catch (error) { return next(error); }
  });

  router.post('/admin/community-events/link-boosty', form, requireAdmin, requireCsrf, async (req, res) => {
    try {
      const subscriberId = normalizeSubscriberId(req.body.subscriberId);
      if (!subscriberId) throw new Error('Выберите корректный ID подписчика Boosty.');
      const login = typeof req.body.twitchLogin === 'string' ? community.normalizeLogin(req.body.twitchLogin) : null;
      const user = login ? community.findProfileIdentity(login) : null;
      if (!user?.userId) throw new Error('Укажите существующего участника с подтверждённым Twitch ID.');
      await boostyCommunity.linkActiveSubscriber({
        userId: user.userId,
        username: user.username || login,
        displayName: user.displayName || user.username || login,
        subscriberId,
        adminId: req.adminUser._id,
      });
      return res.redirect(`/admin/community-events?tab=boosty&boostySuccess=${encodeURIComponent('Активная подписка Boosty привязана к Twitch-профилю.')}`);
    } catch (error) {
      return res.redirect(`/admin/community-events?tab=boosty&boostyError=${encodeURIComponent(error.message || 'Не удалось привязать подписку Boosty.')}`);
    }
  });

  router.post('/admin/community-events/link', form, requireAdmin, requireCsrf, (req, res) => {
    try {
      if (!['meme', 'donation'].includes(req.body.kind)) throw new Error('Выберите мем или донат.');
      if (typeof req.body.recordId !== 'string' || !req.body.recordId || req.body.recordId.length > 128) {
        throw new Error('Некорректный идентификатор события.');
      }
      const login = typeof req.body.twitchLogin === 'string' ? community.normalizeLogin(req.body.twitchLogin) : null;
      const user = login ? community.findProfileIdentity(login) : null;
      if (!user?.userId) throw new Error('Укажите существующего участника с подтверждённым Twitch ID.');
      repository.assignSupportRecord({ kind: req.body.kind, recordId: req.body.recordId,
        userId: user.userId, adminId: req.adminUser._id, historical: req.body.announce !== 'on' });
      return res.redirect(`/admin/community-events?tab=${tabFor(req.body.kind)}&success=${encodeURIComponent(req.body.announce === 'on'
        ? 'Событие привязано. Новые достижения добавлены в очередь объявлений.'
        : 'Событие привязано. Достижения восстановлены без объявления в чат.')}`);
    } catch (error) {
      const tab = ['meme', 'donation'].includes(req.body?.kind) ? `tab=${tabFor(req.body.kind)}&` : '';
      return res.redirect(`/admin/community-events?${tab}error=${encodeURIComponent(error.message || 'Не удалось привязать событие.')}`);
    }
  });
  return router;
}

module.exports = { createCommunityAdminRouter };
