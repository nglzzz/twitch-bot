// Подключение к боту. config.websocket — адрес или список: пробуем по порядку (прод, потом локальный).
// Связь держится постоянно и сама восстанавливается; на запасном адресе раз в 5 минут пробуем вернуться на основной.
(function (D) {
  'use strict';

  const CONNECT_TIMEOUT_MS = 6000;
  const BACK_TO_MAIN_MS = 5 * 60 * 1000;

  D.connectBot = function ({ onOpen, onMessage }) {
    const raw = D.config && D.config.websocket;
    const urls = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
    let socket = null;
    let index = 0;
    let delay = 1000;

    function next() {
      index += 1;
      if (index < urls.length) { open(); return; }
      index = 0;
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    }

    function open() {
      let ws;
      try { ws = new WebSocket(urls[index]); } catch (e) { next(); return; }
      let opened = false;
      let backTimer = null;
      const stall = setTimeout(() => { if (!opened) ws.close(); }, CONNECT_TIMEOUT_MS);
      socket = ws;
      ws.onopen = () => {
        opened = true; delay = 1000; clearTimeout(stall);
        if (index > 0) backTimer = setTimeout(() => ws.close(), BACK_TO_MAIN_MS);
        if (onOpen) onOpen();
      };
      ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (e) { return; }
        try { onMessage(data); } catch (e) { /* сломанное сообщение не должно ронять сцену */ }
      };
      ws.onclose = () => {
        clearTimeout(stall); clearTimeout(backTimer);
        if (socket === ws) socket = null;
        if (opened) { index = 0; setTimeout(open, 1000); } else next();
      };
    }

    if (urls.length) open();
    return {
      send(data) { if (socket && socket.readyState === 1) socket.send(JSON.stringify(data)); },
    };
  };
})(window.Dvor = window.Dvor || {});
