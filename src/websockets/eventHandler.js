const websocketServer = require('../app/websocket');
const tmiClient = require('../app/tmi');
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
  tmiClient.on('message', (channel, tags, message, self) => {
    if (messageHelper.isHighlightMessage(tags) && messageHelper.isSubscriberMessage(tags)) {
      ws.send(JSON.stringify({
        type: 'speech',
        nickname: tags.username,
        text: message
      }));
    }

    if (messageHelper.isSubscriberMessage(tags) && allowedAudioCommands.indexOf(`${message}`) !== -1) {
      ws.send(JSON.stringify({
        type: 'audio',
        name: `${message.substring(1)}.mp3`,
      }));
    }
  });
});
