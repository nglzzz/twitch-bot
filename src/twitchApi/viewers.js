const axios = require('axios');
const config = require('../config');
const arrayHelper = require('../helpers/arrayHelper');
const getOAuthToken = require('./oauth');

const getChannelViewers = async () => {
  const oauthToken = await getOAuthToken();
  let response;

  try {
    const url = `https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${config.BROADCASTER_ID}&moderator_id=${config.MODERATOR_ID || config.BROADCASTER_ID}`;
    response = await axios.get(url, {
      headers: {
        'Client-Id': config.TWITCH_API_CLIENT_ID,
        'Authorization': `Bearer ${oauthToken.token}`,
      },
    });
  } catch (e) {
    if (e.response) {
      console.log(e.response.data);
    } else {
      console.log(e);
    }
    return [];
  }

  const viewers = response.data.data;

  if (!viewers) {
    return [];
  }

  const nicknames = [];
  for (const viewer of viewers) {
    if (viewer?.type === 'bot') {
      continue;
    }

    nicknames.push(viewer.display_name || viewer.user_name);
  }

  console.log(nicknames);
  return arrayHelper.removeBotsFromList(nicknames);
}

module.exports = getChannelViewers;
