const WebSocket = require('ws');
const config = require('../config');

const wss = new WebSocket.Server({
  port: config.WEBSOCKET_PORT || 8081,
});

module.exports = wss;
