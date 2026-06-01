const express = require('express');
const routes = express.Router();
const config = require('../config');
const speech = require('../utils/speech');
const {
  buildHomePageData,
  buildStatsPageData,
  getSummaryApiData,
  getStatsApiData,
} = require('../services/streamerSite.service');

function getPublicHost(req) {
  return req.get('x-forwarded-host') || req.get('host') || req.hostname;
}

routes.get('/', async (req, res, next) => {
  try {
    res.render('pages/home', await buildHomePageData(getPublicHost(req)));
  } catch (error) {
    next(error);
  }
});

routes.get('/stats', async (req, res, next) => {
  try {
    res.render('pages/stats', await buildStatsPageData(getPublicHost(req)));
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
    res.json(await getStatsApiData(getPublicHost(req)));
  } catch (error) {
    next(error);
  }
});

routes.get('/speak', (req, res) => {
  res.set('Content-Security-Policy', 'default-src \'self\' \'unsafe-inline\' data:; connect-src *; font-src * data:; media-src * blob: data:');
  res.set('X-Frame-Options', 'ALLOWALL');
  res.render('pages/speak', {
    pageTitle: 'NGLZZZ — озвучка сообщений',
    pageDescription: 'Страница озвучки подсвеченных сообщений и звуковых эффектов.',
    currentPage: 'speak',
    generatedAtLabel: new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date()),
    navigation: [
      { label: 'Главная', href: '/', isActive: false },
      { label: 'Статистика', href: '/stats', isActive: false },
      { label: 'Озвучка', href: '/speak', isActive: true },
    ],
    websocketPort: config.DOCKER_WEBSOCKET_PORT || config.WEBSOCKET_PORT
  });
});

routes.get('/speech', (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  speech.useGoogleSpeech((data) => {
    res.end(JSON.stringify(data));
  }, req.query.text, req.query.pitch);
});

module.exports = routes;
