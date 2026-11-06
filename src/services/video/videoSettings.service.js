'use strict';

const { ROLES } = require('../music/musicSettings.service');

// Роли, для которых задаётся лимит бесплатных заказов (у стримера лимита нет).
const LIMIT_ROLES = ['everyone', 'follower', 'subscriber', 'vip', 'moderator'];
const PROVIDER_KEYS = ['youtube', 'shorts', 'tiktok', 'twitchClips', 'twitchVods', 'vimeo', 'streamable'];
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const LINK_MODES = ['any', 'command'];
const REPLY_MODES = ['all', 'errors', 'none'];
const VOTE_ACTIONS = ['warning', 'skip'];
const PAID_END_ACTIONS = ['warning', 'cut'];

function defaultSettings() {
  return {
    accepting: false,
    chat: {
      linkMode: 'any',
      replies: 'all',
      announceAccepting: true,
      coRequest: true,
      removeOnDelete: true,
      firstTimeChatters: true,
    },
    providers: { youtube: true, shorts: true, tiktok: true, twitchClips: true, twitchVods: true, vimeo: false, streamable: false },
    limits: {
      maxQueue: 50,
      maxQueueDurationMin: 0,
      maxFreeDurationSec: 600,
      maxPaidDurationSec: 1800,
      maxPaidPerUser: 10,
      roleLimits: { everyone: 1, follower: 1, subscriber: 2, vip: 3, moderator: 5 },
    },
    filters: { minViews: 0, minAgeDays: 0, maxAgeDays: 0, uniqueOnly: false },
    queue: { insertRandomly: false },
    paid: {
      prioritize: true,
      minAmountRub: 0,
      pricePerMinuteEnabled: false,
      pricePerMinuteRub: 100,
      protectFromVotes: true,
      endAction: 'warning',
    },
    voting: {
      enabled: true,
      skipWords: ['скип', 'skip'],
      keepWords: ['оставить', 'keep'],
      needed: 10,
      blockSec: 10,
      canChangeVote: false,
      action: 'warning',
      warningSec: 7,
      lockEnabled: false,
      lockVotes: 15,
      vipWeight: 1,
      modWeight: 1,
    },
    control: { skipRole: 'moderator' },
    player: { autoplay: true, delaySec: 0, volume: 80,     loop: false, announce: true, pauseMusic: true, playbackRate: 1 },
  };
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function int(value, fallback, min, max) {
  if (isBlank(value)) return fallback;
  const n = Math.round(Number(String(value).replace(',', '.')));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function num(value, fallback, min, max) {
  if (isBlank(value)) return fallback;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

function bool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || ['1', 'on', 'true', 'yes'].includes(String(value).toLowerCase());
}

function oneOf(value, list, fallback) {
  return list.includes(value) ? value : fallback;
}

/** Ближайшая скорость из шагов, которые умеют YouTube и Vimeo. Пустое или нечисло — fallback. */
function normalizePlaybackRate(value, fallback = 1) {
  if (isBlank(value)) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return PLAYBACK_RATES.reduce((best, rate) => (Math.abs(rate - n) < Math.abs(best - n) ? rate : best));
}

/** Слова для голосования: без пробелов (сравнивается первое слово сообщения), регистр не важен. */
function wordList(value, fallback) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/);
  const words = [...new Set(raw.map((word) => String(word).trim().split(/\s+/)[0]).filter(Boolean).map((word) => word.slice(0, 40)))];
  return words.length ? words.slice(0, 10) : fallback;
}

