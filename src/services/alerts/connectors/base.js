'use strict';

// Общая обвязка подключения к сервису: статус для дока, переподключение с паузой, ручной перезапуск.

// Представляемся честно: сервисы отдают виджетам данные и без браузерного User-Agent.
const UA = 'nglzzz-twitch-bot (+https://nglzzz.xyz)';

/**
 * open(ctx) поднимает соединение и возвращает { close() }.
 * ctx.connected() — соединение готово; ctx.event() — пришло событие; ctx.closed(error) — оборвалось.
 */
function createConnector({ id, open, log = console, maxDelayMs = 60000 }) {
  const status = { state: 'off', error: null, since: Date.now(), connectedAt: null, lastEventAt: null };
  let session = null;
  let stopped = true;
  let attempt = 0;
  let retry = null;
  let generation = 0;

  function set(state, error = null) {
    if (status.state !== state) status.since = Date.now();
    status.state = state;
    status.error = error ? String(error).slice(0, 300) : null;
    if (state === 'connected') status.connectedAt = Date.now();
  }

  function schedule() {
    clearTimeout(retry);
    const delay = Math.min(maxDelayMs, 2000 * 2 ** attempt);
    attempt += 1;
    retry = setTimeout(run, delay);
  }

  async function run() {
    if (stopped) return;
    const gen = ++generation;
    set('connecting', status.error);
    let closedOnce = false;
    const ctx = {
      connected: () => { if (gen === generation && !stopped) { attempt = 0; set('connected'); } },
      event: () => { status.lastEventAt = Date.now(); },
      closed: (error) => {
        if (closedOnce || gen !== generation || stopped) return;
        closedOnce = true;
        session = null;
        const message = error?.message || error || 'соединение закрыто';
        log.warn(`[Alerts:${id}] disconnected: ${message}`);
        set('error', message);
        schedule();
      },
    };
    try {
      const opened = await open(ctx);
      if (gen !== generation || stopped) { try { opened?.close(); } catch (_) { /* уже не нужно */ } return; }
      session = opened;
    } catch (error) {
      ctx.closed(error);
    }
  }

  return {
    id,
    status: () => ({ ...status }),
    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      run();
    },
    stop() {
      stopped = true;
      generation += 1;
      clearTimeout(retry);
      try { session?.close(); } catch (_) { /* закрываем как получится */ }
      session = null;
      set('off');
    },
    restart() {
      this.stop();
      this.start();
    },
    get running() { return !stopped; },
  };
}

/** Держит ws живым: пинг сервиса и сторож тишины. */
function keepAlive(ws, { everyMs, ping, silenceMs = 0, onSilence }) {
  let last = Date.now();
  ws.on('message', () => { last = Date.now(); });
  const timer = setInterval(() => {
    if (silenceMs && Date.now() - last > silenceMs) { onSilence?.(); return; }
    try { ping(); } catch (_) { /* закрытие обработает close */ }
  }, everyMs);
  ws.on('close', () => clearInterval(timer));
  return () => clearInterval(timer);
}

module.exports = { createConnector, keepAlive, UA };
