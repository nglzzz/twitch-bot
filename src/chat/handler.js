const tmiClient = require('../app/tmi');

tmiClient.registerCommand('!help', require('../commands/help'), '!хелп');
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
tmiClient.registerCommand('!roulette', require('../commands/roulette'), '!рулетка');
tmiClient.registerCommand('!steam', require('../commands/steam'), '!стим');
tmiClient.registerCommand('!discord', require('../commands/discord'), '!дискорд');
tmiClient.registerCommand('!youtube', require('../commands/youtube'), '!ютуб');
tmiClient.registerCommand('!goodgame', require('../commands/goodgame'), '!gg');
tmiClient.registerCommand('!chance', require('../commands/chance'), '!шанс');
tmiClient.registerCommand('!coin', require('../commands/coin'), '!монетка');
tmiClient.registerCommand('!шлёп', require('../commands/slap'), '!шлеп');
tmiClient.registerCommand('!тьфу', require('../commands/spit'), '!хатьфу');
tmiClient.registerCommand('!boobs', require('../commands/boobs'), '!грудь');
//tmiClient.registerCommand('!raffle', require('../commands/raffle'), '!розыгрыш');
tmiClient.registerCommand('!subgame', require('../commands/subgame'), '!сабигра');
tmiClient.registerCommand('!subgames', require('../commands/subgames'), '!сабигры');
tmiClient.registerCommand('!delete-subgame', require('../commands/deleteSubgame'), '!удалить-сабигру');

// Rewards
tmiClient.registerReward('6f37c88e-7d8d-42aa-963b-73d131f588f3', require('../rewards/lottery'));


// TODO:
// !wiki <что ищем>
// !обнять
