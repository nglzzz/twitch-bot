const express = require('express');
const routes = express.Router();
const config = require('../config');
const speech = require('../utils/speech');

routes.get('/', (req, res) => {
  res.set('Content-Security-Policy', 'default-src \'self\' \'unsafe-inline\'; connect-src *; font-src * data:');
  res.render('pages/home', {
    websocketPort: config.DOCKER_WEBSOCKET_PORT || config.WEBSOCKET_PORT
  });
});

routes.get('/speech', (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  speech.useGoogleSpeech((data) => {
    res.end(JSON.stringify(data));
  }, req.query.text, req.query.pitch);
});

module.exports = routes;