function normalizeSettings(input) {
  const d = defaultSettings();
  const s = input && typeof input === 'object' ? input : {};
  const chat = s.chat || {};
  const providers = s.providers || {};
  const limits = s.limits || {};
  const roleLimits = limits.roleLimits || {};
  const filters = s.filters || {};
  const queue = s.queue || {};
  const paid = s.paid || {};
  const voting = s.voting || {};
  const control = s.control || {};
  const player = s.player || {};

  const skipWords = wordList(voting.skipWords, d.voting.skipWords);
  const skipSet = new Set(skipWords.map((word) => word.toLowerCase()));
  // Одно слово не может значить и «скип», и «оставить».
  const keepWords = wordList(voting.keepWords, d.voting.keepWords).filter((word) => !skipSet.has(word.toLowerCase()));

  return {
    accepting: bool(s.accepting, d.accepting),
    chat: {
      linkMode: oneOf(chat.linkMode, LINK_MODES, d.chat.linkMode),
      replies: oneOf(chat.replies, REPLY_MODES, d.chat.replies),
      announceAccepting: bool(chat.announceAccepting, d.chat.announceAccepting),
      coRequest: bool(chat.coRequest, d.chat.coRequest),
      removeOnDelete: bool(chat.removeOnDelete, d.chat.removeOnDelete),
      firstTimeChatters: bool(chat.firstTimeChatters, d.chat.firstTimeChatters),
    },
    providers: Object.fromEntries(PROVIDER_KEYS.map((key) => [key, bool(providers[key], d.providers[key])])),
    limits: {
      maxQueue: int(limits.maxQueue, d.limits.maxQueue, 1, 1000),
      maxQueueDurationMin: int(limits.maxQueueDurationMin, d.limits.maxQueueDurationMin, 0, 24 * 60),
      maxFreeDurationSec: int(limits.maxFreeDurationSec, d.limits.maxFreeDurationSec, 10, 24 * 3600),
      maxPaidDurationSec: int(limits.maxPaidDurationSec, d.limits.maxPaidDurationSec, 10, 24 * 3600),
      maxPaidPerUser: int(limits.maxPaidPerUser, d.limits.maxPaidPerUser, 0, 100),
      roleLimits: Object.fromEntries(LIMIT_ROLES.map((role) => [role, int(roleLimits[role], d.limits.roleLimits[role], 0, 100)])),
    },
    filters: {
      minViews: int(filters.minViews, d.filters.minViews, 0, 1e12),
      minAgeDays: num(filters.minAgeDays, d.filters.minAgeDays, 0, 365 * 50),
      maxAgeDays: num(filters.maxAgeDays, d.filters.maxAgeDays, 0, 365 * 50),
      uniqueOnly: bool(filters.uniqueOnly, d.filters.uniqueOnly),
    },
    queue: { insertRandomly: bool(queue.insertRandomly, d.queue.insertRandomly) },
    paid: {
      prioritize: bool(paid.prioritize, d.paid.prioritize),
      minAmountRub: num(paid.minAmountRub, d.paid.minAmountRub, 0, 1e7),
      pricePerMinuteEnabled: bool(paid.pricePerMinuteEnabled, d.paid.pricePerMinuteEnabled),
      pricePerMinuteRub: num(paid.pricePerMinuteRub, d.paid.pricePerMinuteRub, 0.01, 1e7),
      protectFromVotes: bool(paid.protectFromVotes, d.paid.protectFromVotes),
      endAction: oneOf(paid.endAction, PAID_END_ACTIONS, d.paid.endAction),
    },
    voting: {
      enabled: bool(voting.enabled, d.voting.enabled),
      skipWords,
      keepWords: keepWords.length ? keepWords : [],
      needed: int(voting.needed, d.voting.needed, 1, 10000),
      blockSec: int(voting.blockSec, d.voting.blockSec, 0, 600),
      canChangeVote: bool(voting.canChangeVote, d.voting.canChangeVote),
      action: oneOf(voting.action, VOTE_ACTIONS, d.voting.action),
      warningSec: int(voting.warningSec, d.voting.warningSec, 1, 60),
      lockEnabled: bool(voting.lockEnabled, d.voting.lockEnabled),
      lockVotes: int(voting.lockVotes, d.voting.lockVotes, 1, 10000),
      vipWeight: num(voting.vipWeight, d.voting.vipWeight, 0, 100),
      modWeight: num(voting.modWeight, d.voting.modWeight, 0, 100),
    },
    control: { skipRole: oneOf(control.skipRole, ROLES, d.control.skipRole) },
    player: {
      autoplay: bool(player.autoplay, d.player.autoplay),
      delaySec: int(player.delaySec, d.player.delaySec, 0, 600),
      volume: int(player.volume, d.player.volume, 0, 100),
      loop: bool(player.loop, d.player.loop),
      announce: bool(player.announce, d.player.announce),
      pauseMusic: bool(player.pauseMusic, d.player.pauseMusic),
      playbackRate: normalizePlaybackRate(player.playbackRate, d.player.playbackRate),
    },
  };
}

const minutesToSec = (value) => Math.round(Number(String(value).replace(',', '.')) * 60);

