const axios = require('axios');
const config = require('../config');
const oAuthModel = require('../models/oAuthToken.model');

let latestToken;

const getOAuthToken = async (force = false) => {
  if (!force) {
    if (typeof latestToken === oAuthModel) {
      if (latestToken.exceeds.getTime() > Date.now()) {
        return latestToken;
      }
    }
  }

  const response = await axios({
    method: 'post',
    url: 'https://id.twitch.tv/oauth2/token',
    data: {
      client_id: config.TWITCH_API_CLIENT_ID,
      client_secret: config.TWITCH_API_CLIENT_SECRET,
      grant_type: 'client_credentials'
    },
    headers: { 'Content-Type': 'application/json' },
  });
  const responseData = response.data;

  latestToken = new oAuthModel(responseData.access_token, responseData.expires_in);

  return latestToken;
}

module.exports = getOAuthToken;
