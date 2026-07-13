const websocketServer = require('../app/websocket');
const Chat = require('../app/chat');
const messageHelper = require('../helpers/messageHelper');
const { loadCatalog, getCachedCatalog } = require('../services/emoteCatalog.service');
const { publishChatMessage } = require('../services/overlayChat.service');
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
      nickname: tags['display-name'] ?? tags.username,
      message,
      isSub: !!tags.subscriber,
      platform: 'twitch',
      timestamp: Date.now(),
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
