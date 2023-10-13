const arrayHelper = require('../helpers/arrayHelper');
const getChannelViewers = require('../twitchApi/viewers');
const { getChatters } = require('../chat/chatters');
const messageHelper = require('../helpers/messageHelper');

async function onGiveCommand(channel, tags, message) {
  const viewers = await getChannelViewers();

  let subject = messageHelper.getSubjectFromMessage(message);

  if (subject.length === 0) {
    subject = viewers.length > 0
      ? arrayHelper.getRandomArrayElement(viewers)
      : arrayHelper.getRandomArrayElement(getChatters());
  }

  const list = [
    'затылку',
    'жопке',
    'попке',
    'яйцам',
    'пузику',
    'ляшкам',
    'груди',
    'защитному костюму HEV',
    'члену',
    'соску',
    'губам',
    'залупе',
    'ушам',
    'невероятному остроумию',
  ];
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter} шлёпает @${subject} по ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onGiveCommand;
