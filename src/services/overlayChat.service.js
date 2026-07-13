const websocketServer = require('../app/websocket');

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

function publishChatMessage(message) {
  websocketServer.broadcast({
    type: 'chat',
    nickname: String(message.nickname || message.user || 'Гость').slice(0, 100),
    message: String(message.message || '').slice(0, 2000),
    isSub: Boolean(message.isSub),
    platform: normalizePlatform(message.platform),
    timestamp: Number(message.timestamp) || Date.now(),
  });
}

module.exports = {
  publishChatMessage,
};
