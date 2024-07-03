const arrayHelper = require('../helpers/arrayHelper');

async function onPenisCommand(channel, tags) {
  const list = [
    'Ноль! У тебя нет члена',
    '2 мм. - Господа, несите лупу!',
    '2 см - Член же не главное?',
    '10 см - Зато мама говорит что ты красивый PogChamp',
    '12 см - говорят это стандарт',
    '14 см - Ну хоть что-то можешь',
    '16 см - Можешь гордиться SeemsGood',
    '18 см - Почему ты ещё не снимаешься в порно?',
    '19 см - Oh my ',
    '20 см - Думаешь мы тебе поверим?',
    '30 см - Мутант',
    '50 см - Носить не тяжело?',
    '3,141592653589 см - это размер твоего члена. Число пи вечно тебя преследует, верно?'
  ];
  const chatter = tags['display-name'] ?? tags.username;

  return `Член у @${chatter}: ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onPenisCommand;
