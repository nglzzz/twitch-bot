'use strict';

// Звук с серверов, до которых браузер OBS достаёт не всегда (соединение с CDN DonationAlerts и Donatex
// у стримера рвётся, DonatePay отдаёт браузеру не звук), бот скачивает сам и кладёт в алерт как data:-ссылку.
const axios = require('axios');
const { UA } = require('./connectors/base');

const EMBED_HOSTS = ['files.donationalerts.com', 'widget.donatepay.ru', 'cdn.donatex.gg'];
const MAX_BYTES = 8 * 1024 * 1024;
// Ответ ИИ Donatex генерируется после доната — его файла может ещё не быть (404). Ждём, как их виджет.
const WAIT_MS = 40 * 1000;
const RETRY_MS = 3000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const isGone = (error) => error.response?.status === 404 || error.response?.status === 410;

async function fetchAudio(m, { http, waitMs, retryMs, pause }) {
  const deadline = Date.now() + (m.wait ? waitMs : 0);
  for (;;) {
    try {
      return await http.get(m.url, { headers: { 'User-Agent': UA }, responseType: 'arraybuffer', timeout: 30000, maxContentLength: MAX_BYTES });
    } catch (error) {
      if (!m.wait || !isGone(error) || Date.now() + retryMs > deadline) throw error;
      await pause(retryMs);
    }
  }
}

async function embedOne(m, { http = axios, log = console, waitMs = WAIT_MS, retryMs = RETRY_MS, pause = sleep } = {}) {
  if (!m.url || !needsEmbed(m.url)) return m;
  try {
    const res = await fetchAudio(m, { http, waitMs, retryMs, pause });
    let type = String(res.headers['content-type'] || '').split(';')[0];
    // DA отдаёт озвучку как application/octet-stream, да ещё и MP3 под именем .wav — смотрим на сам файл.
    if (!type.startsWith('audio/')) type = sniffAudio(Buffer.from(res.data));
    if (!type) throw new Error(`ответ ${res.headers['content-type'] || 'без типа'} — не звук`);
    return { ...m, url: `data:${type};base64,${Buffer.from(res.data).toString('base64')}` };
  } catch (error) {
    log.warn(`[Alerts] Could not download ${m.kind} from ${new URL(m.url).hostname}:`, error.message);
    // Файла нет (удалён, не звук) — пробовать в OBS бесполезно; при обрыве связи пусть OBS попробует сам.
    const gone = isGone(error) || /не звук/.test(error.message);
    return gone ? { ...m, broken: true } : m;
  }
}

async function embedMedia(donation, options) {
  if (!donation?.media?.some((m) => needsEmbed(m.url))) return donation;
  return { ...donation, media: await Promise.all(donation.media.map((m) => embedOne(m, options))) };
}

module.exports = { embedMedia, needsEmbed, sniffAudio, EMBED_HOSTS };
