const axios = require('axios');
const config = require('../config');
const { getTwitchAccessToken } = require('../services/token.service');

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const RETRYABLE_ERRORS = new Set([
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error) {
  const code = error?.code || error?.errno;
  return Boolean(code && RETRYABLE_ERRORS.has(code));
}

const getChannelInfo = async (channel) => {
  channel = channel || config.CHANNEL;
  const token = await getTwitchAccessToken();

  if (!token) {
    throw new Error('Twitch access token is not configured');
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Client-Id': config.TWITCH_API_CLIENT_ID,
        }
      });

      return response.data.data;
    } catch (error) {
      lastError = error;

      if (isTransientError(error) && attempt < MAX_RETRIES) {
        console.warn(`[TwitchAPI] Transient error (${error.code}) on attempt ${attempt}/${MAX_RETRIES}, retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

const isChannelLive = async (channel) => {
  const channelInfo = await getChannelInfo(channel);
  return channelInfo && channelInfo.length > 0;
}

module.exports = {
  getChannelInfo: getChannelInfo,
  isChannelLive: isChannelLive,
};
