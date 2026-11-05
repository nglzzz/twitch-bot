const { isDbReady } = require('../app/db');
const Chat = require('../app/chat');
const communityRepo = require('../repositories/community.repo');
const paidSubscriptionRepo = require('../repositories/communityPaidSubscriptions.repo');
const { getBotList } = require('../helpers/arrayHelper');
const config = require('../config');
const { linkMessageToStream } = require('../services/streamTracker.service');

Chat.getClient().on('message', async (channel, tags, message, self) => {
  if (self || !tags?.username || !message || message.startsWith('!') || !isDbReady()) {
    return;
  }

  const user = tags.username.toLowerCase();
  if (getBotList().includes(user) || user === String(config.BOT_NAME || '').toLowerCase()) return;
  const displayName = tags['display-name'] ?? tags.username;
  const receivedAt = Date.now();

  let streamSessionId = null;
  try {
    streamSessionId = await linkMessageToStream();
  } catch (_) {
    // Ignore — message will be saved without stream link
  }

  try {
    communityRepo.recordChat({
      userId: tags['user-id'],
      username: user,
      displayName,
      message,
      messageId: tags.id,
      streamSessionId,
      createdAt: receivedAt,
    });
  } catch (error) {
    console.log('Could not save chat log entry:', error.message);
    return;
  }

  if (tags.subscriber === true || tags.subscriber === 1 || tags.subscriber === '1') {
    try {
      paidSubscriptionRepo.recordTwitchSubscription({
        userId: tags['user-id'],
        username: user,
        displayName,
        confirmedAt: receivedAt,
        identityAlreadyPrepared: true,
      });
    } catch (error) {
      console.log('Could not save Twitch subscription confirmation:', error.message);
    }
  }
});
