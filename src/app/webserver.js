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
app.use(helmet());

// Use our routes
app.use('/', routes);

app.listen(port, host);
console.log(`running on http://${host}:${port}`);

module.exports = app;
