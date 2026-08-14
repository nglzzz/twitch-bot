const axios = require('axios');
const config = require('../config');
const { getTwitchAccessToken } = require('../services/token.service');

const deleteMessage = async (messageId) => {
  const broadcasterId = config.BROADCASTER_ID;
  const moderatorId = config.MODERATOR_ID;
  const token = await getTwitchAccessToken();

  if (!token) {
    throw new Error('Twitch access token is not configured');
  }

  let url = `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`;

  if (messageId) {
    url += `&message_id=${messageId}`;
  }

  const response = await axios.delete(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Client-Id': config.TWITCH_API_CLIENT_ID,
    }
  });

  return response.data.data;
}

module.exports = deleteMessage;
