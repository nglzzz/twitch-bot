const axios = require('axios');
const config = require('../config');
const getOAuthToken = require('./oauth');

const getChannelInfo = async () => {
  const oauth = await getOAuthToken();
  const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${config.CHANNEL}`, {
    headers: {
      'Authorization': `Bearer ${oauth.token}`,
      'Client-Id': config.TWITCH_API_CLIENT_ID,
    }
  });

  return response.data.data;
}

module.exports = getChannelInfo;
