const arrayHelper = require('../helpers/arrayHelper');

async function onHelloCommand(channel, tags) {
  const list = [
    'Здарова',
    'Хай',
    'Чё, как?',
    'Вечер в хату',
    'Шалом',
  ];

  return `@${tags.username}, ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onHelloCommand;
