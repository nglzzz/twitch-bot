const arrayHelper = require('../helpers/arrayHelper');

async function onBoobsCommand(channel, tags) {
  const list = [
    'Нулёвочка. Грудь не главное',
    'Гордый первый размер!',
    'Второй размер, есть за что потрогать!',
    'Третий размер! Идеал!',
    'Четвертый размер, лучше с такими не прыгать',
    'Пятый размер. Лифчики только под заказ',
    'Шестой размер, тело тянет вниз',
    'Десятый размер! С такими сложно встать с кровати',
    'Двадцатый размер! Рекорд!',
  ]

  return `Грудь у @${tags.username}: ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onBoobsCommand;
