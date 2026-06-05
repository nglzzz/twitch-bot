const websocketServer = require('../app/websocket');
const Chat = require('../app/chat');
const messageHelper = require('../helpers/messageHelper');
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
  Chat.getClient().on('message', (channel, tags, message, self) => {
    if (self) return;

    // All chat messages
    if (!message.startsWith('!')) {
      ws.send(JSON.stringify({
        type: 'chat',
        nickname: tags['display-name'] ?? tags.username,
        message: message,
        isSub: !!tags.subscriber,
        timestamp: Date.now(),
      }));
    }

    // Highlighted subscriber messages → speech
    if (messageHelper.isHighlightMessage(tags) && messageHelper.isSubscriberMessage(tags)) {
      ws.send(JSON.stringify({
        type: 'speech',
        nickname: tags.username,
        text: message
      }));
    }

    // Subscriber audio commands
    if (messageHelper.isSubscriberMessage(tags) && allowedAudioCommands.indexOf(`${message}`) !== -1) {
      ws.send(JSON.stringify({
        type: 'audio',
        name: `${message.substring(1)}.mp3`,
      }));
    }
  });
});
