const Chat = require('../app/chat');
const copyPastList = require('../utils/copypasts');
const arrayHelper = require('../helpers/arrayHelper');
const config = require('../config');
const { getLatestChatters } = require('./chatters');
const getChannelViewers = require('../twitchApi/viewers');
const viewerModel = require('../models/viewer.model');
const { isChannelLive } = require('../twitchApi/channelInfo');
const { startTracking, linkViewerSnapshotToStream } = require('../services/streamTracker.service');
const { startPolling } = require('../services/memeAlerts.service');

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

  let isLive;
  try {
    isLive = await isChannelLive();
  } catch (error) {
    console.error('[Timers] Error checking stream status for copypast:', error.code || error.message);
    return;
  }

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
}, 1000 * 60 * 40); // every 40 minutes

const saveViewersTimer = setInterval(async () => {
  try {
    try {
      const isLive = await isChannelLive();

      if (!isLive) {
        return;
      }
    } catch (error) {
      console.error('[Timers] Error checking stream status for viewers:', error.code || error.message);
      return;
    }

    const viewers = await getChannelViewers();
    if (viewers.length === 0) {
      return;
    }
    const viewerDb = new viewerModel({
      viewers: viewers,
    });

    try {
      await linkViewerSnapshotToStream(viewerDb);
    } catch (_) {
      // Ignore — snapshot will be saved without stream link
    }

    viewerDb.save();
  } catch (error) {
    console.error('[Timers] Error in saveViewersTimer:', error.code || error.message);
  }
}, 1000 * 60 * 5); // every 5 minutes

// Start stream tracking (checks every 5 minutes)
startTracking(5 * 60 * 1000);

// Start meme alerts polling (every 2 minutes by default)
startPolling();

module.exports = {
  copyPastTimer: copyPastTimer,
  saveViewersTimer: saveViewersTimer,
};
