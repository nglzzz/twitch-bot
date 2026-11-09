'use strict';

// Donatex: SignalR-хаб виджета. Донаты выдаются по одному («аренда»); забираем донат
// и сразу отмечаем показанным, чтобы Donatex выдал следующий — очередь дальше ведёт бот.
const axios = require('axios');
const WebSocket = require('ws');
const { createConnector, keepAlive, UA } = require('./base');
const { fromDonatex } = require('../normalize');

const BASE = 'https://donatex.gg';
const RS = '\x1e';

function createDonatexConnector({ getWidgetId, onDonation, log = console, http = axios }) {
  return createConnector({
    id: 'donatex',
    log,
    async open(conn) {
      const widgetId = getWidgetId();
      if (!widgetId) throw new Error('не указан id виджета Donatex');
      const headers = { 'User-Agent': UA, Origin: BASE, Referer: `${BASE}/widgets/donations/${widgetId}` };
      const settings = await http.get(`${BASE}/api/donation-widget/get-widget-settings`, { params: { widgetId }, headers, timeout: 15000 });
      const mediaBase = settings.data?.mediaBaseUrl || 'https://cdn.donatex.gg';
      const negotiate = await http.post(`${BASE}/api/donations-hub/negotiate?negotiateVersion=1`, '', { headers, timeout: 15000 });
      const token = negotiate.data?.connectionToken;
      if (!token) throw new Error('Donatex не выдал соединение');
      const ws = new WebSocket(`wss://donatex.gg/api/donations-hub?id=${encodeURIComponent(token)}`, { headers });
      let invocation = 0;
      const invoke = (target, args = []) => ws.send(JSON.stringify({ target, arguments: args, invocationId: String(invocation++), type: 1 }) + RS);
      const call = (path, params) => http.get(`${BASE}/api/donations/${path}`, { params, headers, timeout: 15000 })
        .catch((error) => log.warn(`[Alerts:donatex] ${path} failed:`, error.message));

      function take(donation) {
        const normalized = fromDonatex(donation, { mediaBase });
        if (!normalized) return;
        conn.event();
        onDonation(normalized);
      }

      async function granted({ donationId, leaseToken, donation }) {
        if (donation) take(donation);
        await call('send-donation-started-playing', { donationId, widgetId, leaseToken, playbackAttempt: donation?.playbackAttempt ?? 0 });
        await call('set-donation-as-shown', { donationId, groupId: widgetId, leaseToken, isSkipped: false });
      }

      ws.on('open', () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS));
      ws.on('message', (raw) => {
        for (const frame of String(raw).split(RS)) {
          if (!frame) continue;
          let msg;
          try { msg = JSON.parse(frame); } catch (_) { continue; }
          if (msg.error) { ws.close(4000, String(msg.error)); return; }
          if (msg.type === undefined && !msg.error) {
            // ответ на рукопожатие
            invoke('ReportDonationPlaybackProtocolV5');
            invoke('JoinDonationWidgetGroup', [widgetId]);
            continue;
          }
          if (msg.type === 6) { ws.send(JSON.stringify({ type: 6 }) + RS); continue; }
          if (msg.type === 7) { ws.close(4001, msg.error || 'closed by server'); return; }
          if (msg.type === 3 && msg.invocationId === '1') {
            conn.connected();
            // Донаты, пришедшие, пока нас не было.
            http.get(`${BASE}/api/donations/get-unshowed-donations-for-widget`, { params: { widgetId }, headers, timeout: 15000 })
              .then((res) => (Array.isArray(res.data) ? res.data : []).forEach(take))
              .catch((error) => log.warn('[Alerts:donatex] unshowed donations failed:', error.message));
            continue;
          }
          if (msg.type !== 1) continue;
          const arg = msg.arguments?.[0];
          if (msg.target === 'ReceiveDonation') take(arg);
          else if (msg.target === 'PlaybackGranted' && arg?.donationId) granted(arg);
          else if (msg.target === 'PlaybackLeaseLost' && arg?.donationId) invoke('AcknowledgePlaybackStopped', [arg.donationId, arg.leaseToken]);
        }
      });
      ws.on('error', (error) => log.warn('[Alerts:donatex] socket error:', error.message));
      ws.on('close', (code, reason) => conn.closed(`закрыто (${code}${reason ? `: ${reason}` : ''})`));
      keepAlive(ws, { everyMs: 10000, ping: () => invoke('Heartbeat'), silenceMs: 60000, onSilence: () => ws.terminate() });
      return { close: () => ws.close() };
    },
  });
}

module.exports = { createDonatexConnector };
