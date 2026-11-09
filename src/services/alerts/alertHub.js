'use strict';

// Очередь алертов. Бот решает, что и когда показать; источник в OBS только проигрывает
// алерт и сообщает, что закончил. Так док может пропускать, ставить на паузу и повторять.
const crypto = require('crypto');
const { pickView, renderTitle, seSpeechUrl } = require('./seAlertConfig');

const DEDUPE_MS = 6 * 60 * 60 * 1000;
// DA шлёт одно событие по нескольку раз за секунды; «Повторить» в истории DA — это осознанный повтор.
const DEDUPE_MS_BY_SOURCE = { donationalerts: 45 * 1000 };
const CROSS_DEDUPE_MS = 3 * 60 * 1000;
const MAX_ALERT_MS = 4 * 60 * 1000;
const HISTORY = 30;

const normName = (name) => String(name || '').replace(/^❤️\s*/, '').trim().toLowerCase();
const ANONYMOUS = new Set(['', 'аноним', 'anonymous', 'anon', 'аноним тест']);
const normText = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Тот же донат, пересланный в SE: та же сумма и то же имя; у аноников и разных имён — тот же текст. */
function sameDonation(a, b) {
  if (Math.abs(a.amount - b.amount) >= 0.01) return false;
  const na = normName(a.name); const nb = normName(b.name);
  if (na === nb) return true;
  const sameText = normText(a.message) === normText(b.message);
  if (ANONYMOUS.has(na) || ANONYMOUS.has(nb)) return sameText; // аноним: узнаём по тексту
  return sameText && normText(a.message) !== '';
}

