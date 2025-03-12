const Chat = require('../app/chat');
const {randomInteger} = require('../helpers/numberHelper');
const doRandomAsk = require('../utils/botAsking');
const arrayHelper = require('../helpers/arrayHelper');

Chat.registerCommand('!help', require('../commands/help'), '!хелп');
Chat.registerCommand('!hello', require('../commands/hello'), '!привет');
Chat.registerCommand('!penis', require('../commands/penis'), '!пенис');
Chat.registerCommand('!bite', require('../commands/bite'), '!кусь');
Chat.registerCommand('!iq', require('../commands/iq'));
Chat.registerCommand('!life', require('../commands/life'), '!пожизни');
Chat.registerCommand('!links', require('../commands/links'), '!ссылки');
Chat.registerCommand('!nickname', require('../commands/nickname'), '!никнейм');
Chat.registerCommand('!ball', require('../commands/8ball'), '!шар');
Chat.registerCommand('!love', require('../commands/love'), '!любовь');
Chat.registerCommand('!joke', require('../commands/joke'), '!анекдот');
Chat.registerCommand('!horoscope', require('../commands/horoscope'), '!гороскоп');
Chat.registerCommand('!roulette', require('../commands/roulette'), '!рулетка');
Chat.registerCommand('!steam', require('../commands/steam'), '!стим');
Chat.registerCommand('!discord', require('../commands/discord'), '!ds');
Chat.registerCommand('!youtube', require('../commands/youtube'), '!ютуб');
Chat.registerCommand('!goodgame', require('../commands/goodgame'), '!gg');
Chat.registerCommand('!trovo', require('../commands/trovo'), '!трово');
// Chat.registerCommand('!wasd', require('../commands/wasd'), '!васд');
Chat.registerCommand('!chance', require('../commands/chance'), '!шанс');
Chat.registerCommand('!coin', require('../commands/coin'), '!монетка');
Chat.registerCommand('!шлёп', require('../commands/slap'), '!шлеп');
Chat.registerCommand('!тьфу', require('../commands/spit'), '!хатьфу');
Chat.registerCommand('!boobs', require('../commands/boobs'), '!грудь');
//Chat.registerCommand('!raffle', require('../commands/raffle'), '!розыгрыш');
// Chat.registerCommand('!subgame', require('../commands/subgame'), '!сабигра');
// Chat.registerCommand('!subgames', require('../commands/subgames'), '!сабигры');
// Chat.registerCommand('!delete-subgame', require('../commands/deleteSubgame'), '!удалить-сабигру');
Chat.registerCommand('!copypast', require('../commands/copypast'), '!копипаста');
Chat.registerCommand('!kill', require('../commands/kill'), '!убить');
Chat.registerCommand('!sex', require('../commands/sex'), '!секс');
Chat.registerCommand('!boosty', require('../commands/boosty'), '!бусти');
Chat.registerCommand('!tiktok', require('../commands/tiktok'), '!тикток');
Chat.registerCommand('!чат', require('../commands/chat'), '!chat');
Chat.registerCommand('!пк', require('../commands/specs'), '!specs');
Chat.registerCommand('!tg', require('../commands/tg'), '!telegram');
Chat.registerCommand('!tgds', require('../commands/tgds'), '!dstg');
Chat.registerCommand('!обнять', require('../commands/hug'), '!hug');
Chat.registerCommand('!канал2', require('../commands/channel2'), '!channel2');
Chat.registerCommand('!donate', require('../commands/donate'), '!донат');
Chat.registerCommand('!rating', require('../commands/rating'), '!рейтинг');
Chat.registerCommand('!memealerts', require('../commands/memealerts'), '!мемы');
Chat.registerCommand('!sub', require('../commands/sub'), '!саб');
Chat.registerCommand('!spam', require('../commands/spam'), '!спам');
Chat.registerCommand('!bitcoin', require('../commands/bitcoin'), '!биткоин');

// Rewards
// Chat.registerReward('6f37c88e-7d8d-42aa-963b-73d131f588f3', require('../rewards/lottery'));


// TODO:
// !wiki <что ищем>

const askingChance = 1;
global.ratingStart = false;
global.ratingList = {};

// random ask from bot
Chat.getClient().on('message', (channel, tags, message, self) => {
  const chatter = tags['display-name'] ?? tags.username;
  if (self || message.startsWith('!') || arrayHelper.getBotList().includes(chatter.toLowerCase())) return;

  const randomInt = randomInteger(0, 100);

  // шанс вопроса от бота 1 процент. Но это тоже много,
  // поэтому при выпадении 1 процента ещё проверка на 50/50 происходит
  const chanceSuccess = randomInt < askingChance && randomInteger(0, 100) < 50;

  if (chanceSuccess) {
    doRandomAsk(chatter, message).then(handlerResult => Chat.handleMessageResult(handlerResult, channel));
  }

  if (ratingStart) {
    const rating = parseInt(message.trim());
    if (rating > 0 && rating <= 10) {
      ratingList[chatter] = rating;
    }
  }
});
