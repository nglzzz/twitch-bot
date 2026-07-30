const axios = require('axios');
const config = require('../config');
const { isDbReady } = require('../app/db');
const scheduledDonationRepo = require('../repositories/scheduledDonation.repo');
const scheduledMemeRepo = require('../repositories/scheduledMeme.repo');
const { createAndSendDonation } = require('./donations.service');
const { getRuntimeSettings } = require('./adminSettings.service');
const randomMeme = require('../rewards/randomMeme');

let timer = null;

async function sendMeme(meme) {
  const settings = await getRuntimeSettings();
  const channelId = settings.memeAlertsChannelId || config.MEMEALERTS_CHANNEL_ID || '64483d657cd2a3c9dab584bb';
  const sender = meme.sender || 'test';
  const isTestSender = sender === 'test';
  const token = isTestSender ? settings.memeAlertsTestToken : config.MEMEALERTS_JWT;
  if (!token || !channelId) throw new Error(isTestSender ? 'Тестовый MemeAlerts пользователь не настроен' : 'MemeAlerts JWT or channel ID is not configured');
  let stickerId = meme.stickerId;
  if (meme.selection === 'random') {
    const selected = await randomMeme.getRandomMeme(channelId);
    stickerId = selected.id;
  }
  if (!stickerId) throw new Error('Meme sticker was not selected');
  const headers = {
    accept: '*/*',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Origin: 'https://memealerts.com',
    Referer: `https://memealerts.com/${config.CHANNEL || 'nglzzz'}`,
  };
  // Keep compatibility with older sessions that still require browser CSRF headers.
  if (isTestSender && settings.memeAlertsTestCsrf && settings.memeAlertsTestCsrfToken) {
    headers.cookie = `SL_G_WPT_TO=ru; SL_GWPT_Show_Hide_tmp=1; SL_wptGlobTipTmp=1; _csrf=${settings.memeAlertsTestCsrf}; x-csrf-token=${settings.memeAlertsTestCsrfToken}`;
    headers['x-csrf-token'] = settings.memeAlertsTestCsrfToken;
  }
  const response = await axios.post(`https://${config.MEMEALERTS_HOST || 'memealerts.com'}/api/sticker/send`, {
    toChannel: channelId,
    stickerId,
    isSoundOnly: meme.isSoundOnly,
    topic: 'Top',
    name: isTestSender ? (settings.memeAlertsTestName || 'Test user') : (config.CHANNEL || 'nglzzz'),
    isMemePartyActive: false,
    message: meme.message || '',
    deviceType: 'desktop',
  }, {
    headers,
    timeout: 15000,
  });
  if (response.data?.result !== undefined && response.data.result !== 0) {
    throw new Error(`MemeAlerts returned result ${response.data.result}`);
  }
  return response.data;
}

async function processDueDonations() {
  while (true) {
    const item = scheduledDonationRepo.claimDue();
    if (!item) return;
    try {
      await createAndSendDonation(item, 'scheduled');
      scheduledDonationRepo.update(item._id, { status: 'sent', sentAt: new Date() });
    } catch (error) {
      scheduledDonationRepo.update(item._id, {
        status: 'failed',
        error: error.response?.data?.message || error.message,
      });
      console.error('[Scheduler] Donation failed:', error.response?.data?.message || error.message);
    }
  }
}

async function processDueMemes() {
  while (true) {
    const item = scheduledMemeRepo.claimDue();
    if (!item) return;
    try {
      await sendMeme(item);
      scheduledMemeRepo.update(item._id, { status: 'sent', sentAt: new Date() });
    } catch (error) {
      scheduledMemeRepo.update(item._id, {
        status: 'failed',
        error: error.response?.data?.message || error.message,
      });
      console.error('[Scheduler] Meme failed:', error.response?.data?.message || error.message);
    }
  }
}

async function run() {
  if (!isDbReady()) return;
  await Promise.all([processDueDonations(), processDueMemes()]);
}

function startScheduler() {
  if (timer) return;
  timer = setInterval(() => run().catch((error) => console.error('[Scheduler] Run failed:', error.message)), 15000);
  run().catch((error) => console.error('[Scheduler] Initial run failed:', error.message));
  console.log('[Scheduler] Started');
}

module.exports = { startScheduler, run, sendMeme };
