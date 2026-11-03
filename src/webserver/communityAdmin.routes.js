'use strict';

const express = require('express');
const config = require('../config');

function createCommunityAdminRouter({ requireAdmin, requireCsrf, navigation,
  repository = require('../repositories/communityContributions.repo'),
  community = require('../repositories/community.repo'),
} = {}) {
  if (typeof requireAdmin !== 'function' || typeof requireCsrf !== 'function' || typeof navigation !== 'function') {
    throw new TypeError('Admin authentication, CSRF, and navigation are required');
  }
  const router = express.Router();
  const form = express.urlencoded({ extended: false, limit: '16kb' });
  const formatDate = (value) => value ? new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: config.TIMEZONE,
  }).format(new Date(value)) : '—';

  router.get('/admin/community-events', requireAdmin, (req, res, next) => {
    try {
      const decorate = (event) => ({ ...event, id: event.recordId,
        createdAtLabel: formatDate(event.eventAt),
        statusLabel: event.kind === 'donation' ? 'Поступление подтверждено источником' : 'Мем отправлен',
      });
      const memeEvents = repository.listUnassigned({ kind: 'meme', limit: 50 }).map(decorate);
      const donationEvents = repository.listUnassigned({ kind: 'donation', limit: 50 }).map(decorate);
      return res.render('pages/admin-community-events', {
        layout: 'admin', currentPage: 'community-events', navigation: navigation('community-events'),
        pageTitle: 'Привязка событий к участникам', memeEvents, donationEvents,
        hasMemeEvents: memeEvents.length > 0, hasDonationEvents: donationEvents.length > 0,
        success: typeof req.query.success === 'string' ? req.query.success : null,
        error: typeof req.query.error === 'string' ? req.query.error : null,
      });
    } catch (error) { return next(error); }
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
      return res.redirect(`/admin/community-events?success=${encodeURIComponent(req.body.announce === 'on'
        ? 'Событие привязано. Новые достижения добавлены в очередь объявлений.'
        : 'Событие привязано. Достижения восстановлены без объявления в чат.')}`);
    } catch (error) {
      return res.redirect(`/admin/community-events?error=${encodeURIComponent(error.message || 'Не удалось привязать событие.')}`);
    }
  });
  return router;
}

module.exports = { createCommunityAdminRouter };
