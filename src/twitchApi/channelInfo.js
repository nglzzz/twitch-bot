const axios = require('axios');
const config = require('../config');
const getOAuthToken = require('./oauth');

const getChannelInfo = async (channel) => {
  channel = channel || config.CHANNEL;
  const oauth = await getOAuthToken();
  const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
    headers: {
      'Authorization': `Bearer ${oauth.token}`,
      'Client-Id': config.TWITCH_API_CLIENT_ID,
    }
  });

  return response.data.data;
}

module.exports = getChannelInfo;
