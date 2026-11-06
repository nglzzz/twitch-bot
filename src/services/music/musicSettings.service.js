'use strict';

const crypto = require('crypto');

// Роли по возрастанию прав. Для порога «от роли» сравниваются индексы.
const ROLES = ['everyone', 'follower', 'subscriber', 'vip', 'moderator', 'lead_moderator', 'broadcaster'];
const ROLE_LABELS = {
  everyone: 'Все',
  follower: 'Фолловеры',
  subscriber: 'Подписчики',
  vip: 'VIP',
  moderator: 'Модераторы',
  lead_moderator: 'Супермодераторы',
  broadcaster: 'Стример',
};
const PLAY_TYPES = ['all', 'free', 'paid'];
const OVERLAY_MODES = ['player', 'video'];

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function defaultSettings() {
  return {
    enabled: true,
    playTypes: 'all',
    limits: {
      maxQueue: 50,
      maxFreePerUser: 2,
      maxPaidPerUser: 10,
      maxFreeDurationSec: 600,
      maxPaidDurationSec: 1200,
    },
    backup: { playlistUrl: '', shuffle: true, interrupt: true },
    paid: { prioritize: true, minAmountRub: 0, pricePerSecondEnabled: false, pricePerSecondRub: 1 },
    community: {
      requestRoles: ['everyone'],
      skipRole: 'moderator',
      voteSkipEnabled: true,
      voteSkipThreshold: 3,
      vipVoteWeight: 1,
      modVoteWeight: 1,
    },
    player: { autoplay: true, delaySec: 0, volume: 50, announce: true },
    filters: { minLikePercent: 0, minViews: 0, blockedTags: [] },
    obs: { overlayToken: generateToken(), dockToken: generateToken(), overlayMode: 'player' },
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

function tagList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return [...new Set(raw.map((tag) => String(tag).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 200);
}

/** Приводит произвольный объект настроек к полной валидной форме. */
function normalizeSettings(input) {
  const d = defaultSettings();
  const s = input && typeof input === 'object' ? input : {};
  const limits = s.limits || {};
  const backup = s.backup || {};
  const paid = s.paid || {};
  const community = s.community || {};
  const player = s.player || {};
  const filters = s.filters || {};
  const obs = s.obs || {};
  const requestRoles = (Array.isArray(community.requestRoles) ? community.requestRoles : d.community.requestRoles)
    .filter((role) => ROLES.includes(role));
  return {
    enabled: bool(s.enabled, d.enabled),
    playTypes: oneOf(s.playTypes, PLAY_TYPES, d.playTypes),
    limits: {
      maxQueue: int(limits.maxQueue, d.limits.maxQueue, 1, 1000),
      maxFreePerUser: int(limits.maxFreePerUser, d.limits.maxFreePerUser, 0, 100),
      maxPaidPerUser: int(limits.maxPaidPerUser, d.limits.maxPaidPerUser, 0, 100),
      maxFreeDurationSec: int(limits.maxFreeDurationSec, d.limits.maxFreeDurationSec, 10, 24 * 3600),
      maxPaidDurationSec: int(limits.maxPaidDurationSec, d.limits.maxPaidDurationSec, 10, 24 * 3600),
    },
    backup: {
      playlistUrl: String(backup.playlistUrl ?? '').trim().slice(0, 500),
      shuffle: bool(backup.shuffle, d.backup.shuffle),
      interrupt: bool(backup.interrupt, d.backup.interrupt),
    },
    paid: {
      prioritize: bool(paid.prioritize, d.paid.prioritize),
      minAmountRub: num(paid.minAmountRub, d.paid.minAmountRub, 0, 1e7),
      pricePerSecondEnabled: bool(paid.pricePerSecondEnabled, d.paid.pricePerSecondEnabled),
      pricePerSecondRub: num(paid.pricePerSecondRub, d.paid.pricePerSecondRub, 0.01, 1e6),
    },
    community: {
      requestRoles: requestRoles.length ? [...new Set(requestRoles)] : ['broadcaster'],
      skipRole: oneOf(community.skipRole, ROLES, d.community.skipRole),
      voteSkipEnabled: bool(community.voteSkipEnabled, d.community.voteSkipEnabled),
      voteSkipThreshold: int(community.voteSkipThreshold, d.community.voteSkipThreshold, 1, 1000),
      vipVoteWeight: num(community.vipVoteWeight, d.community.vipVoteWeight, 0, 100),
      modVoteWeight: num(community.modVoteWeight, d.community.modVoteWeight, 0, 100),
    },
    player: {
      autoplay: bool(player.autoplay, d.player.autoplay),
      delaySec: int(player.delaySec, d.player.delaySec, 0, 600),
      volume: int(player.volume, d.player.volume, 0, 100),
      announce: bool(player.announce, d.player.announce),
    },
    filters: {
      minLikePercent: num(filters.minLikePercent, d.filters.minLikePercent, 0, 100),
      minViews: int(filters.minViews, d.filters.minViews, 0, 1e12),
      blockedTags: tagList(filters.blockedTags ?? d.filters.blockedTags),
    },
    obs: {
      overlayToken: typeof obs.overlayToken === 'string' && obs.overlayToken.length >= 16 ? obs.overlayToken : d.obs.overlayToken,
      dockToken: typeof obs.dockToken === 'string' && obs.dockToken.length >= 16 ? obs.dockToken : d.obs.dockToken,
      overlayMode: oneOf(obs.overlayMode, OVERLAY_MODES, d.obs.overlayMode),
    },
  };
}

/**
 * Разбирает плоскую форму админки (`limits.maxQueue=...`). Чекбоксы:
 * отсутствующее поле = выключено, поэтому форма передаёт `_section`,
 * чтобы не сбросить флаги других разделов.
 */
function applyForm(current, form) {
  const sections = new Set([].concat(form._section || []).map(String));
  const next = JSON.parse(JSON.stringify(current));
  const checkbox = (key) => form[key] === 'on' || form[key] === '1' || form[key] === 'true';
  const has = (key) => Object.prototype.hasOwnProperty.call(form, key);
  const set = (path, value) => {
    const parts = path.split('.');
    let target = next;
    while (parts.length > 1) target = target[parts.shift()];
    target[parts[0]] = value;
  };

  if (sections.has('general')) {
    set('enabled', checkbox('enabled'));
    if (has('playTypes')) set('playTypes', form.playTypes);
  }
  if (sections.has('limits')) {
    for (const key of ['maxQueue', 'maxFreePerUser', 'maxPaidPerUser']) if (has(`limits.${key}`)) set(`limits.${key}`, form[`limits.${key}`]);
    // Длительность в форме — в минутах, допускаются дроби.
    for (const key of ['maxFreeDuration', 'maxPaidDuration']) {
      if (has(`limits.${key}Min`) && !isBlank(form[`limits.${key}Min`])) set(`limits.${key}Sec`, Math.round(Number(String(form[`limits.${key}Min`]).replace(',', '.')) * 60));
    }
  }
  if (sections.has('backup')) {
    if (has('backup.playlistUrl')) set('backup.playlistUrl', form['backup.playlistUrl']);
    set('backup.shuffle', checkbox('backup.shuffle'));
    set('backup.interrupt', checkbox('backup.interrupt'));
  }
  if (sections.has('paid')) {
    set('paid.prioritize', checkbox('paid.prioritize'));
    set('paid.pricePerSecondEnabled', checkbox('paid.pricePerSecondEnabled'));
    if (has('paid.pricePerSecondRub')) set('paid.pricePerSecondRub', form['paid.pricePerSecondRub']);
    if (has('paid.minAmountRub')) set('paid.minAmountRub', form['paid.minAmountRub']);
  }
  if (sections.has('community')) {
    set('community.requestRoles', [].concat(form['community.requestRoles'] || []));
    if (has('community.skipRole')) set('community.skipRole', form['community.skipRole']);
    set('community.voteSkipEnabled', checkbox('community.voteSkipEnabled'));
    for (const key of ['voteSkipThreshold', 'vipVoteWeight', 'modVoteWeight']) if (has(`community.${key}`)) set(`community.${key}`, form[`community.${key}`]);
  }
  if (sections.has('player')) {
    set('player.autoplay', checkbox('player.autoplay'));
    set('player.announce', checkbox('player.announce'));
    if (has('player.delaySec')) set('player.delaySec', form['player.delaySec']);
  }
  if (sections.has('filters')) {
    if (has('filters.minLikePercent')) set('filters.minLikePercent', form['filters.minLikePercent']);
    if (has('filters.minViews')) set('filters.minViews', form['filters.minViews']);
    if (has('filters.blockedTags')) set('filters.blockedTags', tagList(form['filters.blockedTags']));
  }
  if (sections.has('obs')) {
    if (has('obs.overlayMode')) set('obs.overlayMode', form['obs.overlayMode']);
  }
  return normalizeSettings(next);
}

function createSettingsStore({ repo }) {
  let cached = null;

  function get() {
    if (cached) return cached;
    let stored = null;
    try { stored = repo.getSettingsValue(); } catch (error) { console.warn('[Music] Settings read failed:', error.message); }
    cached = normalizeSettings(stored);
    // Сохраняем сгенерированные токены, иначе они менялись бы при каждом запуске.
    if (!stored || stored?.obs?.overlayToken !== cached.obs.overlayToken || stored?.obs?.dockToken !== cached.obs.dockToken) {
      try { repo.saveSettingsValue(cached); } catch (_) { /* БД недоступна — работаем в памяти */ }
    }
    return cached;
  }

  function save(next) {
    const normalized = normalizeSettings(next);
    repo.saveSettingsValue(normalized); // сначала в БД: при ошибке не меняем рабочие настройки
    cached = normalized;
    return cached;
  }

  function regenerateToken(kind) {
    const current = get();
    const key = kind === 'dock' ? 'dockToken' : 'overlayToken';
    return save({ ...current, obs: { ...current.obs, [key]: generateToken() } });
  }

  return { get, save, regenerateToken, reset: () => { cached = null; } };
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  PLAY_TYPES,
  OVERLAY_MODES,
  defaultSettings,
  normalizeSettings,
  applyForm,
  createSettingsStore,
  generateToken,
};
