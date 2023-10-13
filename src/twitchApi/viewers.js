const axios = require('axios');
const config = require('../config');
const arrayHelper = require('../helpers/arrayHelper');
const getOAuthToken = require('./oauth');

const getChannelViewers = async () => {
  const oauthToken = await getOAuthToken();

  const response = await axios.get(`https://api.twitch.tv/helix/users?login=${config.CHANNEL}`, {
    headers: {
      'Client-Id': config.TWITCH_API_CLIENT_ID,
      'Authorization': `Bearer ${oauthToken.token}`,
    },
  });

  const viewers = response.data.data;

  if (!viewers) {
    return [];
  }

  const nicknames = [];
  for (const viewer of viewers) {
    if (viewer.type === 'bot') {
      continue;
    }

    nicknames.push(viewer.display_name);
  }

  return arrayHelper.removeBotsFromList(nicknames);
}

module.exports = getChannelViewers;
