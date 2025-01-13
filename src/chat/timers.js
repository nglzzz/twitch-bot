const Chat = require('../app/chat');
const copyPastList = require('../utils/copypasts');
const arrayHelper = require('../helpers/arrayHelper');
const config = require('../config');
const { getLatestChatters } = require('./chatters');
const getChannelViewers = require('../twitchApi/viewers');
const viewerModel = require('../models/viewer.model');
const { isChannelLive } = require('../twitchApi/channelInfo');

const copyPastTimer = setInterval(async () => {
  let latestChatter = '';
  const latestChatters = getLatestChatters();

  if (latestChatters.length > 0) {
    latestChatter = (latestChatters[latestChatters.length - 1]).toLowerCase();
  }

  console.log(`Latest chatter: ${latestChatter}`);

  if (arrayHelper.getBotList().includes(latestChatter)) {
    return;
  }

  const isLive = await isChannelLive();
  if (!isLive) {
    console.log('Channel is not live');
    return;
  }

  const randomMessage = arrayHelper.getRandomArrayElement(copyPastList)
    .split('*streamername*')
    .join(config.CHANNEL)
    .split('*botname*')
    .join(config.BOT_NAME);
  Chat.handleMessageResult(randomMessage, config.CHANNEL);
}, 1000 * 60 * 45); // every 45 minutes

const saveViewersTimer = setInterval(async () => {
  try {
    try {
      const isLive = await isChannelLive();

      if (!isLive) {
        return;
      }
    } catch (e) {
      console.log(e);
      return;
    }

    const viewers = await getChannelViewers();
    if (viewers.length === 0) {
      return;
    }
    const viewerDb = new viewerModel({
      viewers: viewers,
    });

    viewerDb.save();
  } catch (e) {
    console.log(e);
  }
}, 1000 * 60 * 5); // every 5 minutes

module.exports = {
  copyPastTimer: copyPastTimer,
  saveViewersTimer: saveViewersTimer,
};
