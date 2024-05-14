const arrayHelper = require('../helpers/arrayHelper');
const getChannelViewers = require('../twitchApi/viewers');
const { getLatestChatters } = require('../chat/chatters');
const messageHelper = require('../helpers/messageHelper');

async function onKillCommand(channel, tags, message) {
  const viewers = await getChannelViewers();

  let subject = messageHelper.getSubjectFromMessage(message);

  if (subject.length === 0) {
    subject = viewers.length > 0
      ? arrayHelper.getRandomArrayElement(viewers)
      : arrayHelper.getRandomArrayElement(getLatestChatters());
  }

  const list = [
    `проламывает голову @${subject}`,
    `затрахивает @${subject} до смерти`,
    `втыкает нож в брюхо @${subject}`,
    `выносит с ноги @${subject}`,
    `стреляет в @${subject} с пистолета`,
    `убивает @${subject} своим пердежом`,
    `подсыпает @${subject} яд в кружку`,
    `убивает @${subject} световым мечом`,
    `уничтожает @${subject} взглядом`,
    `разрывает @${subject} на куски`,
    `заколотил @${subject} до смерти`,
    `сбивает @${subject} на икарусе`,
    `морально уничтожает @${subject}`,
    `отрубает голову @${subject}`,
    `зацеловывает @${subject} до смерти`,
    `высасывает все соки из @${subject}`,
  ];
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter} ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onKillCommand;