function createAlertHub({ getTipConfig, getSeApiKey = () => '', toRub = (amount, currency) => (currency === 'RUB' ? amount : null), isServiceEnabled = () => true, now = Date.now, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const overlays = new Set();
  const queue = [];
  const history = [];
  const seen = new Map();
  let current = null;
  let paused = false;
  let timer = null;
  const listeners = new Set();

  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (_) { /* док не должен ронять очередь */ } });

  function sendAll(message) {
    const raw = JSON.stringify(message);
    for (const ws of overlays) {
      try { if (ws.readyState === 1) ws.send(raw); } catch (_) { /* закрытое соединение уберёт close */ }
    }
  }

  function forget() {
    const t = now();
    for (const [key, at] of seen) if (t - at > DEDUPE_MS) seen.delete(key);
  }

  // Донаты, которые ещё готовятся (бот качает их звук), — чтобы узнать их копии из SE.
  const expected = [];
  function expect(donation) {
    if (!donation || donation.source === 'streamelements') return;
    const t = now();
    while (expected.length && t - expected[0].receivedAt > CROSS_DEDUPE_MS) expected.shift();
    expected.push({ source: donation.source, name: donation.name, amount: donation.amount, message: donation.message, receivedAt: t });
  }

  /** SE пересылает донаты, которые к нему импортировали (старый импорт из DA) — такие пропускаем. */
  function isEchoOfOtherService(item) {
    if (item.source !== 'streamelements') return false;
    const t = now();
    const recent = [...expected, ...history, ...queue, ...(current ? [current.item] : [])];
    return recent.some((other) => other.source !== 'streamelements' && t - other.receivedAt < CROSS_DEDUPE_MS && sameDonation(other, item));
  }

  function build(donation) {
    const amountRub = toRub(donation.amount, donation.currency);
    const config = getTipConfig();
    const { name: variation, view } = pickView(config, amountRub ?? donation.amount, random);
    const title = renderTitle(view.text.template, donation);
    const titleText = title.map((p) => p.text).join('');
    const seVoice = () => (view.tts.enabled
      ? seSpeechUrl({ view, titleText, message: view.showMessage ? donation.message : '', apiKey: getSeApiKey() })
      : null);
    const media = [];
    const source = donation.media || [];
    for (const m of source) {
      if (m.broken) continue;
      if (m.kind !== 'se-tts') { media.push(m); continue; }
      if ((amountRub ?? donation.amount) < view.tts.minAmount) continue;
      const url = seVoice();
      if (url) media.push({ kind: 'tts', url });
    }
    // Родная озвучка сервиса пропала (файл удалён) — читаем голосом из настроек алерта SE.
    if (!media.length && source.some((m) => m.broken)) {
      const url = seVoice();
      if (url) media.push({ kind: 'tts', url, fallback: true });
    }
    // Запасной голос для источника: если родной звук не загрузится и в OBS.
    const fallback = media.length && media.every((m) => !m.fallback && !String(m.url).includes('api.streamelements.com')) ? seVoice() : null;
    return {
      id: crypto.randomUUID(),
      source: donation.source,
      externalId: donation.externalId || null,
      name: donation.name,
      amount: donation.amount,
      currency: donation.currency,
      amountRub,
      message: donation.message || '',
      isTest: Boolean(donation.isTest),
      variation,
      view,
      title,
      media,
      ttsVolume: view.tts.volume,
      fallback,
      video: donation.video || null,
      receivedAt: now(),
    };
  }

  /** Новый донат. Возвращает алерт или null (выключено, повтор, эхо). */
  function ingest(donation, { front = false } = {}) {
    if (!donation) return null;
    forget();
    if (donation.externalId) {
      const key = `${donation.source}:${donation.externalId}`;
      const window = DEDUPE_MS_BY_SOURCE[donation.source] ?? DEDUPE_MS;
      if (seen.has(key) && now() - seen.get(key) < window) return null;
      seen.set(key, now());
    }
    if (!isServiceEnabled(donation.source)) return null;
    const item = build(donation);
    if (isEchoOfOtherService(item)) return null;
    if (front) queue.unshift(item); else queue.push(item);
    pump();
    notify();
    return item;
  }

  function overlayPayload(item) {
    const { receivedAt, externalId, ...rest } = item;
    return rest;
  }

  function pump() {
    if (paused || current || !queue.length || !overlays.size) return;
    const item = queue.shift();
    current = { item, startedAt: now() };
    sendAll({ type: 'alerts:play', alert: overlayPayload(item) });
    timer = setTimer(() => finish(item.id, 'timeout'), MAX_ALERT_MS);
    notify();
  }

  function finish(id, reason = 'done') {
    if (!current || current.item.id !== id) return false;
    if (timer) clearTimer(timer);
    timer = null;
    history.unshift({ ...current.item, finishedAt: now(), reason });
    history.length = Math.min(history.length, HISTORY);
    current = null;
    pump();
    notify();
    return true;
  }

  function skip() {
    if (!current) return false;
    sendAll({ type: 'alerts:stop', id: current.item.id });
    return finish(current.item.id, 'skipped');
  }

  function replay(id) {
    const past = id ? history.find((h) => h.id === id) : history[0];
    if (!past) return null;
    const { finishedAt, reason, ...item } = past;
    const copy = { ...item, id: crypto.randomUUID(), receivedAt: now(), replay: true };
    queue.unshift(copy);
    pump();
    notify();
    return copy;
  }

  function remove(id) {
    const i = queue.findIndex((q) => q.id === id);
    if (i < 0) return false;
    queue.splice(i, 1);
    notify();
    return true;
  }

  function setPaused(value) {
    paused = Boolean(value);
    sendAll({ type: 'alerts:paused', paused });
    if (!paused) pump();
    notify();
  }

  /** Видео и звуки всех вариаций — источник скачает их заранее, чтобы алерт не ждал загрузки. */
  function preloadList() {
    const config = getTipConfig();
    if (!config) return [];
    const urls = new Set();
    for (const view of [config.base, ...config.variations.map((v) => v.view)]) {
      if (view.graphics?.src) urls.add(view.graphics.src);
      if (view.audio?.src) urls.add(view.audio.src);
    }
    return [...urls];
  }

  function attachOverlay(ws) {
    overlays.add(ws);
    ws.send(JSON.stringify({ type: 'alerts:paused', paused }));
    ws.send(JSON.stringify({ type: 'alerts:preload', urls: preloadList() }));
    // Источник перезагрузили посреди алерта — показываем его заново.
    if (current) ws.send(JSON.stringify({ type: 'alerts:play', alert: overlayPayload(current.item) }));
    pump();
    notify();
  }

  function detachOverlay(ws) {
    if (!overlays.delete(ws)) return;
    // Последний источник закрылся — текущий алерт вернётся в очередь, а не пропадёт.
    if (!overlays.size && current) {
      if (timer) clearTimer(timer);
      timer = null;
      queue.unshift(current.item);
      current = null;
    }
    notify();
  }

  function brief(item) {
    return {
      id: item.id,
      source: item.source,
      name: item.name,
      amount: item.amount,
      currency: item.currency,
      message: item.message,
      variation: item.variation,
      voice: item.media.map((m) => m.kind),
      isTest: item.isTest,
      replay: Boolean(item.replay),
      receivedAt: item.receivedAt,
      finishedAt: item.finishedAt,
      reason: item.reason,
    };
  }

  function state() {
    return {
      paused,
      overlays: overlays.size,
      current: current ? { ...brief(current.item), startedAt: current.startedAt } : null,
      queue: queue.map(brief),
      history: history.map(brief),
    };
  }

  return {
    ingest,
    expect,
    finish,
    skip,
    replay,
    remove,
    setPaused,
    attachOverlay,
    detachOverlay,
    state,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    get isPaused() { return paused; },
  };
}

module.exports = { createAlertHub };