/**
 * Разбирает плоскую форму настроек (`limits.maxQueue=...`). Отсутствующий
 * чекбокс = выключен, поэтому форма передаёт `_section` со списком разделов.
 */
function applyForm(current, form) {
  const sections = new Set([].concat(form._section || []).map(String));
  const next = JSON.parse(JSON.stringify(current));
  const checkbox = (key) => form[key] === 'on' || form[key] === '1' || form[key] === 'true';
  const has = (key) => Object.prototype.hasOwnProperty.call(form, key) && !isBlank(form[key]);
  const set = (path, value) => {
    const parts = path.split('.');
    let target = next;
    while (parts.length > 1) target = target[parts.shift()];
    target[parts[0]] = value;
  };
  const copy = (path) => { if (has(path)) set(path, form[path]); };
  const flags = (...paths) => paths.forEach((path) => set(path, checkbox(path)));

  if (sections.has('chat')) {
    copy('chat.linkMode');
    copy('chat.replies');
    flags('chat.announceAccepting', 'chat.coRequest', 'chat.removeOnDelete', 'chat.firstTimeChatters');
  }
  if (sections.has('providers')) {
    PROVIDER_KEYS.forEach((key) => set(`providers.${key}`, checkbox(`providers.${key}`)));
  }
  if (sections.has('limits')) {
    ['maxQueue', 'maxQueueDurationMin', 'maxPaidPerUser'].forEach((key) => copy(`limits.${key}`));
    LIMIT_ROLES.forEach((role) => copy(`limits.roleLimits.${role}`));
    if (has('limits.maxFreeDurationMin')) set('limits.maxFreeDurationSec', minutesToSec(form['limits.maxFreeDurationMin']));
    if (has('limits.maxPaidDurationMin')) set('limits.maxPaidDurationSec', minutesToSec(form['limits.maxPaidDurationMin']));
    flags('queue.insertRandomly');
  }
  if (sections.has('filters')) {
    ['minViews', 'minAgeDays', 'maxAgeDays'].forEach((key) => {
      // Пустое поле = фильтр выключен.
      set(`filters.${key}`, has(`filters.${key}`) ? form[`filters.${key}`] : 0);
    });
    flags('filters.uniqueOnly');
  }
  if (sections.has('paid')) {
    copy('paid.minAmountRub');
    copy('paid.pricePerMinuteRub');
    copy('paid.endAction');
    flags('paid.prioritize', 'paid.pricePerMinuteEnabled', 'paid.protectFromVotes');
  }
  if (sections.has('voting')) {
    ['needed', 'blockSec', 'warningSec', 'lockVotes', 'vipWeight', 'modWeight'].forEach((key) => copy(`voting.${key}`));
    copy('voting.action');
    if (Object.prototype.hasOwnProperty.call(form, 'voting.skipWords')) set('voting.skipWords', wordList(form['voting.skipWords'], current.voting.skipWords));
    if (Object.prototype.hasOwnProperty.call(form, 'voting.keepWords')) set('voting.keepWords', wordList(form['voting.keepWords'], []));
    flags('voting.enabled', 'voting.canChangeVote', 'voting.lockEnabled');
    copy('control.skipRole');
  }
  if (sections.has('player')) {
    copy('player.delaySec');
    flags('player.autoplay', 'player.announce', 'player.pauseMusic');
  }
  return normalizeSettings(next);
}

function createSettingsStore({ repo }) {
  let cached = null;

  function get() {
    if (cached) return cached;
    let stored = null;
    try { stored = repo.getSettingsValue(); } catch (error) { console.warn('[Video] Settings read failed:', error.message); }
    cached = normalizeSettings(stored);
    return cached;
  }

  function save(next) {
    const normalized = normalizeSettings(next);
    repo.saveSettingsValue(normalized); // сначала в БД: при ошибке не меняем рабочие настройки
    cached = normalized;
    return cached;
  }

  function patch(fn) {
    return save(fn(JSON.parse(JSON.stringify(get()))));
  }

  return { get, save, patch, reset: () => { cached = null; } };
}

module.exports = {
  LIMIT_ROLES,
  PLAYBACK_RATES,
  PROVIDER_KEYS,
  LINK_MODES,
  REPLY_MODES,
  VOTE_ACTIONS,
  PAID_END_ACTIONS,
  defaultSettings,
  normalizeSettings,
  normalizePlaybackRate,
  applyForm,
  createSettingsStore,
  wordList,
};
