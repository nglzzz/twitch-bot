'use strict';

const express = require('express');
const { parseHistoryCursor } = require('../helpers/communityCursor');

function normalizeLogin(value) {
  if (typeof value !== 'string') return null;
  const login = value.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(login) ? login : null;
}

function createCommunityRouter({
  service = require('../services/community.service'),
  isReady = require('../app/db').isDbReady,
  navigation = require('../services/streamerSite.service').buildNavigation,
  enrichment = null,
} = {}) {
  const router = express.Router();
  const page = (title, data) => ({
    pageTitle: `${title} — NGLZZZ`,
    pageDescription: 'Участники сообщества NGLZZZ: рейтинги игр и чата, статистика и достижения.',
    currentPage: 'community',
    navigation: navigation('community'),
    ...data,
  });
  const filters = (query) => {
    const board = query.board === undefined ? 'games' : query.board;
    const mode = query.mode === undefined ? 'all' : query.mode;
    if (!['games', 'chat'].includes(board) || !['all', 'quiz', 'anagram', 'game', 'movie'].includes(mode)) return null;
    return { board, mode: board === 'chat' ? 'all' : mode };
  };

  router.get('/community', async (req, res, next) => {
    try {
      if (!isReady()) return res.status(503).render('pages/community', page('Сообщество', { community: { available: false, errorMessage: 'База статистики временно недоступна. Попробуйте позже.' } }));
      if (req.query.user !== undefined && req.query.user !== '') {
        const login = normalizeLogin(req.query.user);
        if (!login) return res.status(400).render('pages/community', page('Поиск участника', {
          community: { ...service.getCommunity(), error: 'Укажите Twitch-логин: латинские буквы, цифры и знак подчёркивания (до 25 символов).' },
        }));
        return res.redirect(`/users/${encodeURIComponent(login)}`);
      }
      const selected = filters(req.query);
      if (!selected) return res.status(400).render('pages/community', page('Сообщество', {
        community: { ...service.getCommunity(), error: 'Неизвестный рейтинг или режим игры.' },
      }));
      let community = service.getCommunity(selected);
      if (enrichment) {
        await enrichment.refreshAvatars([...community.players.map((player) => player.login), ...(community.recentAchievements || []).map((award) => award.login)]);
        community = service.getCommunity(selected);
      }
      return res.render('pages/community', page('Сообщество', { community }));
    } catch (error) { return next(error); }
  });

  router.get('/users/:login', async (req, res, next) => {
    try {
      if (!isReady()) return res.status(503).render('pages/user-profile', page('Профиль временно недоступен', { userProfile: { available: false, errorMessage: 'База статистики временно недоступна. Попробуйте позже.' } }));
      const login = normalizeLogin(req.params.login);
      let before;
      try { before = parseHistoryCursor(req.query.before); }
      catch (_) { return res.status(400).render('pages/community', page('История сообщений', {
        community: { ...service.getCommunity(), error: 'Некорректная ссылка на страницу истории сообщений. Откройте профиль заново.' },
      })); }
      const refreshed = login && enrichment ? await enrichment.refreshProfile(login) : null;
      const profile = login ? service.getProfile(refreshed?.username || login, { before }) : null;
      if (!profile) return res.status(404).render('pages/user-profile', page('Участник не найден', { userProfile: { available: true, found: false } }));
      return res.render('pages/user-profile', page(profile.displayName, { userProfile: { ...profile, available: true, found: true } }));
    } catch (error) { return next(error); }
  });

  router.get('/api/community/leaderboard', async (req, res, next) => {
    try {
      if (!isReady()) return res.status(503).json({ error: 'Community data is temporarily unavailable' });
      const selected = filters(req.query);
      if (!selected) return res.status(400).json({ error: 'Invalid leaderboard or game mode' });
      let community = service.getCommunity(selected);
      if (enrichment) {
        await enrichment.refreshAvatars(community.players.map((player) => player.login));
        community = service.getCommunity(selected);
      }
      return res.json(community);
    } catch (error) { return next(error); }
  });

  router.get('/api/community/achievements', (req, res, next) => {
    try {
      if (!isReady()) return res.status(503).json({ error: 'Community data is temporarily unavailable' });
      return res.json({ achievements: service.getRecentAchievements({ limit: 20 }) });
    } catch (error) { return next(error); }
  });

  router.get('/api/community/users/:login/messages', async (req, res, next) => {
    try {
      if (!isReady()) return res.status(503).json({ error: 'Community data is temporarily unavailable' });
      let before;
      try { before = parseHistoryCursor(req.query.before); }
      catch (_) { return res.status(400).json({ error: 'Invalid message history cursor' }); }
      const login = normalizeLogin(req.params.login);
      const profile = login ? service.getProfile(login, { before }) : null;
      if (!profile) return res.status(404).json({ error: 'User not found' });
      return res.json(profile.history);
    } catch (error) { return next(error); }
  });

  router.get('/api/community/users/:login', async (req, res, next) => {
    try {
      if (!isReady()) return res.status(503).json({ error: 'Community data is temporarily unavailable' });
      const login = normalizeLogin(req.params.login);
      const refreshed = login && enrichment ? await enrichment.refreshProfile(login) : null;
      const profile = login ? service.getProfile(refreshed?.username || login) : null;
      if (!profile) return res.status(404).json({ error: 'User not found' });
      return res.json(profile);
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { createCommunityRouter, normalizeLogin };
