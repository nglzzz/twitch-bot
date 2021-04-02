const tmiClient = require('../app/tmi');

tmiClient.registerCommand('!hello', require('../commands/hello'), '!привет');
tmiClient.registerCommand('!penis', require('../commands/penis'), '!пенис');
tmiClient.registerCommand('!bite', require('../commands/bite'), '!кусь');
tmiClient.registerCommand('!iq', require('../commands/iq'));
tmiClient.registerCommand('!life', require('../commands/life'), '!пожизни');
tmiClient.registerCommand('!links', require('../commands/links'), '!ссылки');
tmiClient.registerCommand('!nickname', require('../commands/nickname'), '!никнейм');
tmiClient.registerCommand('!ball', require('../commands/8ball'), '!шар');
tmiClient.registerCommand('!love', require('../commands/love'), '!любовь');
tmiClient.registerCommand('!joke', require('../commands/joke'), '!анекдот');
tmiClient.registerCommand('!horoscope', require('../commands/horoscope'), '!гороскоп');
tmiClient.registerCommand('!test', require('../commands/roulette'), '!тест');


// TODO:
// !гороскоп
// !wiki <что ищем>
// !Steam
// !Ds !discord
// !youtube
// !обнять
// !шлеп
// !Хатьфу
// !шанс <СОБЫТИЕ>
// !монетка <сторона>
// звоковые команды (дуит, смех, фбр)
