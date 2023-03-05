const Chat = require('../app/chat');
const copyPastList = require('../utils/copypasts');
const arrayHelper = require('../helpers/arrayHelper');
const config = require('../config');
const { getLatestChatters } = require('./chatters');
const getChannelViewers = require('../twitchApi/viewers');
const viewerModel = require('../models/viewer.model');
const getChannelInfo = require('../twitchApi/channelInfo');

const copyPastTimer = setInterval(() => {
  let latestChatter = '';
  const latestChatters = getLatestChatters();

  if (latestChatters.length > 0) {
    latestChatter = (latestChatters[latestChatters.length - 1]).toLowerCase();
  }

  if (arrayHelper.getBotList().includes(latestChatter)) {
    return;
  }

  const randomMessage = arrayHelper.getRandomArrayElement(copyPastList)
    .replace('*streamername*', config.CHANNEL)
    .replace('*botname*', config.BOT_NAME);
  Chat.handleMessageResult(randomMessage, config.CHANNEL);
}, 1000 * 60 * 25); // every 25 minutes

const saveViewersTimer = setInterval(async () => {
  try {
    try {
      const channelInfo = await getChannelInfo();
      const isOnline = channelInfo.length > 0;

      if (!isOnline) {
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
