'use strict';

// Настройки единых алертов донатов: включён ли режим, какие сервисы слушать, ключи виджетов, токен дока.
const crypto = require('crypto');

const SERVICES = ['donationalerts', 'streamelements', 'donatepay', 'donatex'];
const SERVICE_LABELS = {
  donationalerts: 'DonationAlerts',
  streamelements: 'StreamElements',
  donatepay: 'DonatePay',
  donatex: 'Donatex',
};
// Ключи виджетов храним зашифрованными, как остальные токены админки.
const SECRET_FIELDS = ['donatePayToken', 'donatexWidgetId', 'streamElementsOverlayUrl'];

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function defaultSettings() {
  return {
    enabled: false,
    dockToken: generateToken(),
    // Озвучка DA приходит всегда; порог берём как в виджете DA (настраивается здесь).
    daTtsMinRub: 25,
    services: Object.fromEntries(SERVICES.map((id) => [id, { enabled: true }])),
    secrets: {},
  };
}

function normalizeSettings(stored) {
  const d = defaultSettings();
  const s = stored && typeof stored === 'object' ? stored : {};
  const services = {};
  for (const id of SERVICES) services[id] = { enabled: s.services?.[id]?.enabled !== false };
  const secrets = {};
  for (const key of SECRET_FIELDS) if (typeof s.secrets?.[key] === 'string' && s.secrets[key]) secrets[key] = s.secrets[key];
  const min = Number(s.daTtsMinRub);
  return {
    enabled: s.enabled === true,
    dockToken: typeof s.dockToken === 'string' && s.dockToken.length >= 16 ? s.dockToken : d.dockToken,
    daTtsMinRub: Number.isFinite(min) && min >= 0 ? min : d.daTtsMinRub,
    services,
    secrets,
  };
}

function createAlertSettingsStore({ repo, encrypt, decrypt }) {
  let cached = null;

  function get() {
    if (cached) return cached;
    let stored = null;
    try { stored = repo.getSettingsValue(); } catch (error) { console.warn('[Alerts] Settings read failed:', error.message); }
    cached = normalizeSettings(stored);
    if (!stored || stored.dockToken !== cached.dockToken) {
      try { repo.saveSettingsValue(cached); } catch (_) { /* БД недоступна — работаем в памяти */ }
    }
    return cached;
  }

  function save(next) {
    const normalized = normalizeSettings(next);
    repo.saveSettingsValue(normalized);
    cached = normalized;
    return cached;
  }

  function secret(key) {
    const value = get().secrets[key];
    if (!value) return '';
    try { return decrypt(value); } catch (error) { console.warn(`[Alerts] Could not decrypt ${key}:`, error.message); return ''; }
  }

  function setSecret(key, value) {
    if (!SECRET_FIELDS.includes(key)) throw new Error(`Unknown secret ${key}`);
    const current = get();
    const secrets = { ...current.secrets };
    if (value) secrets[key] = encrypt(String(value).trim());
    else delete secrets[key];
    return save({ ...current, secrets });
  }

  function setServiceEnabled(id, enabled) {
    const current = get();
    if (!SERVICES.includes(id)) throw new Error(`Unknown service ${id}`);
    return save({ ...current, services: { ...current.services, [id]: { enabled: Boolean(enabled) } } });
  }

  return {
    get,
    save,
    secret,
    setSecret,
    setServiceEnabled,
    regenerateDockToken: () => save({ ...get(), dockToken: generateToken() }),
    reset: () => { cached = null; },
  };
}

module.exports = { SERVICES, SERVICE_LABELS, SECRET_FIELDS, defaultSettings, normalizeSettings, createAlertSettingsStore, generateToken };
