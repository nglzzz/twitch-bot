const arrayHelper = require('../helpers/arrayHelper');

async function onHelloCommand(channel, tags) {
  const list = [
    'Здарова',
    'Хай',
    'Чё, как?',
    'Вечер в хату',
    'Шалом',
  ];
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter}, ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onHelloCommand;
