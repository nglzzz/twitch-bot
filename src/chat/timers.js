const Chat = require('../app/chat');
const copyPastList = require('../data/copypasts');
const arrayHelper = require('../helpers/arrayHelper');
const config = require('../config');
const { getLatestChatters } = require('./chatters');
const getChannelViewers = require('../twitchApi/viewers');
const viewerRepo = require('../repositories/viewer.repo');
const { isChannelLive } = require('../twitchApi/channelInfo');
const { startTracking, getActiveSessionId } = require('../services/streamTracker.service');
const { startPolling } = require('../services/memeAlerts.service');
const { startPolling: startUsdtTrc20Polling } = require('../services/usdtTrc20.service');
const { startScheduler } = require('../services/scheduler.service');
const { refreshDonationAlertsConnection } = require('../services/donations.service');
const { ensureInitialAdmin } = require('../services/adminAuth.service');
const { isDbReady } = require('../app/db');

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

    // Снапшот нужен для unique-viewers/watch-time. Пиковый/средний онлайн теперь
    // считается в streamTracker из Streams API, поэтому здесь сессия только
    // привязывается к снапшоту — счётчик из chat/chatters больше не гоняем.
    let streamSessionId = null;
    try {
      streamSessionId = await getActiveSessionId();
    } catch (_) {
      // Ignore — snapshot will be saved without stream link
    }

    try {
      viewerRepo.insert({ viewers, streamSessionId });
    } catch (error) {
      console.log('Could not save viewer snapshot:', error.message);
    }
  } catch (error) {
    console.error('[Timers] Error in saveViewersTimer:', error.code || error.message);
  }
}, 1000 * 60 * 5); // every 5 minutes

// Start stream tracking (checks every 5 minutes)
startTracking(5 * 60 * 1000);

// Start meme alerts polling (every 2 minutes by default)
startPolling();

// Start USDT TRC20 wallet polling (every 30 seconds by default)
startUsdtTrc20Polling();

// Scheduled tasks and the DonationAlerts Socket.IO client are server-side and
// therefore continue working when the admin browser is closed.
startScheduler();
const initializeAdminIntegrations = () => {
  ensureInitialAdmin().catch((error) => console.error('[Admin] Bootstrap failed:', error.message));
  refreshDonationAlertsConnection();
};
// В SQLite соединение устанавливается синхронно при загрузке модуля db.js,
// поэтому инициализируем админ-интеграции сразу.
if (isDbReady()) {
  initializeAdminIntegrations();
}
setInterval(refreshDonationAlertsConnection, 60 * 1000);

module.exports = {
  copyPastTimer: copyPastTimer,
  saveViewersTimer: saveViewersTimer,
};
