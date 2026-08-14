'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getRuntimeSettings } = require('./adminSettings.service');

function applicationPath() {
  return global.APP_PATH || path.resolve(__dirname, '../..');
}

/**
 * Read a legacy token file. These files are intentionally kept as a fallback
 * so existing installations do not have to migrate secrets immediately.
 *
 * @param {string} fileName
 * @returns {string}
 */
function readStorageToken(fileName) {
  const filePath = path.join(applicationPath(), 'storage', fileName);

  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[Tokens] Error reading ${fileName}:`, error.code || error.message);
    }
    return '';
  }
}

async function getBoostyToken() {
  const settings = await loadAdminSettings();
  return String(settings.boostyToken || '').trim() || readStorageToken('boosty-token');
}

async function getTwitchAccessToken() {
  const settings = await loadAdminSettings();
  return String(settings.twitchToken || '').trim()
    || String(config.TWITCH_ACCESS_TOKEN || '').trim()
    || readStorageToken('twitch-token');
}

async function loadAdminSettings() {
  try {
    return await getRuntimeSettings();
  } catch (error) {
    console.error('[Tokens] Could not read admin token settings:', error.message);
    return {};
  }
}

module.exports = {
  getBoostyToken,
  getTwitchAccessToken,
  readStorageToken,
};
