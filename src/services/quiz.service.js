'use strict';

const config = require('../config');
const { isDbReady } = require('../app/db');
const { getChannelInfo } = require('../twitchApi/channelInfo');
const repository = require('../repositories/quiz.repo');
const { createQuizEngine } = require('./quizEngine');
const { createQuizQuestionProvider } = require('./quizQuestions.service');

const STATUS_CACHE_MS = 30_000;
let cachedStream = null;
let statusExpiresAt = 0;
let statusRequest = null;
let statusError = null;
let engine = null;
let timer = null;
let ticking = false;

async function getStream({ force = false } = {}) {
  if (force) statusExpiresAt = 0;
  if (Date.now() < statusExpiresAt) {
    if (statusError) throw statusError;
    return cachedStream;
  }
  if (!statusRequest) {
    statusRequest = getChannelInfo(config.CHANNEL).then((streams) => {
      cachedStream = streams && streams[0] ? streams[0] : null;
      statusError = null;
      statusExpiresAt = Date.now() + STATUS_CACHE_MS;
      return cachedStream;
    }).catch((error) => {
      statusError = error;
      statusExpiresAt = Date.now() + STATUS_CACHE_MS;
      throw error;
    }).finally(() => { statusRequest = null; });
  }
  return statusRequest;
}

function initialize(chat) {
  if (engine) return;
  const send = (message) => {
    chat.getClient().say(config.CHANNEL, message)
      .catch((error) => console.error('[Quiz] Chat send failed:', error.message));
  };
  engine = createQuizEngine({ getStream, repository, send, questionProvider: createQuizQuestionProvider() });
  const handleGameCommand = (mode) => async (channel, tags, message) => {
    if (!isDbReady()) return 'Игры временно недоступны: нет соединения с базой очков.';
    try {
      const subcommand = message.trim().split(/\s+/)[1] || '';
      if (!['очки', 'score', 'топ', 'top', 'стоп', 'stop'].includes(subcommand.toLocaleLowerCase('ru-RU'))) {
        statusExpiresAt = 0;
      }
      await engine.command(tags, message, mode);
    } catch (error) {
      console.error('[Quiz] Command failed:', error.message);
      return 'Игры временно недоступны. Попробуйте чуть позже.';
    }
    return '';
  };

  chat.registerCommand('!викторина', handleGameCommand(null), '!в');
  chat.registerCommand('!анаграммы', handleGameCommand('anagram'), '!анаграмма');
  chat.registerCommand('!играэмодзи', handleGameCommand('game'), '!эмодзиигра');
  chat.registerCommand('!фильмэмодзи', handleGameCommand('movie'), '!эмодзифильм');
  chat.getClient().on('message', (channel, tags, message, self) => {
    if (self || !isDbReady()) return;
    try {
      engine.guess(tags, message);
    } catch (error) {
      console.error('[Quiz] Answer failed:', error.message);
    }
  });
}

function startQuizTimer() {
  if (timer) return;
  const tick = async () => {
    if (!engine || !isDbReady() || ticking) return;
    ticking = true;
    try {
      await engine.tick();
    } catch (error) {
      console.error('[Quiz] Tick failed:', error.message);
    } finally {
      ticking = false;
    }
  };
  tick();
  timer = setInterval(tick, 1000);
}

module.exports = { initialize, startQuizTimer };
