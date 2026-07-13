const crypto = require('crypto');
const config = require('../config');
const db = require('../app/db');
const AdminSettings = require('../models/adminSettings.model');

function isDbReady() {
  return db?.connection?.readyState === 1;
}

function encryptionKey() {
  const secret = config.ADMIN_CREDENTIALS_ENCRYPTION_KEY || config.ADMIN_SESSION_SECRET || '';
  return secret ? crypto.createHash('sha256').update(secret).digest() : null;
}

function encrypt(value) {
  if (!value) return '';
  const key = encryptionKey();
  if (!key) throw new Error('ADMIN_CREDENTIALS_ENCRYPTION_KEY is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64')).join('.');
}

function decrypt(value) {
  if (!value) return '';
  const key = encryptionKey();
  if (!key) throw new Error('ADMIN_CREDENTIALS_ENCRYPTION_KEY is not configured');
  const [iv, tag, encrypted] = String(value).split('.').map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !encrypted) throw new Error('Stored credential has invalid format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function getSettings() {
  if (!isDbReady()) return null;
  return AdminSettings.findOne({ singletonKey: 'primary' }).lean();
}

async function getRuntimeSettings() {
  const settings = await getSettings();
  if (!settings) return { donationAlertsApiKey: '', streamElementsToken: '', streamElementsChannelId: '', memeAlertsChannelId: '', memeAlertsTestToken: '', memeAlertsTestCsrf: '', memeAlertsTestCsrfToken: '', memeAlertsTestName: '' };
  return {
    donationAlertsApiKey: decrypt(settings.donationAlertsApiKey),
    streamElementsToken: decrypt(settings.streamElementsToken),
    streamElementsChannelId: settings.streamElementsChannelId || '',
    memeAlertsChannelId: settings.memeAlertsChannelId || config.MEMEALERTS_CHANNEL_ID || '',
    memeAlertsTestToken: decrypt(settings.memeAlertsTestToken),
    memeAlertsTestCsrf: decrypt(settings.memeAlertsTestCsrf),
    memeAlertsTestCsrfToken: decrypt(settings.memeAlertsTestCsrfToken),
    memeAlertsTestName: settings.memeAlertsTestName || '',
  };
}

async function updateSettings(input) {
  if (!isDbReady()) throw new Error('MongoDB is unavailable');
  const current = await getSettings();
  const data = {
    streamElementsChannelId: String(input.streamElementsChannelId || '').trim(),
    memeAlertsChannelId: String(input.memeAlertsChannelId || '').trim(),
    memeAlertsTestName: String(input.memeAlertsTestName || '').trim().slice(0, 100),
  };
  if (String(input.donationAlertsApiKey || '').trim()) data.donationAlertsApiKey = encrypt(String(input.donationAlertsApiKey).trim());
  if (String(input.streamElementsToken || '').trim()) data.streamElementsToken = encrypt(String(input.streamElementsToken).trim());
  if (String(input.memeAlertsTestToken || '').trim()) data.memeAlertsTestToken = encrypt(String(input.memeAlertsTestToken).trim());
  if (String(input.memeAlertsTestCsrf || '').trim()) data.memeAlertsTestCsrf = encrypt(String(input.memeAlertsTestCsrf).trim());
  if (String(input.memeAlertsTestCsrfToken || '').trim()) data.memeAlertsTestCsrfToken = encrypt(String(input.memeAlertsTestCsrfToken).trim());
  if (!current) data.singletonKey = 'primary';
  return AdminSettings.findOneAndUpdate({ singletonKey: 'primary' }, { $set: data }, { new: true, upsert: true }).lean();
}

function getSettingsView(settings) {
  return {
    donationAlertsConfigured: Boolean(settings?.donationAlertsApiKey),
    streamElementsConfigured: Boolean(settings?.streamElementsToken),
    streamElementsChannelId: settings?.streamElementsChannelId || '',
    memeAlertsChannelId: settings?.memeAlertsChannelId || config.MEMEALERTS_CHANNEL_ID || '',
    memeAlertsTestConfigured: Boolean(settings?.memeAlertsTestToken),
    memeAlertsTestName: settings?.memeAlertsTestName || '',
    encryptionConfigured: Boolean(encryptionKey()),
  };
}

module.exports = { getSettings, getRuntimeSettings, updateSettings, getSettingsView };
