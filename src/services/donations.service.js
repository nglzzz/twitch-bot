const axios = require('axios');
const io = require('socket.io-client');
const config = require('../config');
const { isDbReady } = require('../app/db');
const donationRepo = require('../repositories/donation.repo');
const { getActiveSession } = require('./streamTracker.service');
const { getRuntimeSettings } = require('./adminSettings.service');

let socket = null;
let activeToken = null;

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
      provider: donation.source === 'donationalerts'
        ? 'donationalerts'
        : (donation.source === 'usdt-trc20' ? 'USDT TRC20' : 'Schedule'),
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
  if (!isDbReady()) throw new Error('Database is unavailable');
  const existing = data.externalId ? donationRepo.findOneByExternalId(source, String(data.externalId)) : null;
  if (existing?.status === 'sent') return existing;
  const activeSession = await getActiveSession();

  const donationData = {
    source,
    // Реальные донаты приходят не только из DonationAlerts (например, USDT TRC20).
    isTest: !['donationalerts', 'usdt-trc20'].includes(source),
    externalId: data.externalId ? String(data.externalId) : null,
    donorId: data.donorId || '',
    donorName: String(data.donorName || 'Anonymous').trim().slice(0, 100),
    amount: normaliseAmount(data.amount),
    currency: String(data.currency || 'RUB').toUpperCase().slice(0, 8),
    message: String(data.message || '').slice(0, 255),
    raw: data.raw || null,
    streamSessionId: activeSession?._id || null,
  };

  let donation;
  if (existing) {
    donation = donationRepo.update(existing._id, { ...donationData, status: 'pending', error: null });
  } else {
    donation = donationRepo.create({ ...donationData, status: 'pending', error: null });
  }

  try {
    const response = await sendTipToStreamElements(donation);
    donation = donationRepo.update(donation._id, {
      status: 'sent',
      error: null,
      streamElementsActivityId: response?._id || response?.id || null,
    });
    return donation;
  } catch (error) {
    donationRepo.update(donation._id, {
      status: 'failed',
      error: formatRemoteError(error),
    });
    throw error;
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
  connectDonationAlerts,
  disconnectDonationAlerts,
  refreshDonationAlertsConnection,
};
