/*
 * Общий клиент заказа музыки для сайта, оверлея, дока и админки.
 * Получает состояние плеера и очередь через WebSocket и плавно считает
 * позицию трека между обновлениями сервера.
 *
 * MusicClient.connect({ initial, websocketPort, onState, onQueue, onConnection })
 *   -> { getState(), getQueue(), position(), refresh(), close() }
 */
(function () {
  'use strict';

  function formatTime(totalSec) {
    var sec = Math.max(0, Math.floor(Number(totalSec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = String(sec % 60).padStart(2, '0');
    return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
  }

  function websocketUrl(port) {
    if (window.location.protocol === 'https:') return 'wss://' + window.location.host + '/ws';
    return 'ws://' + window.location.hostname + ':' + port;
  }

  function connect(options) {
    var opts = options || {};
    var state = opts.initial && opts.initial.state ? opts.initial.state : null;
    var queue = opts.initial && Array.isArray(opts.initial.queue) ? opts.initial.queue : [];
    var receivedAt = Date.now();
    var socket = null;
    var closed = false;
    var retryMs = 1000;

    function emitState() { if (typeof opts.onState === 'function') opts.onState(state); }
    function emitQueue() { if (typeof opts.onQueue === 'function') opts.onQueue(queue); }
    function emitConnection(online) { if (typeof opts.onConnection === 'function') opts.onConnection(online); }

    function setState(next) {
      if (!next) return;
      // Устаревшие пакеты (seq меньше текущего) игнорируем.
      if (state && typeof next.seq === 'number' && typeof state.seq === 'number' && next.seq < state.seq && next.seq !== 0) return;
      state = next;
      receivedAt = Date.now();
      emitState();
    }

    function setQueue(next) {
      if (!Array.isArray(next)) return;
      queue = next;
      emitQueue();
    }

    function refresh() {
      return fetch('/api/music/state', { cache: 'no-store' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) {
          if (!data) return;
          if (data.state) { state = null; setState(data.state); }
          setQueue(data.queue);
        })
        .catch(function () {});
    }

    function open() {
      if (closed) return;
      try { socket = new WebSocket(websocketUrl(opts.websocketPort || 8081)); } catch (error) { scheduleReconnect(); return; }
      socket.addEventListener('open', function () {
        retryMs = 1000;
        emitConnection(true);
        refresh();
      });
      socket.addEventListener('message', function (event) {
        var data;
        try { data = JSON.parse(event.data); } catch (error) { return; }
        if (data.type === 'music:state') setState(data.state);
        else if (data.type === 'music:queue') setQueue(data.queue);
      });
      socket.addEventListener('close', function () {
        emitConnection(false);
        scheduleReconnect();
      });
      socket.addEventListener('error', function () {
        try { socket.close(); } catch (error) { /* ignore */ }
      });
    }

    function scheduleReconnect() {
      if (closed) return;
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    }

    /** Текущая позиция (сек от начала видео) с учётом прошедшего времени. */
    function position() {
      if (!state || !state.current) return 0;
      var pos = Number(state.positionSec) || 0;
      if (state.status === 'playing' && state.player && state.player.online) {
        pos += (Date.now() - receivedAt) / 1000;
      }
      var end = state.current.endSec || state.current.durationSec || 0;
      return end > 0 ? Math.min(pos, end) : pos;
    }

    open();
    if (state) setTimeout(emitState, 0);
    setTimeout(emitQueue, 0);

    return {
      getState: function () { return state; },
      getQueue: function () { return queue; },
      position: position,
      refresh: refresh,
      close: function () { closed = true; if (socket) socket.close(); },
    };
  }

  // Пометки вида «(Official Video Remastered)» не нужны в крупном заголовке.
  var TITLE_NOISE = /\b(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|hd|hq|4k|mv|m\/v|clip|music)\b|клип|премьера|официальн|текст песни/i;

  function cleanTitle(title) {
    var cleaned = String(title || '').replace(/\s*[([【]([^)\]】]*)[)\]】]/g, function (match, inner) {
      return TITLE_NOISE.test(inner) ? '' : match;
    }).replace(/\s{2,}/g, ' ').trim();
    return cleaned || String(title || '').trim();
  }

  /** «Исполнитель — Трек» -> { title: 'Трек', artist: 'Исполнитель' }; иначе исполнитель — канал. */
  function splitTitle(track) {
    var title = cleanTitle(track && track.title);
    var separator = title.match(/\s+[—–-]\s+/);
    if (separator) {
      var at = title.indexOf(separator[0]);
      var head = title.slice(at + separator[0].length).trim();
      var artist = title.slice(0, at).trim();
      if (head && artist) return { title: head, artist: artist };
    }
    var author = String((track && track.author) || '').replace(/\s+-\s+Topic$/i, '').replace(/VEVO$/, '').trim();
    return { title: title, artist: author };
  }

  window.MusicClient = { connect: connect, formatTime: formatTime, cleanTitle: cleanTitle, splitTitle: splitTitle };
})();
