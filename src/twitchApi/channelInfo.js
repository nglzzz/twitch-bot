const axios = require('axios');
const config = require('../config');

const getChannelInfo = async (channel) => {
  channel = channel || config.CHANNEL;
  const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
    headers: {
      'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}`,
      'Client-Id': config.TWITCH_API_CLIENT_ID,
    }
  });

  return response.data.data;
}

const isChannelLive = async (channel) => {
  const channelInfo = await getChannelInfo(channel);
  return channelInfo && channelInfo.length > 0;
}

module.exports = {
  getChannelInfo: getChannelInfo,
  isChannelLive: isChannelLive,
};
