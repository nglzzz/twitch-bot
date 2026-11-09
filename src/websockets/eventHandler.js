const websocketServer = require('../app/websocket');
const Chat = require('../app/chat');
const messageHelper = require('../helpers/messageHelper');
const { loadCatalog, getCachedCatalog } = require('../services/emoteCatalog.service');
const { publishChatMessage } = require('../services/overlayChat.service');
const { getPresenceService } = require('../services/presence.service');
const { getStreamSummaryService } = require('../services/streamSummary.service');
const { getDonationTopService } = require('../services/donationTop.service');
const { getAlerts } = require('../services/alerts');
const arrayHelper = require('../helpers/arrayHelper');
const allowedAudioCommands = [
  '!badabum',
  '!fatality',
  '!final',
  '!haha',
  '!illuminati',
  '!lol',
  '!nice',
  '!nooo',
  '!run',
  '!sad',
  '!sparta',
  '!злойсмех',
  '!потрачено',
  '!продолжениеследует',
  '!тромбон',
  '!фбр',
  '!doit',
  '!titanic',
];

websocketServer.on('connection', function (ws) {
  const emotes = getCachedCatalog();
  if (emotes.length > 0) {
    ws.send(JSON.stringify({ type: 'emotes', emotes }));
  }
});

Chat.getClient().on('message', (channel, tags, message, self) => {
  if (self) return;

  const channelId = tags['room-id'];
  if (channelId) {
    loadCatalog(channelId)
      .then((emotes) => websocketServer.broadcast({ type: 'emotes', emotes }))
      .catch((error) => console.warn('[Emotes] Could not load catalog:', error.message));
  }

  // All chat messages
  if (!message.startsWith('!')) {
    publishChatMessage({
      id: tags.id,
      login: tags.username,
      nickname: tags['display-name'] ?? tags.username,
      message,
      isSub: !!tags.subscriber,
      color: tags.color,
      badges: tags.badges,
      emotes: tags.emotes,
      platform: 'twitch',
      timestamp: Date.now(),
    });
  }

  if (!arrayHelper.getBotList().includes(String(tags.username || '').toLowerCase())) {
    getPresenceService().noteChatter({
      login: tags.username,
      name: tags['display-name'] ?? tags.username,
      color: tags.color,
    });
  }

  // Highlighted subscriber messages → speech
  if (messageHelper.isHighlightMessage(tags) && messageHelper.isSubscriberMessage(tags)) {
    websocketServer.broadcast({
      type: 'speech',
      nickname: tags.username,
      text: message,
    });
  }

  // Subscriber audio commands
  if (messageHelper.isSubscriberMessage(tags) && allowedAudioCommands.indexOf(`${message}`) !== -1) {
    websocketServer.broadcast({
      type: 'audio',
      name: `${message.substring(1)}.mp3`,
    });
  }
});

// Модерация: убираем сообщения из чата на оверлеях.
Chat.getClient().on('messagedeleted', (channel, username, deletedMessage, userstate) => {
  const id = userstate && userstate['target-msg-id'];
  if (id) websocketServer.broadcast({ type: 'chat:delete', id });
});
Chat.getClient().on('timeout', (channel, username) => {
  websocketServer.broadcast({ type: 'chat:clear-user', login: String(username || '').toLowerCase() });
});
Chat.getClient().on('ban', (channel, username) => {
  websocketServer.broadcast({ type: 'chat:clear-user', login: String(username || '').toLowerCase() });
});
Chat.getClient().on('clearchat', () => {
  websocketServer.broadcast({ type: 'chat:clear' });
});

Chat.getClient().on('raided', (channel, username, viewers) => {
  websocketServer.broadcast({ type: 'raid', login: String(username || '').toLowerCase(), name: username, viewers: Number(viewers) || 0 });
});

websocketServer.on('connection', (ws) => {
  ws.send(JSON.stringify(getPresenceService().snapshotMessage()));
  getPresenceService().refreshSoon();

  // Сцены спрашивают данные: итоги эфира для титров, лучших донатеров для «Доски почёта».
  const answers = {
    'stream:summary': () => getStreamSummaryService().getSummary().then((summary) => ({ summary })),
    'donations:top': () => getDonationTopService().getTop().then((top) => ({ top })),
  };
  ws.on('message', (raw) => {
    if (raw.length > 256) return;
    let request;
    try { request = JSON.parse(raw); } catch (error) { return; }
    // Источник алертов (obs/alerts) представляется и сообщает, что алерт закончился.
    if (request?.type === 'alerts:hello') { getAlerts().hub.attachOverlay(ws); return; }
    if (request?.type === 'alerts:done') { getAlerts().hub.finish(String(request.id || '')); return; }
    const answer = request && answers[request.type];
    if (!answer) return;
    answer()
      .then((data) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: request.type, ...data })); })
      .catch((error) => console.warn(`[Scene] ${request.type} failed:`, error.message));
  });
  ws.on('close', () => getAlerts().hub.detachOverlay(ws));
});
getPresenceService().start();
