const axios = require('axios');
const config = require('../config');

const deleteMessage = async (messageId) => {
  const broadcasterId = config.BROADCASTER_ID;
  const moderatorId = config.MODERATOR_ID;

  let url = `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`;

  if (messageId) {
    url += `&message_id=${messageId}`;
  }

  const response = await axios.delete(url, {
    headers: {
      'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}`,
      'Client-Id': config.TWITCH_API_CLIENT_ID,
    }
  });

  return response.data.data;
}

module.exports = deleteMessage;
