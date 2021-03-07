const arrayHelper = require('../helpers/arrayHelper');

async function onPenisCommand(channel, tags) {
  const list = [
    `2 мм. - Господа, несите лупу!`,
    "2 см - Член же не главное?",
    "10 см - Зато мама говорит что ты красивый",
    "12 см - говорят это стандарт",
    "14 см - Ну хоть что-то можешь",
    "16 см - Можешь гордиться",
    "18 см - Почему ты ещё не снимаешься в порно?",
    "20 см - Думаешь мы тебе поверим?",
    "30 см - Мутант",
    "50 см - Носить не тяжело?",
  ]

  return `Член у @${tags.username}: ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onPenisCommand;
