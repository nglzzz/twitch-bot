const arrayHelper = require('../helpers/arrayHelper');

async function onIqCommand(channel, tags) {
  const list = [
    '01 - Типичный хейтер стримера',
    '21 - Умеет читать по слогам',
    '22 - Мой кот умнее',
    '55 - Пишет с ошибками',
    '60 - Окончил ПТУ',
    '100 - Эрудит',
    '160 - Эйнштейн в чате!',
    '200 - Думаешь кто-то поверит в это?',
  ];

  return `IQ у @${tags.username}: ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onIqCommand;
