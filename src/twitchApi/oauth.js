const axios = require('axios');
const config = require('../config');
const oAuthModel = require('../models/oAuthToken.model');
const path = require('path');
const fs = require('fs');

let latestToken;

const getOAuthToken = async (force = false) => {
  if (!force) {
    if (typeof latestToken === oAuthModel) {
      if (latestToken.exceeds.getTime() > Date.now()) {
        return latestToken;
      }
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
  } catch (e) {
    console.log(e);

    const fileData = getTokenFromFile();
    if (fileData) {
      latestToken = new oAuthModel(fileData, Date.now() + (60 * 60 * 24));
      return latestToken;
    }

    return null;
  }

  return latestToken;
}

function getTokenFromFile() {
  const filePath = path.join(APP_PATH, 'storage', 'twitch-token');

  try {
    return fs.readFileSync(filePath, 'utf8').toString();
  } catch (e) {
    console.error(e);
    return null;
  }
}

module.exports = getOAuthToken;
