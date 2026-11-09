'use strict';

// Синглтон заказа видео с реальными зависимостями (чат, WebSocket, площадки, курсы валют).
// Для тестов используйте createVideoService напрямую.

const config = require('../../config');
const { isDbReady } = require('../../app/db');
const repo = require('../../repositories/video.repo');
const providers = require('../../video/providers');
const { createSettingsStore } = require('./videoSettings.service');
const { createVideoService } = require('./video.service');

let service = null;
let settingsStore = null;
let musicPausedByVideo = false;

function getSettingsStore() {
  if (!settingsStore) settingsStore = createSettingsStore({ repo });
  return settingsStore;
}

function emoteUrl(word) {
  try {
    const { getCachedCatalog } = require('../emoteCatalog.service');
    const catalog = getCachedCatalog(config.BROADCASTER_ID) || [];
    const emote = catalog.find((item) => item.name === word);
    return emote ? emote.url : null;
  } catch (_) {
    return null;
  }
}

/** Пока идёт видео, музыка на паузе; когда очередь видео закончилась — музыка продолжает. */
function onActivityChange({ active, idle }) {
  const music = require('../music').getMusicService();
  if (!music) return;
  if (active) {
    if (!getSettingsStore().get().player.pauseMusic) return;
    // waiting — музыка в паузе между треками: её таймер тоже нужно остановить.
    if (['playing', 'waiting'].includes(music.getState().status)) {
      musicPausedByVideo = true;
      music.pause().catch(() => {});
    }
  } else if (idle && musicPausedByVideo) {
    musicPausedByVideo = false;
    music.play().catch(() => {});
  }
}

function getVideoService() {
  if (service) return service;
  if (!isDbReady()) return null;
  const websocket = require('../../app/websocket');
  const Chat = require('../../app/chat');
  const music = require('../music');
  service = createVideoService({
    repo,
    settingsStore: getSettingsStore(),
    providers,
    broadcast: (payload) => websocket.broadcast(payload),
    say: (message) => Chat.handleMessageResult(message, `#${config.CHANNEL}`),
    isFollower: music.isFollower,
    getRubAmount: music.getRubAmount,
    emoteUrl,
    onActivityChange,
    onStarted: (request) => require('../achievements.service').evaluateRequester(request),
  });
  service.init();
  // Каталог смайлов нужен, чтобы показать на странице картинки слов для голосования.
  require('../emoteCatalog.service').loadCatalog(config.BROADCASTER_ID).catch(() => {});
  return service;
}

/** Донат: если приём видео открыт и в тексте ссылка на видео — это заказ видео. Иначе null. */
async function handleDonationForVideo(donation) {
  const video = getVideoService();
  if (!video) return null;
  return video.handleDonation(donation);
}

function chatter(tags) {
  return {
    login: String(tags.username || '').toLowerCase(),
    display: tags['display-name'] || tags.username,
    id: tags['user-id'] || null,
    messageId: tags.id || null,
    tags,
  };
}

/**
 * Каждое сообщение чата (кроме команд): голос «скип / оставить» или ссылка на видео.
 * Возвращает текст ответа в чат или null.
 */
async function handleChatMessage(tags, message) {
  const video = getVideoService();
  if (!video) return null;
  const user = chatter(tags);
  const voted = await video.vote({ login: user.login, tags, message });
  if (voted) return voted.silent ? null : voted.message;

  const s = getSettingsStore().get();
  if (!s.accepting || s.chat.linkMode !== 'any') return null;
  const link = providers.find(message, null);
  if (!link) return null;
  const result = await video.requestVideo({ input: message, requester: user, source: 'chat' });
  return replyFor(user, result, s);
}

function replyFor(user, result, s = getSettingsStore().get()) {
  if (!result || s.chat.replies === 'none') return null;
  if (result.ok && s.chat.replies === 'errors') return null;
  return `@${user.display} ${result.ok ? '' : '⚠️ '}${result.message}`;
}

module.exports = { getVideoService, getSettingsStore, handleDonationForVideo, handleChatMessage, replyFor, chatter };
