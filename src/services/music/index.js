'use strict';

// Синглтон заказа музыки с реальными зависимостями (Twitch-чат, WebSocket,
// YouTube, курсы валют). Для тестов используйте createMusicService напрямую.

const config = require('../../config');
const { isDbReady } = require('../../app/db');
const repo = require('../../repositories/music.repo');
const { createSettingsStore } = require('./musicSettings.service');
const { createMusicService } = require('./music.service');
const youtube = require('../../music/providers/youtube.provider');

let service = null;
let settingsStore = null;
// Публичный адрес сайта, увиденный в последнем внешнем запросе (для ссылок в чате).
let observedPublicBase = '';

function rememberPublicBase(base) {
  if (base && !/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(base)) observedPublicBase = base.replace(/\/+$/, '');
}

function getPublicBase() {
  if (config.SITE_PUBLIC_URL) return config.SITE_PUBLIC_URL.replace(/\/+$/, '');
  const host = config.SITE_PUBLIC_HOST || config.PUBLIC_HOST;
  return host ? `https://${host}` : observedPublicBase;
}

function youtubeUrlFromText(text) {
  const parsed = youtube.findYouTubeInText(text);
  if (!parsed || parsed.type !== 'video') return null;
  return `https://www.youtube.com/watch?v=${parsed.id}${parsed.startSec ? `&t=${parsed.startSec}` : ''}`;
}

async function isFollower(tags) {
  const login = String(tags?.username || '').toLowerCase();
  if (!login) return false;
  const profile = await require('../twitchCommunity.service').refreshProfile(login);
  return Number(profile?.followStatus) === 1;
}

async function getRubAmount(amount, currency) {
  const code = String(currency || 'RUB').toUpperCase();
  if (code === 'RUB') return amount;
  const { getRubRates, toRub } = require('../exchangeRates.service');
  const rates = await getRubRates();
  const value = toRub(amount, code, rates?.rates);
  return value === null ? null : Math.round(value * 100) / 100;
}

function getSettingsStore() {
  if (!settingsStore) settingsStore = createSettingsStore({ repo });
  return settingsStore;
}

function getMusicService() {
  if (service) return service;
  if (!isDbReady()) return null;
  const websocket = require('../../app/websocket');
  const Chat = require('../../app/chat');
  service = createMusicService({
    repo,
    settingsStore: getSettingsStore(),
    provider: youtube,
    broadcast: (payload) => websocket.broadcast(payload),
    say: (message) => Chat.handleMessageResult(message, `#${config.CHANNEL}`),
    isFollower,
    getRubAmount,
    onStarted: (request) => require('../achievements.service').evaluateRequester(request),
  });
  service.init();
  return service;
}

/** Вызывается после сохранения доната (см. donations.service). */
async function handleDonationForMusic(donation) {
  const music = getMusicService();
  if (!music) return null;
  return music.handleDonation(donation, { findUrl: youtubeUrlFromText });
}

module.exports = { getMusicService, getSettingsStore, handleDonationForMusic, youtubeUrlFromText, rememberPublicBase, getPublicBase, isFollower, getRubAmount };
