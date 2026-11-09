'use strict';

// Алерт на донат берём из оверлея StreamElements: базовый вид + вариации по суммам.
// Сам SE-алерт на донаты выключается, показывает их наш источник.

const CURRENCY_SIGNS = { RUB: '₽', USD: '$', EUR: '€', UAH: '₴', KZT: '₸', BYN: 'Br', GBP: '£' };

/** https://streamelements.com/overlay/<id>/<apikey> → { overlayId, apiKey } */
function parseOverlayUrl(value) {
  const match = String(value || '').trim().match(/streamelements\.com\/overlay\/([a-f0-9]{24})\/([A-Za-z0-9_-]{20,})/);
  return match ? { overlayId: match[1], apiKey: match[2] } : null;
}

const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const px = (value, fallback) => num(String(value ?? '').replace(/px$/, ''), fallback);

function normalizeView(settings = {}) {
  const text = settings.text || {};
  const css = text.css || {};
  const msg = css.message || {};
  const graphics = settings.graphics || {};
  const audio = settings.audio || {};
  const tts = settings.tts || {};
  return {
    duration: Math.max(1, num(settings.duration, 8)),
    layout: settings.layout || 'column',
    showMessage: settings.showMessage !== false,
    graphics: graphics.src ? { src: graphics.src, type: graphics.type === 'video' ? 'video' : 'image', volume: num(graphics.volume, 1) } : null,
    audio: audio.src ? { src: audio.src, volume: num(audio.volume, 0.5) } : null,
    tts: {
      enabled: tts.enabled !== false,
      voice: tts.voice || 'Brian',
      volume: num(tts.volume, 0.75),
      minAmount: num(tts.minAmount, 0),
      announce: tts.announceAction !== false,
      // через сколько секунд после начала алерта читать текст
      delay: Math.max(0, num(tts.delay, 0)),
    },
    text: {
      template: text.message || '{name} — {currency}{amount}',
      animation: text.animation || 'none',
      title: {
        fontFamily: css['font-family'] || 'Nunito',
        fontSize: px(css['font-size'], 30),
        fontWeight: css['font-weight'] || 'bold',
        color: css.color || '#ffffff',
        textShadow: css['text-shadow'] || null,
        align: css['text-align'] || 'center',
        marginTop: px(css['margin-top'], 0),
        highlight: css.highlights?.color || '#6a6ffc',
      },
      message: {
        fontFamily: msg['font-family'] || css['font-family'] || 'Nunito',
        fontSize: px(msg['font-size'], 18),
        color: msg.color || '#ffffff',
        textShadow: msg['text-shadow'] || null,
        align: msg['text-align'] || 'center',
      },
    },
  };
}

/** Ответ /overlays/<id>/bootstrap → настройки алерта на донат. */
function extractTipConfig(bootstrap) {
  const widgets = bootstrap?.overlay?.widgets || bootstrap?.widgets || [];
  const box = widgets.find((w) => w.type === 'se-widget-alert-box' && w.listeners?.['tip-latest'] && w.variables?.tip)
    || widgets.find((w) => w.type === 'se-widget-alert-box' && w.variables?.tip);
  if (!box) return null;
  const tip = box.variables.tip;
  return {
    box: { width: px(box.css?.width, 1000), height: px(box.css?.height, 750) },
    randomPick: tip.enableRandomPick !== false,
    base: normalizeView(tip),
    variations: (tip.variations || [])
      // type — вид условия (в SE это «amount»); выключенные вариации SE не показывает
      .filter((v) => v && v.enabled !== false && (!v.type || v.type === 'amount' || v.type === 'tip'))
      .map((v) => ({
        name: String(v.name || ''),
        condition: String(v.condition || '').toUpperCase(),
        requirement: num(v.requirement, 0),
        chance: Math.max(0, num(v.chance, 100)),
        view: normalizeView({ ...tip, ...(v.settings || {}) }),
      })),
  };
}

/**
 * Как выбирает SE: точное совпадение суммы важнее «от N»; из «от N» побеждает самый большой порог;
 * несколько подходящих вариаций — случайная по весу chance.
 */
function pickView(config, amountRub, random = Math.random) {
  if (!config) return { name: '', view: normalizeView({}) };
  const amount = Math.round(Number(amountRub) * 100) / 100;
  const exact = config.variations.filter((v) => v.condition === 'EXACT' && v.requirement === amount);
  let pool = exact;
  if (!pool.length) {
    const atLeast = config.variations.filter((v) => v.condition === 'ATLEAST' && amount >= v.requirement);
    const top = Math.max(-Infinity, ...atLeast.map((v) => v.requirement));
    pool = atLeast.filter((v) => v.requirement === top);
  }
  if (!pool.length) return { name: '', view: config.base };
  if (pool.length === 1 || !config.randomPick) return { name: pool[0].name, view: pool[0].view };
  const total = pool.reduce((sum, v) => sum + (v.chance || 0), 0);
  if (total <= 0) return { name: pool[0].name, view: pool[0].view };
  let roll = random() * total;
  for (const v of pool) {
    roll -= v.chance || 0;
    if (roll < 0) return { name: v.name, view: v.view };
  }
  return { name: pool[pool.length - 1].name, view: pool[pool.length - 1].view };
}

function formatAmount(amount) {
  const n = Math.round(Number(amount) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

/** Шаблон «{name} занёс {currency}{amount}» → куски текста; имя и сумма подсвечиваются. */
function renderTitle(template, { name, amount, currency }) {
  const values = { name, amount: formatAmount(amount), currency: CURRENCY_SIGNS[currency] || `${currency} ` };
  const parts = [];
  const re = /\{(name|amount|currency)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(template))) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index) });
    parts.push({ text: values[m[1]], hl: true });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  // «₽» и «111» стоят рядом — сливаем подсвеченные куски.
  return parts.reduce((out, p) => {
    const prev = out[out.length - 1];
    if (prev && Boolean(prev.hl) === Boolean(p.hl)) prev.text += p.text;
    else out.push({ ...p });
    return out;
  }, []);
}

/** Озвучка SE для донатов, пришедших в SE: заголовок + сообщение тем голосом, что выбран в вариации. */
function seSpeechUrl({ view, titleText, message, apiKey }) {
  const text = [view.tts.announce ? titleText : '', message].filter(Boolean).join(', ').slice(0, 500);
  if (!text) return null;
  const url = new URL('https://api.streamelements.com/kappa/v2/speech');
  url.searchParams.set('voice', view.tts.voice);
  url.searchParams.set('text', text);
  if (apiKey) url.searchParams.set('key', apiKey);
  return url.toString();
}

module.exports = { CURRENCY_SIGNS, parseOverlayUrl, normalizeView, extractTipConfig, pickView, renderTitle, seSpeechUrl, formatAmount };
