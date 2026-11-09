'use strict';

// Звук с серверов, до которых браузер OBS достаёт не всегда (соединение с CDN DonationAlerts и Donatex
// у стримера рвётся, DonatePay отдаёт браузеру не звук), бот скачивает сам и кладёт в алерт как data:-ссылку.
const axios = require('axios');
const { UA } = require('./connectors/base');

const EMBED_HOSTS = ['files.donationalerts.com', 'widget.donatepay.ru', 'cdn.donatex.gg'];
const MAX_BYTES = 8 * 1024 * 1024;

function sniffAudio(buf) {
  const head = buf.subarray(0, 4).toString('latin1');
  if (head.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (head === 'RIFF') return 'audio/wav';
  if (head === 'OggS') return 'audio/ogg';
  if (head === 'fLaC') return 'audio/flac';
  return '';
}

function needsEmbed(url) {
  try { return EMBED_HOSTS.includes(new URL(url).hostname); } catch (_) { return false; }
}

async function embedOne(m, { http = axios, log = console } = {}) {
  if (!m.url || !needsEmbed(m.url)) return m;
  try {
    const res = await http.get(m.url, { headers: { 'User-Agent': UA }, responseType: 'arraybuffer', timeout: 30000, maxContentLength: MAX_BYTES });
    let type = String(res.headers['content-type'] || '').split(';')[0];
    // DA отдаёт озвучку как application/octet-stream, да ещё и MP3 под именем .wav — смотрим на сам файл.
    if (!type.startsWith('audio/')) type = sniffAudio(Buffer.from(res.data));
    if (!type) throw new Error(`ответ ${res.headers['content-type'] || 'без типа'} — не звук`);
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

module.exports = { embedMedia, needsEmbed, sniffAudio, EMBED_HOSTS };
