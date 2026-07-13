const WebSocket = require('ws');
const config = require('../config');

const wss = new WebSocket.Server({
  port: config.WEBSOCKET_PORT || 8081,
});

wss.broadcast = function broadcast(payload) {
  const message = JSON.stringify(payload);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

module.exports = wss;
