const tmiClient = require('../app/tmi');
const copyPastList = require('../utils/copypasts');
const arrayHelper = require('../helpers/arrayHelper');
const config = require('../config');
const { getLatestChatters } = require('./chatters');
const getChannelViewers = require('../twitchApi/viewers');
const viewerModel = require('../models/viewer.model');
const getChannelInfo = require('../twitchApi/channelInfo');

const copyPastTimer = setInterval(() => {
  const latestChatter = (getLatestChatters()[getLatestChatters().length - 1]).toLowerCase();

  if (config.BOT_NAME.toLocaleLowerCase() === latestChatter) {
    return;
  }

  const randomMessage = arrayHelper.getRandomArrayElement(copyPastList);
  tmiClient.say(config.CHANNEL, randomMessage);
}, 1000 * 60 * 20); // every 20 minutes

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