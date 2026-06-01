const express = require('express');
const helmet = require('helmet');
const handlebars = require('express-handlebars');
const routes = require('../webserver/routes');
const config = require('../config');

const app = express();

const port = config.WEB_PORT || 8080;
const host = '0.0.0.0';

app.engine('handlebars', handlebars({ defaultLayout: 'main' }));
app.set('views', './src/views');
app.set('view engine', 'handlebars');
app.set('trust proxy', true);
app.use(express.static('public'));
app.use(helmet({
  contentSecurityPolicy: {
	directives: {
	  defaultSrc: ["'self'"],
	  scriptSrc: ["'self'", "'unsafe-inline'"],
	  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
	  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
	  imgSrc: ["'self'", 'data:', 'https:'],
	  frameSrc: ["'self'", 'https://player.twitch.tv', 'https://www.twitch.tv'],
	  connectSrc: ["'self'", 'https://api.twitch.tv', 'ws:', 'wss:'],
	  mediaSrc: ["'self'", 'blob:', 'data:'],
	},
  },
  crossOriginEmbedderPolicy: false,
}));

// Use our routes
app.use('/', routes);

app.listen(port, host);
console.log(`running on http://${host}:${port}`);

module.exports = app;
