'use strict';

// StreamElements: донаты, пришедшие в SE (donatepay.eu и др.). Слушаем как их оверлей — astro по ключу оверлея.
const WebSocket = require('ws');
const { createConnector, keepAlive, UA } = require('./base');
const { fromStreamElements } = require('../normalize');

function createStreamElementsConnector({ getOverlay, onDonation, log = console }) {
  return createConnector({
    id: 'streamelements',
    log,
    open(ctx) {
      const overlay = getOverlay();
      if (!overlay?.apiKey) throw new Error('не указана ссылка на оверлей StreamElements');
      const ws = new WebSocket('wss://astro.streamelements.com', { headers: { 'User-Agent': UA } });
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          nonce: `${Date.now()}-activities`,
          data: { topic: 'channel.activities', token: overlay.apiKey, token_type: 'apikey' },
        }));
      });
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (_) { return; }
        if (msg.type === 'response') {
          if (msg.error || /error|fail|invalid/i.test(msg.data?.message || '')) ws.close(4000, msg.data?.message || msg.error);
          else ctx.connected();
          return;
        }
        if (msg.type === 'reconnect') { ws.close(4001, 'reconnect requested'); return; }
        if (msg.type !== 'message' || msg.topic !== 'channel.activities') return;
        const donation = fromStreamElements(msg.data);
        if (!donation) return;
        ctx.event();
        onDonation(donation);
      });
      ws.on('error', (error) => log.warn('[Alerts:streamelements] socket error:', error.message));
      ws.on('close', (code, reason) => ctx.closed(`закрыто (${code}${reason ? `: ${reason}` : ''})`));
      // Без пинга astro сам разрывает простаивающее соединение.
      keepAlive(ws, { everyMs: 30000, ping: () => ws.ping() });
      return { close: () => ws.close() };
    },
  });
}

module.exports = { createStreamElementsConnector };
