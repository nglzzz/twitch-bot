'use strict';

// DonatePay: слушаем как их виджет — страница виджета → токен centrifugo → канал notifications#<id>.
const axios = require('axios');
const WebSocket = require('ws');
const { createConnector, keepAlive, UA } = require('./base');
const { fromDonatePay } = require('../normalize');

const BASE = 'https://widget.donatepay.ru';
const SOCKET = 'wss://centrifugo.donatepay.ru/connection/websocket';
const TOKEN_TTL_MS = 5 * 60 * 60 * 1000; // их токен живёт 6 часов
const API_TOKEN_URL = 'https://donatepay.ru/api/v2/socket/token';

function cookieJar() {
  const jar = new Map();
  return {
    take(headers) {
      for (const line of [].concat(headers?.['set-cookie'] || [])) {
        const [pair] = String(line).split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

/** Страница виджета: csrf, id пользователя, порог озвучки и премиум-голоса. */
function parseWidgetPage(html) {
  const csrf = (html.match(/<meta name="csrf-token" content="([^"]+)"/) || [])[1];
  const userId = (html.match(/setConfig\('userID',\s*'(\d+)'\)/) || html.match(/getUserId\(\)\s*{\s*return parseInt\('(\d+)'\)/) || [])[1];
  let userSettings = {};
  const m = html.match(/AlertBox\.userSettings\s*=\s*(\{.*?\});/s);
  if (m) { try { userSettings = JSON.parse(m[1]); } catch (_) { userSettings = {}; } }
  return { csrf, userId, userSettings };
}

async function prepare(token, http = axios, apiKey = '') {
  const jar = cookieJar();
  const headers = () => ({ 'User-Agent': UA, Cookie: jar.header() });
  const page = await http.get(`${BASE}/alert-box/widget/${token}`, { headers: headers(), timeout: 15000 });
  jar.take(page.headers);
  const { csrf, userId, userSettings } = parseWidgetPage(String(page.data));
  if (!csrf || !userId) throw new Error('не удалось прочитать страницу виджета DonatePay (неверный токен?)');
  const settings = await http.get(`${BASE}/alert-box/all-settings/${token}`, { headers: headers(), timeout: 15000 });
  jar.take(settings.headers);
  // С API-ключом — официальный канал DonatePay; без него — канал, который слушает их виджет.
  const socket = apiKey
    ? await http.post(API_TOKEN_URL, { access_token: apiKey }, { headers: { 'User-Agent': UA }, timeout: 15000 })
    : await http.post(`${BASE}/socket/token`, { _token: csrf, token }, {
      headers: { ...headers(), 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
      timeout: 15000,
    });
  if (!socket.data?.token) throw new Error('DonatePay не выдал токен сокета');
  return {
    userId,
    channel: apiKey ? `$public:${userId}` : `notifications#${userId}`,
    socketToken: socket.data.token,
    ctx: {
      base: BASE,
      widgetsToken: userSettings.widgetsToken || token,
      voiceSum: Number(userSettings.voiceSum || 0),
      allowPremium: String(userSettings.premium?.allowPremium) === '1',
      widgets: settings.data?.notifications || {},
    },
  };
}

function createDonatePayConnector({ getToken, getApiKey = () => '', onDonation, log = console, http = axios }) {
  return createConnector({
    id: 'donatepay',
    log,
    async open(conn) {
      const token = getToken();
      if (!token) throw new Error('не указан токен виджета DonatePay');
      const apiKey = getApiKey();
      const { channel, socketToken, ctx } = await prepare(token, http, apiKey);
      const ws = new WebSocket(SOCKET, { headers: { 'User-Agent': UA } });
      let id = 0;
      const send = (payload) => ws.send(JSON.stringify({ ...payload, id: ++id }));
      ws.on('open', () => send({ params: { token: socketToken, name: 'js' } }));

      // Приватный канал $public:<id> требует отдельный токен подписки на нашего клиента.
      async function subscribe(client) {
        let subToken;
        if (apiKey) {
          const res = await http.post(API_TOKEN_URL, { client, channels: [channel], access_token: apiKey }, { headers: { 'User-Agent': UA }, timeout: 15000 });
          subToken = res.data?.channels?.find((c) => c.channel === channel)?.token;
          if (!subToken) throw new Error('DonatePay не выдал токен подписки');
        }
        send({ method: 1, params: subToken ? { channel, token: subToken } : { channel } });
      }

      ws.on('message', (raw) => {
        for (const line of String(raw).split('\n')) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch (_) { continue; }
          if (msg.error) { ws.close(4000, String(msg.error.message || 'error')); return; }
          if (msg.id === 1 && msg.result?.client) {
            subscribe(msg.result.client).catch((error) => ws.close(4003, error.message.slice(0, 100)));
            continue;
          }
          if (msg.id === 2 && msg.result !== undefined) conn.connected();
          const pub = msg.result && !msg.id ? msg.result : null;
          if (!pub || pub.channel !== channel) continue;
          const data = pub.data?.data ?? pub.data;
          const donation = fromDonatePay(data, ctx);
          if (!donation) continue;
          conn.event();
          onDonation(donation);
        }
      });
      ws.on('error', (error) => log.warn('[Alerts:donatepay] socket error:', error.message));
      ws.on('close', (code, reason) => conn.closed(`закрыто (${code}${reason ? `: ${reason}` : ''})`));
      keepAlive(ws, { everyMs: 25000, ping: () => send({ method: 7 }), silenceMs: 90000, onSilence: () => ws.terminate() });
      // Токен сокета истекает — переподключаемся заранее.
      const refresh = setTimeout(() => ws.close(4002, 'token refresh'), TOKEN_TTL_MS);
      ws.on('close', () => clearTimeout(refresh));
      return { close: () => ws.close() };
    },
  });
}

module.exports = { createDonatePayConnector, parseWidgetPage };
