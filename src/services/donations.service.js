const axios = require('axios');
const io = require('socket.io-client');
const config = require('../config');
const db = require('../app/db');
const Donation = require('../models/donation.model');
const { getActiveSession } = require('./streamTracker.service');
const { getRuntimeSettings } = require('./adminSettings.service');

let socket = null;
let activeToken = null;

function isDbReady() {
  return db?.connection?.readyState === 1;
}

function normaliseAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Donation amount must be a positive number');
  return Math.round(amount * 100) / 100;
}

function prepareDonationAlert(payload) {
  const response = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (Number(response.alert_type) !== 1) return null;
  let additionalData = {};
  try { additionalData = JSON.parse(response.additional_data || '{}'); } catch (_) { additionalData = {}; }
  let amount = response.amount;
  let currency = response.currency || 'RUB';
  if (currency !== 'RUB' && response.amount_main !== undefined) {
    amount = response.amount_main;
    currency = 'RUB';
  }
  let donorName = response.username || 'Anonymous';
  if (additionalData.is_commission_covered) donorName = `❤️ ${donorName}`;
  const message = response.message_type && response.message_type !== 'text'
    ? '(аудио сообщение)'
    : String(response.message || '');
  return {
    externalId: response.id ? String(response.id) : null,
    donorId: String(response.id || ''),
    donorName,
    amount: normaliseAmount(amount),
    currency,
    message: message.slice(0, 255),
    raw: response,
  };
}

async function sendTipToStreamElements(donation, runtimeSettings) {
  const settings = runtimeSettings || await getRuntimeSettings();
  const channelId = settings.streamElementsChannelId || getChannelIdFromToken(settings.streamElementsToken);
  if (!settings.streamElementsToken || !channelId) {
    throw new Error('StreamElements token is not configured or its channel ID could not be detected');
  }
  const response = await axios.post(
    `https://api.streamelements.com/kappa/v2/tips/${encodeURIComponent(channelId)}`,
    {
      user: {
        userId: donation.donorId || donation.externalId || String(donation._id),
        username: String(donation.donorName).slice(0, 25),
        email: 'scheduled.donation@test.com',
      },
      provider: donation.source === 'donationalerts' ? 'donationalerts' : 'Schedule',
      message: donation.message,
      amount: donation.amount,
      currency: donation.currency,
      imported: true,
    },
    {
      headers: {
        Authorization: `Bearer ${settings.streamElementsToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
  return response.data;
}

async function createAndSendDonation(data, source) {
  if (!isDbReady()) throw new Error('MongoDB is unavailable');
  const existing = data.externalId ? await Donation.findOne({ source, externalId: data.externalId }) : null;
  if (existing?.status === 'sent') return existing;
  const activeSession = await getActiveSession();
  const donation = existing || new Donation({
    source,
    isTest: source !== 'donationalerts',
    ...(data.externalId ? { externalId: String(data.externalId) } : {}),
    donorId: data.donorId || '',
    donorName: String(data.donorName || 'Anonymous').trim().slice(0, 100),
    amount: normaliseAmount(data.amount),
    currency: String(data.currency || 'RUB').toUpperCase().slice(0, 8),
    message: String(data.message || '').slice(0, 255),
    raw: data.raw || null,
    streamSessionId: activeSession?._id || null,
  });
  donation.status = 'pending';
  donation.error = null;
  await donation.save();
  try {
    const response = await sendTipToStreamElements(donation);
    donation.status = 'sent';
    donation.streamElementsActivityId = response?._id || response?.id || null;
    await donation.save();
    return donation;
  } catch (error) {
    donation.status = 'failed';
    donation.error = formatRemoteError(error);
    await donation.save();
    throw error;
  }
}

async function ensureDonationIndexes() {
  if (!isDbReady()) return;
  const indexesCursor = await Donation.collection.listIndexes();
  const indexes = await indexesCursor.toArray();
  const legacyIndex = indexes.find((index) => index.name === 'source_1_externalId_1');
  if (legacyIndex) {
    await Donation.collection.dropIndex(legacyIndex.name);
    console.log('[Donations] Removed legacy nullable externalId index');
  }
  const currentIndex = indexes.find((index) => index.name === 'source_externalId_unique');
  if (!currentIndex) {
    await Donation.collection.createIndex(
      { source: 1, externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $type: 'string' } }, name: 'source_externalId_unique' }
    );
  }
}

function getChannelIdFromToken(token) {
  try {
    const payload = String(token || '').split('.')[1];
    if (!payload) return '';
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return String(decoded.channel || decoded.channelId || '');
  } catch (_) {
    return '';
  }
}

function formatRemoteError(error) {
  const responseData = error.response?.data;
  if (typeof responseData === 'string' && responseData.trim()) return `HTTP ${error.response.status}: ${responseData.slice(0, 500)}`;
  if (responseData && typeof responseData === 'object') {
    const message = responseData.message || responseData.error || responseData.detail;
    if (message) return `HTTP ${error.response.status}: ${message}`;
  }
  return error.message;
}

async function requestDonationAlertsAction(action, alertId) {
  const settings = await getRuntimeSettings();
  if (!settings.donationAlertsApiKey || !alertId) return;
  await axios.get(`https://www.donationalerts.com/api/${action}`, {
    params: { alert: alertId, alert_type: 1, token: settings.donationAlertsApiKey },
    timeout: 10000,
  });
}

async function handleDonationAlertsPayload(payload) {
  let donation;
  try {
    donation = prepareDonationAlert(payload);
  } catch (error) {
    console.warn('[DonationAlerts] Ignored invalid donation payload:', error.message);
    return;
  }
  if (!donation) return;
  try {
    await createAndSendDonation(donation, 'donationalerts');
    await requestDonationAlertsAction('skipalert', donation.externalId);
    console.log(`[DonationAlerts] Imported donation ${donation.externalId || 'without id'}`);
  } catch (error) {
    console.error('[DonationAlerts] Import failed:', error.message);
    try { await requestDonationAlertsAction('repeatalert', donation.externalId); } catch (repeatError) {
      console.error('[DonationAlerts] Could not repeat alert:', repeatError.message);
    }
  }
}

async function connectDonationAlerts() {
  const settings = await getRuntimeSettings();
  const token = settings.donationAlertsApiKey;
  if (!token || !isDbReady()) {
    disconnectDonationAlerts();
    return false;
  }
  if (socket && activeToken === token) return true;
  disconnectDonationAlerts();
  activeToken = token;
  socket = io(config.DONATIONALERTS_SOCKET_URL || 'https://socket10.donationalerts.com', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    timeout: 15000,
  });
  socket.on('connect', () => {
    socket.emit('add-user', { token, type: 'minor' });
    console.log('[DonationAlerts] WebSocket connected');
  });
  socket.on('donation', handleDonationAlertsPayload);
  socket.on('connect_error', (error) => console.warn('[DonationAlerts] WebSocket connection error:', error.message));
  socket.on('disconnect', (reason) => console.warn('[DonationAlerts] WebSocket disconnected:', reason));
  return true;
}

function disconnectDonationAlerts() {
  if (socket) socket.close();
  socket = null;
  activeToken = null;
}

async function refreshDonationAlertsConnection() {
  try { await connectDonationAlerts(); } catch (error) { console.error('[DonationAlerts] Connection refresh failed:', error.message); }
}

module.exports = {
  createAndSendDonation,
  ensureDonationIndexes,
  connectDonationAlerts,
  disconnectDonationAlerts,
  refreshDonationAlertsConnection,
};
