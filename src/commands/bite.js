const arrayHelper = require('../helpers/arrayHelper');
const getChannelViewers = require('../twitchApi/viewers');
const { getChatters } = require('../chat/chatters');
const messageHelper = require('../helpers/messageHelper');

async function onBiteCommand(channel, tags, message) {
  const viewers = getChannelViewers();

  let subject = messageHelper.getSubjectFromMessage(message);

  if (subject.length === 0) {
    subject = viewers.length > 0
      ? arrayHelper.getRandomArrayElement(viewers)
      : arrayHelper.getRandomArrayElement(getChatters());
  }

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
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter} кусает @${subject} за ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onBiteCommand;
