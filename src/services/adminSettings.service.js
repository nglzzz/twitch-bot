const crypto = require('crypto');
const config = require('../config');
const { isDbReady } = require('../app/db');
const adminSettingsRepo = require('../repositories/adminSettings.repo');

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
  return adminSettingsRepo.getSingleton();
}

async function getRuntimeSettings() {
  const settings = await getSettings();
  if (!settings) return {
    donationAlertsApiKey: '',
    streamElementsToken: '',
    streamElementsChannelId: '',
    boostyToken: '',
    twitchToken: '',
    usdtTrc20WalletAddress: config.USDT_TRC20_WALLET || '',
    memeAlertsChannelId: '',
    memeAlertsTestToken: '',
    memeAlertsTestCsrf: '',
    memeAlertsTestCsrfToken: '',
    memeAlertsTestName: '',
  };
  return {
    donationAlertsApiKey: decrypt(settings.donationAlertsApiKey),
    streamElementsToken: decrypt(settings.streamElementsToken),
    streamElementsChannelId: settings.streamElementsChannelId || '',
    boostyToken: decrypt(settings.boostyToken),
    twitchToken: decrypt(settings.twitchToken),
    usdtTrc20WalletAddress: settings.usdtTrc20WalletAddress || config.USDT_TRC20_WALLET || '',
    memeAlertsChannelId: settings.memeAlertsChannelId || config.MEMEALERTS_CHANNEL_ID || '',
    memeAlertsTestToken: decrypt(settings.memeAlertsTestToken),
    memeAlertsTestCsrf: decrypt(settings.memeAlertsTestCsrf),
    memeAlertsTestCsrfToken: decrypt(settings.memeAlertsTestCsrfToken),
    memeAlertsTestName: settings.memeAlertsTestName || '',
  };
}

async function updateSettings(input) {
  if (!isDbReady()) throw new Error('Database is unavailable');
  const current = await getSettings();
  const usdtTrc20WalletAddress = String(input.usdtTrc20WalletAddress || '').trim();
  if (usdtTrc20WalletAddress && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(usdtTrc20WalletAddress)) {
    throw new Error('Некорректный TRON-адрес кошелька USDT TRC20');
  }
  const data = {
    streamElementsChannelId: String(input.streamElementsChannelId || '').trim(),
    usdtTrc20WalletAddress,
    memeAlertsChannelId: String(input.memeAlertsChannelId || '').trim(),
    memeAlertsTestName: String(input.memeAlertsTestName || '').trim().slice(0, 100),
  };
  if (String(input.donationAlertsApiKey || '').trim()) data.donationAlertsApiKey = encrypt(String(input.donationAlertsApiKey).trim());
  if (String(input.streamElementsToken || '').trim()) data.streamElementsToken = encrypt(String(input.streamElementsToken).trim());
  if (String(input.boostyToken || '').trim()) data.boostyToken = encrypt(String(input.boostyToken).trim());
  if (String(input.twitchToken || '').trim()) data.twitchToken = encrypt(String(input.twitchToken).trim());
  if (String(input.memeAlertsTestToken || '').trim()) data.memeAlertsTestToken = encrypt(String(input.memeAlertsTestToken).trim());
  if (String(input.memeAlertsTestCsrf || '').trim()) data.memeAlertsTestCsrf = encrypt(String(input.memeAlertsTestCsrf).trim());
  if (String(input.memeAlertsTestCsrfToken || '').trim()) data.memeAlertsTestCsrfToken = encrypt(String(input.memeAlertsTestCsrfToken).trim());
  if (!current) data.singletonKey = 'primary';
  return adminSettingsRepo.upsert(data);
}

function getSettingsView(settings) {
  return {
    donationAlertsConfigured: Boolean(settings?.donationAlertsApiKey),
    streamElementsConfigured: Boolean(settings?.streamElementsToken),
    streamElementsChannelId: settings?.streamElementsChannelId || '',
    boostyConfigured: Boolean(settings?.boostyToken),
    twitchConfigured: Boolean(settings?.twitchToken),
    usdtTrc20WalletAddress: settings?.usdtTrc20WalletAddress || config.USDT_TRC20_WALLET || '',
    memeAlertsChannelId: settings?.memeAlertsChannelId || config.MEMEALERTS_CHANNEL_ID || '',
    memeAlertsTestConfigured: Boolean(settings?.memeAlertsTestToken),
    memeAlertsTestName: settings?.memeAlertsTestName || '',
    encryptionConfigured: Boolean(encryptionKey()),
  };
}

module.exports = { getSettings, getRuntimeSettings, updateSettings, getSettingsView };
