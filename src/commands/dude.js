const getChannelViewers = require('../twitchApi/viewers');
const messageHelper = require('../helpers/messageHelper');
const arrayHelper = require('../helpers/arrayHelper');
const {getLatestChatters} = require('../chat/chatters');

async function onDudeCommand(channel, tags, message) {
  const viewers = await getChannelViewers();

  let subject = messageHelper.getSubjectFromMessage(message);

  const dude = viewers.length > 0
    ? arrayHelper.getRandomArrayElement(viewers)
    : arrayHelper.getRandomArrayElement(getLatestChatters());

  return ` @${dude} ${subject}`;
}

module.exports = onDudeCommand;
