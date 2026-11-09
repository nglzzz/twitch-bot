'use strict';

// Единые алерты донатов: бот слушает все сервисы, складывает донаты в одну очередь
// и отдаёт их источнику obs/alerts. Вид алерта — из настроек StreamElements, озвучка — родная у каждого сервиса.
const axios = require('axios');
const repo = require('../../repositories/alerts.repo');
const { encrypt, decrypt } = require('../adminSettings.service');
const { getRubRates } = require('../exchangeRates.service');
const { createAlertSettingsStore, SERVICES, SERVICE_LABELS } = require('./alertSettings.service');
const { createAlertHub } = require('./alertHub');
const { extractTipConfig, parseOverlayUrl } = require('./seAlertConfig');
const { createStreamElementsConnector } = require('./connectors/streamElements');
const { createDonatePayConnector } = require('./connectors/donatePay');
const { createDonatexConnector } = require('./connectors/donatex');
const { embedMedia } = require('./embed');

const TIP_CONFIG_KEY = 'seTipConfig';
const TIP_CONFIG_REFRESH_MS = 5 * 60 * 1000;

let instance = null;

function createAlerts() {
  const store = createAlertSettingsStore({ repo, encrypt, decrypt });
  const donations = () => require('../donations.service'); // ленивый require: модули ссылаются друг на друга

  let tip = { config: null, loadedAt: null, error: null };
  try {
    const saved = repo.getSettingsValue(TIP_CONFIG_KEY);
    if (saved?.config) tip = { config: saved.config, loadedAt: saved.loadedAt || null, error: null };
  } catch (_) { /* БД ещё не готова */ }

  let rates = null;
  const refreshRates = () => getRubRates().then((r) => { if (r?.rates) rates = r.rates; }).catch(() => {});
  function toRub(amount, currency) {
    if (currency === 'RUB') return amount;
    const rate = rates?.[currency];
    return rate ? Math.round(amount * rate * 100) / 100 : null;
  }

  const seOverlay = () => parseOverlayUrl(store.secret('streamElementsOverlayUrl'));

  // Алерт начался — сцены «Двора» празднуют вместе с ним (жители сбегаются, салют).
  const celebrate = (item) => require('../../app/websocket').broadcast({
    type: 'donation:celebrate',
    name: item.name,
    amount: item.amount,
    currency: item.currency,
    power: item.power,
    source: item.source,
  });

  const hub = createAlertHub({
    onPlay: celebrate,
    getTipConfig: () => tip.config,
    getSeApiKey: () => seOverlay()?.apiKey || '',
    toRub,
    isServiceEnabled: (id) => !SERVICES.includes(id) || store.get().services[id]?.enabled !== false,
  });

  /** Донат с любого сервиса: в базу (топы, итоги, заказ музыки/видео) и в очередь алертов. */
  function handleDonation(donation) {
    if (!donation || !store.get().enabled) return Promise.resolve(null);
    if (!donation.isTest && !donation.saved) {
      donations().recordHubDonation(donation).catch((error) => console.error(`[Alerts] Could not save ${donation.source} donation:`, error.message));
    }
    hub.expect(donation);
    // Звук DA/DonatePay сначала скачиваем — см. embed.js. Порядок очереди не страдает: скачивание быстрое.
    return embedMedia(donation).then((ready) => {
      const item = hub.ingest(ready);
      if (item) console.log(`[Alerts] ${donation.source}: ${donation.name} ${donation.amount} ${donation.currency}${item.variation ? ` → ${item.variation}` : ''}`);
      return item;
    }).catch((error) => { console.error('[Alerts] Could not queue donation:', error.message); return null; });
  }

  const log = console;
  const connectors = {
    streamelements: createStreamElementsConnector({ getOverlay: seOverlay, onDonation: handleDonation, log }),
    donatepay: createDonatePayConnector({ getToken: () => store.secret('donatePayToken'), getApiKey: () => store.secret('donatePayApiKey'), onDonation: handleDonation, log }),
    donatex: createDonatexConnector({ getWidgetId: () => store.secret('donatexWidgetId'), onDonation: handleDonation, log }),
  };
  const configured = {
    donationalerts: () => true,
    streamelements: () => Boolean(seOverlay()),
    donatepay: () => Boolean(store.secret('donatePayToken')),
    donatex: () => Boolean(store.secret('donatexWidgetId')),
  };

  async function refreshTipConfig() {
    const overlay = seOverlay();
    if (!overlay) { tip = { ...tip, error: 'не указана ссылка на оверлей StreamElements' }; return tip; }
    try {
      const res = await axios.get(`https://api.streamelements.com/kappa/v2/overlays/${overlay.overlayId}/bootstrap`, {
        headers: { Authorization: `apikey ${overlay.apiKey}` },
        timeout: 15000,
      });
      const config = extractTipConfig(res.data);
      if (!config) throw new Error('в оверлее SE нет алерта на донаты');
      tip = { config, loadedAt: Date.now(), error: null };
      try { repo.saveSettingsValue({ config, loadedAt: tip.loadedAt }, TIP_CONFIG_KEY); } catch (_) { /* останется в памяти */ }
    } catch (error) {
      tip = { ...tip, error: error.response ? `HTTP ${error.response.status}` : error.message };
      console.warn('[Alerts] StreamElements alert settings:', tip.error);
    }
    return tip;
  }

  /** Запускает и гасит подключения по настройкам. Вызывается при старте, раз в минуту и после правок. */
  function sync() {
    const settings = store.get();
    for (const [id, connector] of Object.entries(connectors)) {
      const shouldRun = settings.enabled && settings.services[id]?.enabled !== false && configured[id]();
      if (shouldRun && !connector.running) connector.start();
      if (!shouldRun && connector.running) connector.stop();
    }
  }

  let timers = [];
  function start() {
    if (timers.length) return;
    refreshRates();
    refreshTipConfig();
    sync();
    timers = [
      setInterval(sync, 60 * 1000),
      setInterval(refreshTipConfig, TIP_CONFIG_REFRESH_MS),
      setInterval(refreshRates, 60 * 60 * 1000),
    ];
  }

  function serviceStatus(id) {
    const settings = store.get();
    if (!settings.enabled) return { state: 'off', error: null };
    if (settings.services[id]?.enabled === false) return { state: 'disabled', error: null };
    if (!configured[id]()) return { state: 'error', error: 'нет ключа виджета' };
    if (id === 'donationalerts') return donations().getDonationAlertsStatus();
    return connectors[id].status();
  }

  function state() {
    const settings = store.get();
    return {
      enabled: settings.enabled,
      services: SERVICES.map((id) => ({
        id,
        label: SERVICE_LABELS[id],
        enabled: settings.services[id]?.enabled !== false,
        configured: configured[id](),
        ...serviceStatus(id),
      })),
      seConfig: {
        loadedAt: tip.loadedAt,
        error: tip.error,
        variations: tip.config?.variations?.length ?? 0,
      },
      ...hub.state(),
    };
  }

  function restartService(id) {
    if (id === 'donationalerts') return donations().restartDonationAlerts();
    if (id === 'streamelements') refreshTipConfig();
    if (connectors[id]?.running) connectors[id].restart();
    else sync();
    return true;
  }

  function test({ amount = 100, source = 'donationalerts', message = 'Это тестовый алерт' } = {}) {
    const value = Math.max(1, Math.min(1000000, Number(amount) || 100));
    return hub.ingest({
      source: SERVICES.includes(source) ? source : 'donationalerts',
      externalId: null,
      name: 'Тест',
      amount: value,
      currency: 'RUB',
      message: String(message).slice(0, 200),
      isTest: true,
      media: [{ kind: 'se-tts' }],
    });
  }

  /** Команды дока. */
  function control(action, value = {}) {
    switch (action) {
      case 'pause': hub.setPaused(true); return true;
      case 'resume': hub.setPaused(false); return true;
      case 'skip': return hub.skip();
      case 'replay': return Boolean(hub.replay(value.id));
      case 'remove': return hub.remove(String(value.id || ''));
      case 'test': return Boolean(test(value));
      case 'toggle': {
        const id = String(value.service || '');
        store.setServiceEnabled(id, Boolean(value.enabled));
        sync();
        return true;
      }
      case 'restart': return restartService(String(value.service || ''));
      case 'reload-config': refreshTipConfig(); return true;
      default: throw new Error(`Неизвестная команда: ${action}`);
    }
  }

  return {
    store,
    hub,
    start,
    sync,
    state,
    control,
    handleDonation,
    refreshTipConfig,
    isEnabled: () => store.get().enabled,
    daTtsMinRub: () => store.get().daTtsMinRub,
  };
}

function getAlerts() {
  if (!instance) instance = createAlerts();
  return instance;
}

module.exports = { getAlerts };
