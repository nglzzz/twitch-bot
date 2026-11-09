'use strict';

// Звук с серверов, до которых браузер OBS достаёт не всегда (соединение с CDN DonationAlerts и Donatex
// у стримера рвётся, DonatePay отдаёт браузеру не звук), бот скачивает сам и кладёт в алерт как data:-ссылку.
const axios = require('axios');
const { UA } = require('./connectors/base');

const EMBED_HOSTS = ['files.donationalerts.com', 'widget.donatepay.ru', 'cdn.donatex.gg'];
const MAX_BYTES = 8 * 1024 * 1024;

function needsEmbed(url) {
  try { return EMBED_HOSTS.includes(new URL(url).hostname); } catch (_) { return false; }
}

async function embedOne(m, { http = axios, log = console } = {}) {
  if (!m.url || !needsEmbed(m.url)) return m;
  try {
    const res = await http.get(m.url, { headers: { 'User-Agent': UA }, responseType: 'arraybuffer', timeout: 30000, maxContentLength: MAX_BYTES });
    let type = String(res.headers['content-type'] || '').split(';')[0];
    if (!type.startsWith('audio/')) {
      // DA отдаёт WAV как application/octet-stream
      if (/\.wav(\?|$)/i.test(m.url) && Buffer.from(res.data).subarray(0, 4).toString() === 'RIFF') type = 'audio/wav';
      else throw new Error(`ответ ${type || 'без типа'}`);
    }
    return { ...m, url: `data:${type};base64,${Buffer.from(res.data).toString('base64')}` };
  } catch (error) {
    log.warn(`[Alerts] Could not download ${m.kind} from ${new URL(m.url).hostname}:`, error.message);
    return m;
  }
}

async function embedMedia(donation, options) {
  if (!donation?.media?.some((m) => needsEmbed(m.url))) return donation;
  return { ...donation, media: await Promise.all(donation.media.map((m) => embedOne(m, options))) };
}

module.exports = { embedMedia, needsEmbed, EMBED_HOSTS };
