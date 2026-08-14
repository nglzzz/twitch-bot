const axios = require('axios');
const config = require('../config');
const oAuthModel = require('../models/oAuthToken.model');
const { getTwitchAccessToken } = require('../services/token.service');

let latestToken;

const getOAuthToken = async (force = false) => {
  const configuredToken = await getTwitchAccessToken();

  if (configuredToken) {
    if (!force && latestToken instanceof oAuthModel && latestToken.token === configuredToken && latestToken.expires.getTime() > Date.now()) {
      return latestToken;
    }

    latestToken = new oAuthModel(configuredToken, 60 * 60 * 24);
    return latestToken;
  }

  if (!force) {
    if (latestToken instanceof oAuthModel && latestToken.expires.getTime() > Date.now()) {
      return latestToken;
    }
  }

  try {
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
  } catch (error) {
    if (error.response) {
      console.error('[OAuth] Error fetching token:', error.response.status, error.response.data || '');
    } else {
      console.error('[OAuth] Error fetching token:', error.code || error.message);
    }

    return null;
  }

  return latestToken;
}

module.exports = getOAuthToken;
