'use strict';

// Донаты разных сервисов → один вид. В media — «родная» озвучка сервиса и голосовые, по порядку.

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

const isUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

function absolute(path, base) {
  if (!path || typeof path !== 'string') return null;
  if (isUrl(path)) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** DonationAlerts (socket.io, событие donation). Сумма — в рублях, как раньше уходила в StreamElements. */
function fromDonationAlerts(payload, { ttsMinRub = 0 } = {}) {
  const r = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!r || Number(r.alert_type) !== 1) return null;
  let extra = {};
  try { extra = typeof r.additional_data === 'string' ? JSON.parse(r.additional_data || '{}') : (r.additional_data || {}); } catch (_) { extra = {}; }
  const inRub = r.currency !== 'RUB' && r.amount_main !== undefined && r.amount_main !== null;
  const amount = toAmount(inRub ? r.amount_main : r.amount);
  if (!amount) return null;
  let name = cleanText(r.username, 100) || 'Аноним';
  if (extra.is_commission_covered) name = `❤️ ${name}`;
  const isAudio = r.message_type && r.message_type !== 'text';
  const media = [];
  if (isAudio && isUrl(r.message)) media.push({ kind: 'voice', url: r.message });
  else if (cleanText(r.message) && amount >= ttsMinRub) {
    // У тестовых алертов DA своей озвучки нет — читаем голосом из настроек алерта SE.
    media.push(isUrl(r.tts_url) ? { kind: 'tts', url: r.tts_url } : { kind: 'se-tts' });
  }
  return {
    source: 'donationalerts',
    externalId: r.id ? String(r.id) : null,
    name,
    amount,
    currency: inRub ? 'RUB' : String(r.currency || 'RUB').toUpperCase(),
    message: isAudio ? '' : cleanText(r.message),
    dbMessage: isAudio ? '(аудио сообщение)' : cleanText(r.message, 255),
    isTest: r._is_test_alert === true,
    media,
    raw: r,
  };
}

/** StreamElements (astro, тема channel.activities). Озвучку собирает хаб по настройкам алерта SE. */
function fromStreamElements(activity) {
  const a = activity?.data && activity.type === undefined ? activity.data : activity;
  if (!a || a.type !== 'tip') return null;
  const d = a.data || {};
  const amount = toAmount(d.amount);
  if (!amount) return null;
  return {
    source: 'streamelements',
    externalId: String(d.tipId || a._id || a.activityId || ''),
    name: cleanText(d.username || d.displayName, 100) || 'Аноним',
    amount,
    currency: String(d.currency || 'RUB').toUpperCase(),
    message: cleanText(d.message),
    isTest: Boolean(a.isMock || d.isMock),
    media: [{ kind: 'se-tts' }],
    raw: a,
  };
}

/** Какой виджет DonatePay сработал бы на эту сумму: активный, с подходящим порогом, самый «дорогой». */
function pickDonatePayWidget(widgets, sum) {
  let best = null;
  for (const [key, w] of Object.entries(widgets || {})) {
    if (String(w['a_m.active']) === '0') continue;
    const min = Number(w['a_m.min_sum'] || 0);
    const fixed = String(w['a_m.fixed-sum']) === '1';
    if (fixed ? sum !== min : sum < min) continue;
    if (!best || min > best.min) best = { id: key.replace(/^#/, ''), widget: w, min };
  }
  return best;
}

/**
 * DonatePay (centrifugo, канал notifications#<id>): { notification: { type, id, vars: "<json>" } }.
 * Озвучку отдаёт их сервер по ссылке, как в их виджете: голос выбирается по widget_id,
 * премиум-голос — из настроек доната. Тест из их кабинета приходит без id.
 */
function fromDonatePay(publication, ctx = {}) {
  const data = publication?.data && !publication.notification ? publication.data : publication;
  const n = data?.notification;
  if (!n || n.type !== 'donation' || !n.vars) return null;
  let v = n.vars;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
  const amount = toAmount(v.sum);
  if (!amount) return null;
  const message = cleanText(v.comment);
  // Тест из кабинета DonatePay — всегда 1–3 ₽, ниже порога озвучки. Чтобы тестом можно было
  // услышать их голос, тест озвучиваем всегда — первым активным виджетом, если по сумме ни один не подходит.
  const isTest = !n.id;
  const picked = data.widgetId !== undefined
    ? { id: String(data.widgetId), widget: ctx.widgets?.[`#${data.widgetId}`] || null }
    : pickDonatePayWidget(ctx.widgets, amount) || (isTest ? pickDonatePayWidget(ctx.widgets, Infinity) : null);
  const media = [];
  const record = absolute(v.media_record, ctx.base || 'https://widget.donatepay.ru');
  if (record) media.push({ kind: 'voice', url: record });
  else if (ctx.widgetsToken && picked && message && (isTest || amount >= Number(ctx.voiceSum || 0)) && String(picked.widget?.['a_s.play']) !== '0') {
    const url = new URL(`/donation/notifications/widget/${ctx.widgetsToken}/voice`, ctx.base || 'https://widget.donatepay.ru');
    url.searchParams.append('text', encodeURIComponent(` ${message}`));
    url.searchParams.append('rate', picked.widget?.['a_s.speed'] || 'medium');
    url.searchParams.append('widget_id', picked.id);
    const premium = v.premiumSettings;
    if (ctx.allowPremium && premium && Object.values(premium).length > 0) {
      url.searchParams.append('premium_voice', premium.voice);
      url.searchParams.append('premium_speed', premium.speed);
      url.searchParams.append('premium_emotion', premium.emotion);
    }
    media.push({ kind: 'tts', url: url.toString() });
  }
  return {
    source: 'donatepay',
    externalId: n.id ? String(n.id) : null,
    name: cleanText(v.name, 100) || 'Аноним',
    amount,
    currency: 'RUB',
    message,
    isTest,
    media,
    raw: data,
  };
}

/** Donatex (SignalR, ReceiveDonation / PlaybackGranted). Озвучка — готовый mp3 на их CDN. */
function fromDonatex(donation, { mediaBase = 'https://cdn.donatex.gg' } = {}) {
  const d = donation;
  if (!d || !d.id) return null;
  const amount = toAmount(d.amount);
  if (!amount || d.isRefunded) return null;
  const media = [];
  const voiceMessage = absolute(d.voiceMessagePath, mediaBase);
  const tts = absolute(d.voiceFilePath, mediaBase);
  if (voiceMessage) media.push({ kind: 'voice', url: voiceMessage });
  else if (tts) media.push({ kind: 'tts', url: tts });
  // Ответ ИИ-ассистента Donatex генерирует сам: путь в донате обычно пустой, файл появляется
  // на CDN под id доната (так его ищет их донатный виджет) и может дозреть уже во время алерта.
  const ai = d.withAIResponse ? absolute(d.aiResponseVoiceFilePath || `aiassistant-widgets/sounds/${d.id}.mp3`, mediaBase) : null;
  if (ai) media.push({ kind: 'ai', url: ai, wait: true });
  return {
    source: 'donatex',
    externalId: String(d.id),
    name: cleanText(d.username, 100) || 'Аноним',
    amount,
    currency: String(d.currency || 'RUB').toUpperCase(),
    message: cleanText(d.message),
    // У тестового доната Donatex нет флага — только их неизменный текст.
    isTest: d.username === 'Аноним тест' && d.message === 'Это тестовый донат!',
    media,
    video: absolute(d.videoMessagePath, mediaBase),
    raw: d,
  };
}

module.exports = { fromDonationAlerts, fromStreamElements, fromDonatePay, fromDonatex, cleanText };
