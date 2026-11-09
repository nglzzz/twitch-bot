/**
 * Кто сейчас в чате: список Twitch chatters (раз в минуту, пока кто-то слушает websocket)
 * плюс все, кто написал сообщение. Нужен для сцены OBS, где зрители ходят персонажами.
 */
const POLL_MS = 60 * 1000;
const CHATTER_TTL_MS = 15 * 60 * 1000;
const MAX_VIEWERS = 200;

function normalizeLogin(value) {
  return String(value || '').trim().replace(/^[#@]/, '').toLowerCase();
}

function createPresenceService({
  fetchViewers,
  broadcast,
  hasListeners = () => true,
  ignoredLogins = [],
  now = () => Date.now(),
} = {}) {
  const ignored = new Set(ignoredLogins.map(normalizeLogin));
  // login -> { login, name, color, inList, lastChatAt }
  const viewers = new Map();
  let timer = null;

  function list() {
    return [...viewers.values()]
      .filter((viewer) => viewer.inList || now() - viewer.lastChatAt < CHATTER_TTL_MS)
      .slice(0, MAX_VIEWERS)
      .map(({ login, name, color }) => ({ login, name, color: color || null }));
  }

  function snapshotMessage() {
    return { type: 'presence', viewers: list() };
  }

  function publish() {
    broadcast(snapshotMessage());
  }

  let lastPollAt = 0;
  async function poll() {
    if (!hasListeners()) return;
    lastPollAt = now();
    let names;
    try {
      names = await fetchViewers();
    } catch (error) {
      return;
    }
    if (!Array.isArray(names)) return;

    const present = new Set();
    for (const raw of names) {
      const login = normalizeLogin(raw);
      if (!login || ignored.has(login)) continue;
      present.add(login);
      const entry = viewers.get(login) || { login, name: String(raw), color: null, lastChatAt: 0 };
      entry.inList = true;
      viewers.set(login, entry);
    }
    for (const [login, entry] of viewers) {
      if (!present.has(login)) entry.inList = false;
      if (!entry.inList && now() - entry.lastChatAt >= CHATTER_TTL_MS) viewers.delete(login);
    }
    publish();
  }

  /** Написавший в чат точно здесь; публикуем список, только если он новый. */
  function noteChatter({ login, name, color }) {
    const key = normalizeLogin(login);
    if (!key || ignored.has(key)) return false;
    const existing = viewers.get(key);
    const isNew = !existing || (!existing.inList && now() - existing.lastChatAt >= CHATTER_TTL_MS);
    const entry = existing || { login: key, name: String(name || key), color: null, inList: false, lastChatAt: 0 };
    entry.lastChatAt = now();
    if (name) entry.name = String(name).slice(0, 60);
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) entry.color = color;
    viewers.set(key, entry);
    if (isNew) publish();
    return isNew;
  }

  /** Новый слушатель: обновить список, если он старше 30 секунд. */
  function refreshSoon() {
    if (now() - lastPollAt > 30 * 1000) poll();
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { poll(); }, POLL_MS);
    if (timer.unref) timer.unref();
    setTimeout(() => { poll(); }, 5000).unref?.();
  }

  return { poll, refreshSoon, noteChatter, snapshotMessage, list, start };
}

let defaultService = null;

function getPresenceService() {
  if (defaultService) return defaultService;
  const websocket = require('../app/websocket');
  const config = require('../config');
  const { getBotList } = require('../helpers/arrayHelper');
  defaultService = createPresenceService({
    fetchViewers: () => require('../twitchApi/viewers')(),
    broadcast: (payload) => websocket.broadcast(payload),
    hasListeners: () => websocket.clients.size > 0,
    ignoredLogins: [...getBotList(), config.BOT_NAME].filter(Boolean),
  });
  return defaultService;
}

module.exports = {
  createPresenceService,
  getPresenceService,
  CHATTER_TTL_MS,
};
