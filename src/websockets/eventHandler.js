const websocketServer = require('../app/websocket');
const tmiClient = require('../app/tmi');
const messageHelper = require('../helpers/messages');

websocketServer.on('connection', function (ws) {
  tmiClient.on('message', (channel, tags, message, self) => {
    if (messageHelper.isHighlightMessage(tags)) {
      ws.send(JSON.stringify({
        nickname: tags.username,
        text: message
      }));
    }
  });
});
