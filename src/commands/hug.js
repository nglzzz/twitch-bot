const arrayHelper = require('../helpers/arrayHelper');
const getChannelViewers = require('../twitchApi/viewers');
const { getChatters } = require('../chat/chatters');
const messageHelper = require('../helpers/messageHelper');

async function onHugCommand(channel, tags, message) {
  const viewers = await getChannelViewers();

  let subject = messageHelper.getSubjectFromMessage(message);

  if (subject.length === 0) {
    subject = viewers.length > 0
      ? arrayHelper.getRandomArrayElement(viewers)
      : arrayHelper.getRandomArrayElement(getChatters());
  }

  const list = [
    'нежно',
    'крепко',
    'с любовью',
    'с яростью',
    'с жалостью',
    'со слезами на глазах',
    'и благодарит за всё',
    'по дружески',
    '',
    '',
  ];
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter} обнимает @${subject} ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onHugCommand;
