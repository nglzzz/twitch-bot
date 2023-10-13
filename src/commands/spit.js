const arrayHelper = require('../helpers/arrayHelper');
const getChannelViewers = require('../twitchApi/viewers');
const { getChatters } = require('../chat/chatters');
const messageHelper = require('../helpers/messageHelper');

async function onSpitCommand(channel, tags, message) {
  const viewers = await getChannelViewers();

  let subject = messageHelper.getSubjectFromMessage(message);
  let firstSentence;
  const chatter = tags['display-name'] ?? tags.username;

  if (subject.length === 0) {
    subject = viewers.length > 0
      ? arrayHelper.getRandomArrayElement(viewers)
      : arrayHelper.getRandomArrayElement(getChatters());

    firstSentence = `@${chatter} набирает слюны в рот и не глядя харкает в толпу, попадая @${subject}`;
  } else {
    firstSentence = `@${chatter} хорошо прицелившись харкает @${subject}`;
  }

  const list = [
    'в глаза',
    'в рот',
    'в нос',
    'в уши',
    'в волосы',
    'в трусы',
    'в совесть',
    'на руку',
    'на жопу',
    'на лобок',
    'в пупок',
    `но тот уворачивается и перенаправляет харчу в лицо @${chatter}`,
  ];

  return `${firstSentence} ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onSpitCommand;
