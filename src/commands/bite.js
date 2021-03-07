const arrayHelper = require('../helpers/arrayHelper');
const getChannelViewers = require('../twitchApi/viewers');
const getChatters = require('../chat/chatters');

async function onBiteCommand(channel, tags) {
  const viewers = getChannelViewers();

  const randomUser = viewers.length > 0
    ? arrayHelper.getRandomArrayElement(viewers)
    : arrayHelper.getRandomArrayElement(getChatters());

  const list = [
    'ушко',
    'жопку',
    'пальчик',
    'носик',
    'пятку',
    'ляхи',
    'шею',
    'волосы',
    'член',
    'сосок',
    'губы',
    'пупок',
    'анус',
    'лобок',
  ];

  return `@${tags.username} кусает @${randomUser} за ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onBiteCommand;
