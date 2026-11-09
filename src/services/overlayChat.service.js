// Сервер поднимается при первом require, поэтому подключаем его лениво (модуль используют тесты).
const getWebsocketServer = () => require('../app/websocket');

const SUPPORTED_PLATFORM_NAMES = new Set([
  'twitch',
  'kick',
  'vkplay',
  'w.tv',
  'goodgame',
  'trovo',
  'wasd',
  'youtube',
]);

function normalizePlatform(platform) {
  const normalized = String(platform || 'twitch').trim().toLowerCase();
  return SUPPORTED_PLATFORM_NAMES.has(normalized) ? normalized : normalized.slice(0, 32) || 'other';
}

const BADGES = ['broadcaster', 'moderator', 'vip', 'subscriber', 'founder', 'partner'];

function normalizeBadges(badges) {
  if (!badges || typeof badges !== 'object') return [];
  return BADGES.filter((name) => badges[name] != null);
}

/** Twitch-эмоуты из IRC-тегов: { id: ['0-4', ...] } → [{ id, start, end }]. */
function normalizeEmotes(emotes) {
  if (!emotes || typeof emotes !== 'object') return [];
  const result = [];
  for (const [id, ranges] of Object.entries(emotes)) {
    if (!/^[\w-]{1,64}$/.test(id) || !Array.isArray(ranges)) continue;
    for (const range of ranges.slice(0, 50)) {
      const match = /^(\d+)-(\d+)$/.exec(String(range));
      if (match) result.push({ id, start: Number(match[1]), end: Number(match[2]) });
    }
  }
  return result.sort((a, b) => a.start - b.start).slice(0, 100);
}

function normalizeColor(color) {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

function publishChatMessage(message) {
  getWebsocketServer().broadcast({
    type: 'chat',
    id: message.id ? String(message.id).slice(0, 64) : null,
    login: message.login ? String(message.login).toLowerCase().slice(0, 64) : null,
    nickname: String(message.nickname || message.user || 'Гость').slice(0, 100),
    message: String(message.message || '').slice(0, 2000),
    isSub: Boolean(message.isSub),
    color: normalizeColor(message.color),
    badges: normalizeBadges(message.badges),
    emotes: normalizeEmotes(message.emotes),
    platform: normalizePlatform(message.platform),
    timestamp: Number(message.timestamp) || Date.now(),
  });
}

module.exports = {
  publishChatMessage,
  normalizeEmotes,
};
