const path = require('path');
global.APP_PATH = path.dirname(__filename);
global.SRC_PATH = path.join(APP_PATH, 'src');

require('./src/app/webserver');
require('./src/app/websocket');
require('./src/app/chat');
require('./src/app/db');
require('./src/websockets/eventHandler');
require('./src/chat/handler');
require('./src/chat/timers');

console.log('NGLZZZ twitch bot has been started!');
