/*
 * Плеер заказов видео (/admin/video).
 * Сервер — источник истины (что играет, пауза, перемотка), страница — источник позиции.
 * Player registration is followed by progress reports and playback state events.
 */
(function () {
  'use strict';

  var root = document.getElementById('vq');
  if (!root) return;

  var CSRF = root.dataset.csrf;
  var PLAYER_ID = 'page-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  var HOST = location.hostname;

  function $(id) { return document.getElementById(id); }
  var els = {
    stage: $('vq-stage'), backdrop: $('vq-backdrop'), player: $('vq-player'),
    idle: $('vq-idle'), idleTitle: $('vq-idle-title'), idleText: $('vq-idle-text'), idlePlatforms: $('vq-idle-platforms'),
    warning: $('vq-warning'), warningCount: $('vq-warning-count'), warningArc: $('vq-warning-arc'), warningTitle: $('vq-warning-title'),
    warningKeep: $('vq-warning-keep'), warningSkip: $('vq-warning-skip'),
    unmute: $('vq-unmute'), banner: $('vq-banner'), takeover: $('vq-takeover'), problem: $('vq-problem'),
    progress: $('vq-progress'), fill: $('vq-fill'), seek: $('vq-seek'),
    chips: $('vq-chips'), title: $('vq-title'), by: $('vq-by'), time: $('vq-time'),
    vote: $('vq-vote'), keepWords: $('vq-keep-words'), skipWords: $('vq-skip-words'),
    keepCount: $('vq-keep-count'), skipCount: $('vq-skip-count'), voteFill: $('vq-vote-fill'), voteHint: $('vq-vote-hint'),
    toggle: $('vq-toggle'), lock: $('vq-lock'), loop: $('vq-loop'), volume: $('vq-volume'),
    rate: $('vq-rate'), rateLabel: $('vq-rate-label'),
    accept: $('vq-accept'), acceptLabel: $('vq-accept-label'),
    queueSub: $('vq-queue-sub'), list: $('vq-list'), empty: $('vq-empty'), ws: $('vq-ws'),
    addToggle: $('vq-add-toggle'), add: $('vq-add'), addInput: $('vq-add-input'), toast: $('vq-toast'),
  };

  var fmt = function (sec) { return MusicClient.formatTime(sec); };
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- сеть ----------

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ _csrf: CSRF }, body || {})),
    }).then(function (response) { return response.json().catch(function () { return null; }); })
      .catch(function () { return null; });
  }

  function control(action, value) {
    var body = { action: action };
    if (value !== undefined) body.value = value;
    return post('/admin/video/api/control', body).then(function (data) {
      if (data && data.state) applyState(data.state);
      if (data && data.queue) renderQueue(data.queue);
      if (data && data.message && (action === 'add' || data.ok === false)) toast(data.message, data.ok === false);
      return data;
    });
  }

  var toastTimer = null;
  function toast(text, isError) {
    els.toast.textContent = text;
    els.toast.classList.toggle('is-error', Boolean(isError));
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 5000);
  }

  // ---------- загрузка внешних API ----------

  var scripts = {};
  function loadScript(src, ready) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        var tag = document.createElement('script');
        tag.src = src;
        tag.onload = function () { if (!ready) resolve(); };
        tag.onerror = reject;
        if (ready) ready(resolve);
        document.head.appendChild(tag);
      });
    }
    return scripts[src];
  }
  function loadYouTube() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    return loadScript('https://www.youtube.com/iframe_api', function (resolve) {
      var previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (previous) previous(); resolve(); };
    });
  }

  // ---------- адаптеры плееров ----------
  // Общий интерфейс: load(item, startSec, autoplay), play(), pause(), seek(sec), setVolume(0..100),
  // setPlaybackRate(rate), time() -> сек|null, duration() -> сек|null, playing() -> bool, destroy().
  var PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  function playbackRateOf(value) {
    var n = Number(value);
    if (!isFinite(n)) return 1;
    var best = PLAYBACK_RATES[0];
    var bestDiff = Math.abs(best - n);
    for (var i = 1; i < PLAYBACK_RATES.length; i++) {
      var diff = Math.abs(PLAYBACK_RATES[i] - n);
      if (diff < bestDiff) { best = PLAYBACK_RATES[i]; bestDiff = diff; }
    }
    return best;
  }
  function rateSupported(item) {
    return Boolean(item && (item.provider === 'youtube' || item.provider === 'vimeo'));
  }

  function mount() {
    els.player.innerHTML = '';
    var div = document.createElement('div');
    els.player.appendChild(div);
    return div;
  }

  function YouTubeAdapter(events) {
    var player = null;
    var ready = false;
    var pending = null;
    var wantPlay = false;
    var state = -1;
    var rate = 1;
    var rateRequestedAt = 0;
    var rateApplyOnce = false;
    var glitchHandled = false;
    function embedRate() {
      try { return player && typeof player.getPlaybackRate === 'function' ? player.getPlaybackRate() : null; } catch (e) { return null; }
    }
    function resumePlayback() {
      if (!wantPlay || !player) return;
      try { player.playVideo(); } catch (e) { /* Autoplay may be blocked by the browser. */ }
    }
    function settlingRate() {
      return wantPlay && Date.now() - rateRequestedAt < 2000;
    }
    // setPlaybackRate у YouTube асинхронно ставит ролик на паузу. Нельзя вызывать его
    // повторно из onStateChange: getPlaybackRate() ещё старый, и пауза закрепляется.
    function applyRate() {
      if (!ready || !player || typeof player.setPlaybackRate !== 'function') return;
      if (embedRate() === rate) return;
      rateRequestedAt = Date.now();
      if (events.onPlaybackRate) events.onPlaybackRate();
      try { player.setPlaybackRate(rate); } catch (e) { /* ролик не поддерживает эту скорость */ }
      resumePlayback();
      [80, 250, 700].forEach(function (delay) {
        setTimeout(function () {
          // YouTube иногда ставит паузу без события. Пока окно открыто, просто продолжаем.
          if (!settlingRate()) return;
          resumePlayback();
        }, delay);
      });
    }
    var target = mount();
    loadYouTube().then(function () {
      player = new YT.Player(target, {
        width: '100%',
        height: '100%',
        // controls: шестерёнка YouTube (качество). Свои кнопки студии остаются снаружи iframe.
        playerVars: { autoplay: 1, controls: 1, disablekb: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, fs: 0, origin: location.origin, widget_referrer: location.origin },
        events: {
          // До готовности могли прийти play/pause — применяем последнее желаемое состояние.
          onReady: function () { ready = true; if (pending) { var p = pending; pending = null; load(p[0], p[1], wantPlay); } },
          onStateChange: function (event) {
            state = event.data;
            // Пауза после setPlaybackRate приходит позже, чем PLAYING с уже новой скоростью.
            // Пока окно открыто, это не пауза стримера и на сервер её слать нельзя.
            if (event.data === 2 && settlingRate()) {
              glitchHandled = true;
              resumePlayback();
              return;
            }
            if (event.data === 1 && rateApplyOnce) {
              rateApplyOnce = false;
              var actual = embedRate();
              if (actual !== null && actual !== rate) applyRate();
            }
            if (event.data === 1 && glitchHandled) {
              glitchHandled = false;
              rateRequestedAt = 0;
              if (events.onPlaybackRateSettled) events.onPlaybackRateSettled();
            }
            if (event.data === 1) events.onPlaying();
            if (event.data === 2) events.onPaused();
            if (event.data === 0) events.onEnded();
          },
          onPlaybackRateChange: function () { if (settlingRate()) resumePlayback(); },
          onError: function (event) { events.onError(event.data); },
        },
      });
    });
    function load(item, start, autoplay) {
      wantPlay = Boolean(autoplay);
      state = -1;
      rateApplyOnce = rate !== 1;
      if (!ready) { pending = [item, start, autoplay]; return; }
      var opts = { videoId: item.externalId, startSeconds: start || 0 };
      if (autoplay) player.loadVideoById(opts); else player.cueVideoById(opts);
    }
    return {
      load: load,
      play: function () { wantPlay = true; if (ready) player.playVideo(); },
      pause: function () { wantPlay = false; if (ready) player.pauseVideo(); },
      seek: function (sec) { if (ready) player.seekTo(sec, true); },
      setVolume: function (v) { if (!ready) return; player.unMute(); player.setVolume(v); },
      setPlaybackRate: function (next) {
        var n = Number(next);
        if (!isFinite(n) || n <= 0) return;
        var same = n === rate;
        rate = n;
        // Повтор из syncPlayer приходит раньше, чем YouTube сообщает новую скорость.
        if (same && Date.now() - rateRequestedAt < 1500) return;
        if (same && (embedRate() === null || embedRate() === n)) return;
        applyRate();
      },
      time: function () { try { return ready ? player.getCurrentTime() : null; } catch (e) { return null; } },
      duration: function () { try { return ready ? player.getDuration() || null : null; } catch (e) { return null; } },
      playing: function () { return state === 1; },
      destroy: function () { try { if (player) player.destroy(); } catch (e) { /* ignore */ } },
    };
  }

  function TikTokAdapter(events) {
    var iframe = null;
    var current = 0;
    var total = null;
    var state = -1;
    var start = 0;
    var wantPlay = false;
    var volume = 100;
    function send(type, value) {
      if (!iframe || !iframe.contentWindow) return;
      var message = { type: type, 'x-tiktok-player': true };
      if (value !== undefined) message.value = value;
      iframe.contentWindow.postMessage(message, '*');
    }
    function onMessage(event) {
      if (!iframe || event.source !== iframe.contentWindow) return;
      var data = event.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return; } }
      if (!data || !data['x-tiktok-player']) return;
      if (data.type === 'onPlayerReady') {
        if (volume > 0) send('unMute');
        if (start > 0) send('seekTo', start);
        if (wantPlay) send('play');
      } else if (data.type === 'onStateChange') {
        state = data.value;
        if (state === 1) events.onPlaying();
        if (state === 2) events.onPaused();
        if (state === 0) events.onEnded();
      } else if (data.type === 'onCurrentTime' && data.value) {
        current = Number(data.value.currentTime) || 0;
        total = Number(data.value.duration) || total;
      } else if (data.type === 'onError') {
        events.onError(data.value || 'tiktok');
      }
    }
    window.addEventListener('message', onMessage);
    return {
      load: function (item, startSec, autoplay) {
        start = startSec || 0;
        wantPlay = autoplay;
        current = start;
        total = null;
        state = -1;
        var target = mount();
        iframe = document.createElement('iframe');
        iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
        iframe.src = 'https://www.tiktok.com/player/v1/' + encodeURIComponent(item.externalId) +
          '?autoplay=' + (autoplay ? 1 : 0) + '&controls=0&progress_bar=0&play_button=0&volume_control=0&fullscreen_button=0' +
          '&timestamp=0&loop=0&music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0';
        target.appendChild(iframe);
      },
      play: function () { wantPlay = true; send('play'); },
      pause: function () { wantPlay = false; send('pause'); },
      seek: function (sec) { send('seekTo', sec); current = sec; },
      setVolume: function (v) { volume = v; send(v > 0 ? 'unMute' : 'mute'); },
      setPlaybackRate: function () {},
      time: function () { return current; },
      duration: function () { return total; },
      playing: function () { return state === 1; },
      destroy: function () { window.removeEventListener('message', onMessage); iframe = null; },
    };
  }

  function TwitchVodAdapter(events) {
    var player = null;
    var playing = false;
    var target = mount();
    target.id = 'vq-twitch-' + Date.now();
    var ready = loadScript('https://player.twitch.tv/js/embed/v1.js');
    var queued = null;
    function create(item, start, autoplay) {
      var h = Math.floor(start / 3600);
      var m = Math.floor((start % 3600) / 60);
      var s = Math.floor(start % 60);
      player = new Twitch.Player(target.id, {
        video: item.externalId, parent: [HOST], autoplay: Boolean(autoplay), muted: false,
        time: h + 'h' + m + 'm' + s + 's', width: '100%', height: '100%',
      });
      player.addEventListener(Twitch.Player.PLAYING, function () { playing = true; events.onPlaying(); });
      player.addEventListener(Twitch.Player.PAUSE, function () { playing = false; events.onPaused(); });
      player.addEventListener(Twitch.Player.ENDED, function () { playing = false; events.onEnded(); });
    }
    return {
      load: function (item, start, autoplay) {
        queued = [item, start, autoplay];
        ready.then(function () { if (queued) { var q = queued; queued = null; create(q[0], q[1], q[2]); } });
      },
      play: function () { if (player) player.play(); },
      pause: function () { if (player) player.pause(); },
      seek: function (sec) { if (player) player.seek(sec); },
      setVolume: function (v) { if (player) { player.setMuted(v === 0); player.setVolume(v / 100); } },
      setPlaybackRate: function () {},
      time: function () { try { return player ? player.getCurrentTime() : null; } catch (e) { return null; } },
      duration: function () { try { return player ? player.getDuration() || null : null; } catch (e) { return null; } },
      playing: function () { return playing; },
      destroy: function () { player = null; },
    };
  }

  function VimeoAdapter(events) {
    var player = null;
    var current = null;
    var total = null;
    var playing = false;
    var rate = 1;
    var target = mount();
    function applyRate() {
      if (!player || typeof player.setPlaybackRate !== 'function') return;
      var resume = playing;
      if (events.onPlaybackRate) events.onPlaybackRate();
      player.setPlaybackRate(rate).then(function () {
        if (resume && player) player.play().catch(function () {});
      }).catch(function () {});
    }
    var ready = loadScript('https://player.vimeo.com/api/player.js');
    return {
      load: function (item, start, autoplay) {
        ready.then(function () {
          player = new Vimeo.Player(target, { id: Number(item.externalId), autoplay: Boolean(autoplay), controls: false, responsive: false, width: 1280 });
          player.on('loaded', function () {
            if (start) player.setCurrentTime(start).catch(function () {});
            applyRate();
          });
          player.on('play', function () { playing = true; events.onPlaying(); });
          player.on('pause', function () { playing = false; events.onPaused(); });
          player.on('ended', function () { playing = false; events.onEnded(); });
          player.on('timeupdate', function (data) { current = data.seconds; total = data.duration || total; });
          player.on('error', function (error) { events.onError((error && error.name) || 'vimeo'); });
        });
      },
      play: function () { if (player) player.play().catch(function () {}); },
      pause: function () { if (player) player.pause().catch(function () {}); },
      seek: function (sec) { if (player) player.setCurrentTime(sec).catch(function () {}); },
      setVolume: function (v) { if (player) player.setVolume(v / 100).catch(function () {}); },
      setPlaybackRate: function (next) {
        var n = Number(next);
        if (!isFinite(n) || n <= 0 || n === rate) return;
        rate = n;
        applyRate();
      },
      time: function () { return current; },
      duration: function () { return total; },
      playing: function () { return playing; },
      destroy: function () { try { if (player) player.destroy(); } catch (e) { /* ignore */ } },
    };
  }

  /**
   * Плееры без API (клипы Twitch, Streamable): время считаем сами.
   * Пауза выгружает плеер, продолжение запускает ролик заново (клипы короткие).
   */
  function FrameAdapter(buildUrl, events) {
    var item = null;
    var startedAt = null;
    var base = 0;
    var running = false;
    var target = mount();
    function show() {
      target.innerHTML = '';
      var iframe = document.createElement('iframe');
      iframe.allow = 'autoplay; encrypted-media; fullscreen';
      iframe.src = buildUrl(item);
      target.appendChild(iframe);
      base = 0;
      startedAt = Date.now();
      running = true;
      events.onPlaying();
    }
    return {
      load: function (next, start, autoplay) {
        item = next;
        running = false;
        target.innerHTML = '';
        if (autoplay) show();
      },
      play: function () { if (!running && item) show(); },
      pause: function () {
        if (!running) return;
        base += (Date.now() - startedAt) / 1000;
        running = false;
        target.innerHTML = '';
      },
      seek: function () {},
      setVolume: function () {},
      setPlaybackRate: function () {},
      time: function () { return running ? base + (Date.now() - startedAt) / 1000 : base; },
      duration: function () { return null; },
      playing: function () { return running; },
      destroy: function () { target.innerHTML = ''; running = false; },
    };
  }

  function adapterKey(item) {
    if (item.provider === 'twitch') return item.kind === 'clip' ? 'twitch-clip' : 'twitch-vod';
    return item.provider;
  }

  function createAdapter(key, events) {
    switch (key) {
      case 'youtube': return YouTubeAdapter(events);
      case 'tiktok': return TikTokAdapter(events);
      case 'twitch-vod': return TwitchVodAdapter(events);
      case 'vimeo': return VimeoAdapter(events);
      case 'twitch-clip': return FrameAdapter(function (item) {
        return 'https://clips.twitch.tv/embed?clip=' + encodeURIComponent(item.externalId) + '&parent=' + encodeURIComponent(HOST) + '&autoplay=true&muted=false';
      }, events);
      case 'streamable': return FrameAdapter(function (item) {
        return 'https://streamable.com/o/' + encodeURIComponent(item.externalId) + '?autoplay=1&muted=0&loop=0';
      }, events);
      default: return null;
    }
  }

  // ---------- синхронизация с сервером ----------

  var adapter = null;
  var adapterKind = null;
  var loadedId = null;
  var endedReportedId = null;
  var errorReportedId = null;
  var appliedSeek = null;
  var pendingSeek = null;
  var seekResumeUntil = 0;
  var rateResumeUntil = 0;
  var registered = false;
  var isActive = false;
  var playCheckTimer = null;
  var syncedStatus = null;
  var adapterGeneration = 0;
  var playbackStarted = false;
  var playbackChange = null;
  var playbackReports = Promise.resolve();

  function reportPlayback(status) {
    var state = lastState;
    if (!isActive || !loadedId || !state || !state.current || state.current.id !== loadedId || state.warning) return;
    if ((playbackChange ? playbackChange.status : state.status) === status) return;
    var change = { status: status, requestId: loadedId, seekSeq: appliedSeek };
    playbackChange = change;
    var position = adapterPosition();
    // Preserve the order of quick native pause/play clicks and use the acknowledged sequence.
    playbackReports = playbackReports.then(function () {
      if (!isActive || loadedId !== change.requestId || appliedSeek !== change.seekSeq || !lastState || lastState.warning) return;
      return report({ event: status, requestId: change.requestId, position: position, playbackSeq: lastState.playbackSeq });
    }).finally(function () {
      if (playbackChange !== change) return;
      playbackChange = null;
      syncPlayer(lastState);
    });
  }

  function scopedAdapterEvents() {
    var generation = ++adapterGeneration;
    var events = {};
    Object.keys(adapterEvents).forEach(function (name) {
      events[name] = function () {
        if (generation === adapterGeneration) adapterEvents[name].apply(null, arguments);
      };
    });
    return events;
  }

  var adapterEvents = {
    onPlaying: function () {
      playbackStarted = true;
      stopPlayCheck();
      rateResumeUntil = 0;
      if (pendingSeek) adapterPosition();
      if (pendingSeek) return;
      seekResumeUntil = 0;
      reportPlayback('playing');
    },
    onPlaybackRate: function () { rateResumeUntil = Date.now() + 4000; },
    onPlaybackRateSettled: function () { rateResumeUntil = 0; },
    onPaused: function () {
      var settling = Date.now() < Math.max(seekResumeUntil, rateResumeUntil);
      // Пауза от setPlaybackRate/seekTo не должна сохраняться на сервере как пауза стримера.
      if (lastState && lastState.status === 'playing' && (!playbackStarted || settling)) {
        askPlay();
        return;
      }
      if (settling) return;
      if (playbackStarted && !pendingSeek && endedReportedId !== loadedId && errorReportedId !== loadedId) reportPlayback('paused');
    },
    onEnded: function () {
      if (loadedId && endedReportedId !== loadedId) {
        endedReportedId = loadedId;
        report({ event: 'ended', requestId: loadedId });
      }
    },
    onError: function (code) {
      if (loadedId && errorReportedId !== loadedId) {
        errorReportedId = loadedId;
        report({ event: 'error', requestId: loadedId, errorCode: code });
      }
    },
  };

  function report(payload) {
    var body = { playerId: PLAYER_ID, event: payload.event, requestId: payload.requestId || '', position: payload.position, seekSeq: appliedSeek };
    if (payload.errorCode !== undefined) body.errorCode = payload.errorCode;
    if (payload.duration) body.duration = payload.duration;
    if (payload.playbackSeq !== undefined) body.playbackSeq = payload.playbackSeq;
    return post('/admin/video/api/player/report', body).then(function (data) {
      // Native play/pause replies include a snapshot, even when the socket is offline.
      if (data && data.active === false) deactivate();
      if (data && data.state) applyState(data.state);
      return data;
    });
  }

  function register(takeover) {
    return post('/admin/video/api/player/register', { playerId: PLAYER_ID, takeover: Boolean(takeover) }).then(function (data) {
      if (!data || !data.state) return;
      registered = true;
      isActive = Boolean(data.state.player && data.state.player.activeId === PLAYER_ID);
      els.banner.hidden = isActive;
      applyState(data.state);
      if (data.queue) renderQueue(data.queue);
    });
  }

  function deactivate() {
    if (!registered) return;
    isActive = false;
    els.banner.hidden = false;
    stopPlayCheck();
    destroyAdapter();
  }

  function destroyAdapter() {
    adapterGeneration += 1;
    if (adapter) adapter.destroy();
    adapter = null;
    adapterKind = null;
    loadedId = null;
    pendingSeek = null;
    seekResumeUntil = 0;
    rateResumeUntil = 0;
    playbackStarted = false;
    playbackChange = null;
    syncedStatus = null;
    els.player.innerHTML = '';
  }

  function askPlay() {
    if (!adapter) return;
    adapter.play();
    // Таймер не перезапускаем: обновления голосов идут часто и откладывали бы проверку бесконечно.
    if (playCheckTimer) return;
    playCheckTimer = setTimeout(function () {
      playCheckTimer = null;
      var state = lastState;
      if (!adapter || !isActive || !state || state.status !== 'playing' || !state.current) return;
      if (!adapter.playing()) els.unmute.hidden = false;
    }, 3000);
  }

  function stopPlayCheck() {
    clearTimeout(playCheckTimer);
    playCheckTimer = null;
    els.unmute.hidden = true;
  }

  function syncPlayer(state) {
    if (!state) return;
    var activeNow = Boolean(state.player && state.player.activeId === PLAYER_ID);
    if (!activeNow) {
      if (isActive) deactivate();
      return;
    }
    isActive = true;
    els.banner.hidden = true;
    var item = state.current;
    if (!item) {
      stopPlayCheck();
      if (adapter) destroyAdapter();
      return;
    }
    var retry = errorReportedId === item.id && state.status === 'playing' && syncedStatus !== 'playing';
    syncedStatus = state.status;
    var key = adapterKey(item);
    if (item.id !== loadedId || retry) {
      playbackStarted = false;
      playbackChange = null;
      if (!adapter || adapterKind !== key || key !== 'youtube') {
        var events = scopedAdapterEvents();
        if (adapter) adapter.destroy();
        adapter = createAdapter(key, events);
        adapterKind = key;
      }
      loadedId = item.id;
      endedReportedId = null;
      errorReportedId = null;
      appliedSeek = state.seekSeq;
      pendingSeek = null;
      seekResumeUntil = 0;
      rateResumeUntil = 0;
      if (!adapter) return;
      adapter.load(item, state.positionSec, state.status === 'playing');
    } else if (state.seekSeq !== appliedSeek) {
      appliedSeek = state.seekSeq;
      endedReportedId = null;
      if (adapter) {
        pendingSeek = { position: state.positionSec, requestedAt: Date.now(), lastAttemptAt: Date.now() };
        seekResumeUntil = Date.now() + 4000;
        adapter.seek(state.positionSec);
      }
    }
    if (!adapter) return;
    var awaitingPlayback = playbackChange && playbackChange.requestId === item.id && playbackChange.seekSeq === appliedSeek && !state.warning;
    // A broadcast sent before a native click must not undo that click while its report is pending.
    if (!awaitingPlayback) {
      if (state.status === 'playing') { if (!adapter.playing()) askPlay(); }
      else { stopPlayCheck(); adapter.pause(); }
    }
    adapter.setVolume(Math.max(0, Math.min(100, Number(state.volume) || 0)));
    if (adapter.setPlaybackRate) adapter.setPlaybackRate(playbackRateOf(state.playbackRate));
  }

  // Отчёт раз в секунду: позиция (только когда ролик реально идёт) и длительность, если сервер её не знает.
  setInterval(function () {
    if (!registered || !isActive) return;
    var state = lastState;
    var item = state && state.current;
    var payload = { event: 'progress', requestId: item ? item.id : '' };
    if (adapter && item && item.id === loadedId) {
      if (adapter.playing()) {
        var t = adapterPosition();
        if (t !== null && isFinite(t)) payload.position = t;
      }
      if (!item.durationSec) {
        var d = adapter.duration();
        if (d) payload.duration = d;
      }
    }
    report(payload);
  }, 1000);

  // ---------- отображение ----------

  var PLATFORM_LABELS = { youtube: 'YouTube', short: 'Shorts', tiktok: 'TikTok', clip: 'Twitch', vod: 'Twitch', vimeo: 'Vimeo', streamable: 'Streamable' };

  function chipClass(item) {
    if (item.kind === 'short') return 'short';
    return item.provider;
  }

  function chipLabel(item) {
    if (item.kind === 'short') return 'Shorts';
    if (item.provider === 'twitch') return item.kind === 'clip' ? 'Twitch · клип' : 'Twitch · запись';
    return item.providerLabel || PLATFORM_LABELS[item.provider] || item.provider;
  }

  function byLine(item) {
    var others = item.coRequesters && item.coRequesters.length ? ' <span>+' + item.coRequesters.length + '</span>' : '';
    return 'заказал <b>' + esc(item.requestedBy) + '</b>' + others;
  }

  var lastState = null;
  var stateReceivedAt = 0;

  function adapterPosition() {
    if (!adapter) return null;
    var actual = adapter.time();
    if (actual === null || !isFinite(actual)) return null;
    if (pendingSeek) {
      var elapsed = Math.max(0, Date.now() - pendingSeek.requestedAt) / 1000;
      var reached = actual >= pendingSeek.position - 1 && actual <= pendingSeek.position + elapsed + 2;
      // Until the embed acknowledges seekTo, its old time must not undo the server seek.
      if (!reached) {
        if (Date.now() - pendingSeek.lastAttemptAt >= 4000) {
          pendingSeek.lastAttemptAt = Date.now();
          seekResumeUntil = Date.now() + 4000;
          adapter.seek(pendingSeek.position);
        }
        return null;
      }
      pendingSeek = null;
      seekResumeUntil = 0;
    }
    return actual;
  }

  function playbackPosition() {
    var state = lastState;
    if (!state || !state.current) return 0;
    if (isActive && adapter && loadedId === state.current.id) {
      var actual = adapterPosition();
      if (actual !== null && isFinite(actual)) return actual;
    }
    var position = Number(state.positionSec) || 0;
    if (state.status === 'playing' && state.player && state.player.online) {
      var rate = rateSupported(state.current) ? playbackRateOf(state.playbackRate) : 1;
      position += Math.max(0, Date.now() - stateReceivedAt) / 1000 * rate;
    }
    var end = state.current.endSec || state.current.durationSec;
    return end ? Math.min(position, end) : position;
  }

  function applyState(state) {
    if (!state) return;
    // HTTP replies and socket broadcasts must advance the same playback snapshot.
    if (lastState && typeof state.seq === 'number' && typeof lastState.seq === 'number' && state.seq < lastState.seq) {
      // A newer server timestamp allows recovery after its sequence resets on restart.
      if (!(Number(state.positionAt) > Number(lastState.positionAt))) return;
    }
    if (lastState && (lastState.current && lastState.current.id) !== (state.current && state.current.id)) {
      seeking = false;
      els.progress.classList.remove('is-seeking');
    }
    lastState = state;
    stateReceivedAt = Date.now();
    var item = state.current;
    els.stage.classList.toggle('is-idle', !item);
    els.stage.classList.toggle('is-vertical', Boolean(item && item.isVertical));
    els.backdrop.style.backgroundImage = item && item.thumbnail ? 'url("' + item.thumbnail.replace(/"/g, '%22') + '")' : '';
    els.idle.hidden = Boolean(item);
    renderIdle(state);
    renderNow(state);
    renderVotes(state);
    renderWarning(state);
    renderProblem(state);
    els.toggle.classList.toggle('is-playing', state.status === 'playing');
    els.toggle.setAttribute('aria-label', state.status === 'playing' ? 'Пауза' : 'Воспроизвести');
    els.lock.setAttribute('aria-pressed', state.votes && state.votes.locked ? 'true' : 'false');
    els.loop.setAttribute('aria-pressed', state.loop ? 'true' : 'false');
    $('vq-status').textContent = !item ? 'Ожидание видео' : state.status === 'playing' ? 'Воспроизводится' : 'На паузе';
    $('vq-status-dot').classList.toggle('is-playing', Boolean(item && state.status === 'playing'));
    els.seek.disabled = !item;
    if (!item) { els.seek.value = '0'; els.seek.max = '0'; }
    els.loop.classList.toggle('is-on', Boolean(state.loop));
    els.lock.classList.toggle('is-on', Boolean(state.votes && state.votes.locked));
    els.accept.classList.toggle('is-on', Boolean(state.accepting));
    els.accept.setAttribute('aria-pressed', state.accepting ? 'true' : 'false');
    els.acceptLabel.textContent = state.accepting ? 'Приём открыт' : 'Приём закрыт';
    if (document.activeElement !== els.volume) els.volume.value = Math.max(0, Math.min(100, Number(state.volume) || 0));
    var speedOk = rateSupported(item);
    els.rate.disabled = !speedOk;
    var speedHint = speedOk ? 'Скорость воспроизведения' : 'Скорость доступна для YouTube и Vimeo';
    els.rate.title = speedHint;
    if (els.rateLabel) els.rateLabel.title = speedHint;
    if (document.activeElement !== els.rate) els.rate.value = String(playbackRateOf(state.playbackRate));
    renderQueueSub(state);
    // Активный плеер пропал (закрыли вкладку) — эта страница подхватывает воспроизведение.
    if (registered && !isActive && state.player && !state.player.online) register(false);
    syncPlayer(state);
  }

  function renderIdle(state) {
    if (state.current) return;
    var words = state.votes || {};
    if (state.accepting) {
      els.idleTitle.textContent = state.linkMode === 'command' ? 'Заказывайте видео: !video ссылка' : 'Кидайте ссылки в чат';
      els.idleText.innerHTML = 'Видео появится здесь, как только кто-то закажет. Не понравилось — пишите <b>' +
        esc(((words.skipWords || [])[0] || {}).word || 'скип') + '</b>, зашло — <b>' + esc(((words.keepWords || [])[0] || {}).word || 'оставить') + '</b>.';
    } else {
      els.idleTitle.textContent = 'Приём видео закрыт';
      els.idleText.textContent = 'Стример откроет приём заказов — тогда кидайте ссылки в чат.';
    }
    els.idlePlatforms.innerHTML = (state.platforms || []).map(function (item) {
      return '<span class="vq-chip vq-chip--' + esc(item.key) + '">' + esc(item.label) + '</span>';
    }).join('');
  }

  function renderNow(state) {
    var item = state.current;
    if (!item) {
      els.chips.innerHTML = '';
      els.title.textContent = state.accepting ? 'Ждём заказы' : 'Ничего не идёт';
      els.by.innerHTML = '';
      els.time.textContent = '';
      els.fill.style.width = '0%';
      return;
    }
    var chips = '<span class="vq-chip vq-chip--' + chipClass(item) + '">' + esc(chipLabel(item)) + '</span>';
    if (item.isPaid) chips += '<span class="vq-chip vq-chip--paid">💰 ' + esc(item.amountLabel || 'донат') + '</span>';
    if (item.isLimited) chips += '<span class="vq-chip vq-chip--limit">оплачено ' + esc(item.playLabel) + '</span>';
    if (state.votes && state.votes.locked) chips += '<span class="vq-chip vq-chip--lock">📌 досматриваем</span>';
    els.chips.innerHTML = chips;
    els.title.textContent = item.title;
    els.title.title = item.title;
    els.by.innerHTML = byLine(item) + (item.author ? ' · ' + esc(item.author) : '');
  }

  function wordsHtml(list) {
    // Смайл нагляднее слова: показываем первый смайл, а если смайлов нет — первое слово.
    var items = list || [];
    var emote = items.filter(function (entry) { return entry.url; })[0];
    return (emote ? [emote] : items.slice(0, 1)).map(function (entry) {
      return entry.url ? '<img src="' + esc(entry.url) + '" alt="' + esc(entry.word) + '" title="' + esc(entry.word) + '">' : '<span>' + esc(entry.word) + '</span>';
    }).join('');
  }

  var opensTimer = null;
  function renderVotes(state) {
    var v = state.votes || {};
    els.keepWords.innerHTML = wordsHtml(v.keepWords);
    els.skipWords.innerHTML = wordsHtml(v.skipWords);
    els.keepCount.textContent = fmtVotes(v.keep);
    els.skipCount.textContent = fmtVotes(v.skip);
    els.voteFill.style.width = Math.round((v.progress || 0) * 100) + '%';
    var off = !v.enabled || Boolean(v.blocked && v.blocked !== 'warning');
    els.vote.classList.toggle('is-off', off);
    els.vote.classList.toggle('is-hot', !off && (v.progress || 0) >= 0.7);
    els.vote.hidden = !v.enabled;
    var hint = '';
    if (v.blocked === 'paid') hint = '💰 Донатное видео — без голосования';
    else if (v.blocked === 'locked') hint = '📌 Видео закреплено — досматриваем';
    else if (v.blocked === 'idle') hint = 'Голосование начнётся с видео';
    else if (v.blocked === 'warning') hint = 'Чат решил пропустить';
    else if (v.opensAt && v.opensAt > Date.now()) hint = 'Голосование через <b>' + Math.ceil((v.opensAt - Date.now()) / 1000) + ' с</b>';
    else {
      var left = Math.max(0, Math.ceil(v.needed - (v.skip - v.keep)));
      hint = 'До скипа: <b>' + left + '</b> · пишите в чат слово или смайл';
      if (v.lockEnabled) hint += ' · закрепить: <b>+' + Math.max(0, Math.ceil(v.lockVotes - (v.keep - v.skip))) + '</b>';
    }
    els.voteHint.innerHTML = hint;
    clearTimeout(opensTimer);
    if (v.opensAt && v.opensAt > Date.now()) opensTimer = setTimeout(function () { renderVotes(lastState); }, 500);
  }

  function fmtVotes(value) {
    var n = Number(value) || 0;
    return Math.round(n * 10) / 10;
  }

  function renderWarning(state) {
    var w = state.warning;
    els.warning.hidden = !w;
    if (!w) return;
    var paid = w.reason === 'paid';
    els.warning.classList.toggle('is-paid', paid);
    els.warningTitle.textContent = paid ? 'Оплаченное время закончилось' : 'Чат пропускает видео';
    els.warningKeep.textContent = paid ? 'Досмотреть' : 'Оставить';
  }

  function renderProblem(state) {
    var problem = state.player && state.player.problem;
    els.problem.textContent = problem || '';
    els.problem.hidden = !problem || !isActive;
  }

  function renderQueueSub(state) {
    var info = state.queueInfo || { count: 0, totalSec: 0 };
    els.queueSub.textContent = info.count
      ? info.count + ' ' + plural(info.count, 'видео', 'видео', 'видео') + ' · ~' + Math.max(1, Math.round(info.totalSec / 60)) + ' мин'
      : (state.accepting ? 'Очередь пуста — ждём ссылки' : 'Очередь пуста');
  }

  function plural(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  var ICONS = {
    top: '<svg viewBox="0 0 24 24"><path d="M12 5 5 12l1.4 1.4L11 8.8V20h2V8.8l4.6 4.6L19 12z"/></svg>',
    remove: '<svg viewBox="0 0 24 24"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
    blacklist: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-7 9a7 7 0 0 1 11.3-5.5L6.5 16.3A7 7 0 0 1 5 12Zm7 7a7 7 0 0 1-4.3-1.5l9.8-9.8A7 7 0 0 1 12 19Z"/></svg>',
  };

  function renderQueue(queue) {
    var items = Array.isArray(queue) ? queue : [];
    els.empty.hidden = items.length > 0;
    $('vq-queue-count').textContent = String(items.length);
    els.list.innerHTML = items.map(function (item, index) {
      var thumb = item.thumbnail ? ' style="background-image:url(&quot;' + esc(item.thumbnail) + '&quot;)"' : '';
      var duration = item.playLabel ? '<span class="vq-item__dur">' + esc(item.playLabel) + '</span>' : '';
      var kind = item.kind === 'short' ? 'Shorts' : (item.provider !== 'youtube' ? chipLabel(item).split(' ')[0] : '');
      var paid = item.isPaid ? '<span class="vq-item__paid">💰 ' + esc(item.amountLabel || 'донат') + '</span> · ' : '';
      return '<li class="vq-item' + (item.isPaid ? ' is-paid' : '') + '" draggable="true" data-id="' + esc(item.id) + '">' +
        '<span class="vq-item__num">' + (index + 1) + '</span>' +
        '<span class="vq-item__thumb' + (item.isVertical ? ' is-vertical' : '') + '"' + thumb + '>' +
          (kind ? '<span class="vq-item__kind">' + esc(kind) + '</span>' : '') + duration + '</span>' +
        '<span class="vq-item__body"><span class="vq-item__title">' + esc(item.title) + '</span>' +
          '<span class="vq-item__by">' + paid + byLine(item) + '</span></span>' +
        '<span class="vq-item__actions">' +
          (index > 0 ? '<button type="button" data-item-action="top" title="Смотреть следующим">' + ICONS.top + '</button>' : '') +
          '<button type="button" data-item-action="remove" title="Убрать">' + ICONS.remove + '</button>' +
          '<button type="button" data-item-action="blacklist" title="В чёрный список">' + ICONS.blacklist + '</button>' +
        '</span></li>';
    }).join('');
  }

  // Перетаскивание в очереди.
  var dragId = null;
  els.list.addEventListener('dragstart', function (event) {
    var row = event.target.closest('.vq-item');
    if (!row) return;
    dragId = row.dataset.id;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  els.list.addEventListener('dragover', function (event) {
    if (!dragId) return;
    event.preventDefault();
    var row = event.target.closest('.vq-item');
    Array.prototype.forEach.call(els.list.children, function (el) { el.classList.toggle('is-drop-before', el === row && el.dataset.id !== dragId); });
  });
  els.list.addEventListener('drop', function (event) {
    if (!dragId) return;
    event.preventDefault();
    var row = event.target.closest('.vq-item');
    var ids = Array.prototype.map.call(els.list.children, function (el) { return el.dataset.id; }).filter(function (id) { return id !== dragId; });
    var at = row ? ids.indexOf(row.dataset.id) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, dragId);
    control('reorder', ids);
  });
  els.list.addEventListener('dragend', function () {
    dragId = null;
    Array.prototype.forEach.call(els.list.children, function (el) { el.classList.remove('is-dragging', 'is-drop-before'); });
  });

  els.list.addEventListener('click', function (event) {
    var button = event.target.closest('[data-item-action]');
    if (!button) return;
    var id = button.closest('.vq-item').dataset.id;
    var action = button.dataset.itemAction;
    if (action === 'blacklist') {
      if (!confirm('Добавить видео в чёрный список и убрать из очереди?')) return;
      control('blacklist', { id: id });
    } else {
      control(action, id);
    }
  });

  // ---------- прогресс ----------

  var seeking = false;
  function tick() {
    var state = lastState;
    var item = state && state.current;
    if (item) {
      var total = item.playSec || 0;
      var elapsed = seeking ? Number(els.seek.value) : Math.max(0, playbackPosition() - (item.startSec || 0));
      els.fill.style.width = (total > 0 ? Math.min(100, (elapsed / total) * 100) : 0) + '%';
      els.time.textContent = fmt(elapsed) + (total ? ' / ' + fmt(total) : '');
      if (!seeking) {
        els.seek.max = String(Math.max(0, Math.floor(total) - 1));
        els.seek.value = String(Math.floor(elapsed));
      }
    }
    var w = state && state.warning;
    if (w) {
      var total2 = Math.max(1, (w.endsAt - (w.startedAt || w.endsAt - 7000)) / 1000);
      var left = Math.max(0, (w.endsAt - Date.now()) / 1000);
      els.warningCount.textContent = String(Math.ceil(left));
      els.warningArc.style.strokeDashoffset = String(327 * (1 - Math.min(1, left / total2)));
    }
    requestAnimationFrame(tick);
  }

  els.seek.addEventListener('input', function () { seeking = true; els.progress.classList.add('is-seeking'); });
  els.seek.addEventListener('change', function () {
    var item = lastState && lastState.current;
    if (!item) { seeking = false; return; }
    control('seek', (item.startSec || 0) + Number(els.seek.value)).then(function () {
      seeking = false;
      els.progress.classList.remove('is-seeking');
    });
  });

  // ---------- кнопки и клавиши ----------

  root.addEventListener('click', function (event) {
    var button = event.target.closest('[data-action]');
    if (!button || !root.contains(button)) return;
    var action = button.dataset.action;
    // lastState обновляется и по WebSocket, и по ответам на запросы (если сокет отвалился).
    var state = lastState || {};
    if (action === 'loop') control('loop', !state.loop);
    else if (action === 'accepting') control('accepting', !state.accepting);
    else control(action);
  });

  var volumeTimer = null;
  els.volume.addEventListener('input', function () {
    if (adapter) adapter.setVolume(Number(els.volume.value));
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(function () { control('volume', Number(els.volume.value)); }, 300);
  });

  els.rate.addEventListener('change', function () {
    var rate = playbackRateOf(els.rate.value);
    els.rate.value = String(rate);
    if (adapter && adapter.setPlaybackRate) adapter.setPlaybackRate(rate);
    control('playbackRate', rate);
  });

  els.unmute.addEventListener('click', function () {
    els.unmute.hidden = true;
    var state = lastState;
    if (adapter) {
      adapter.setVolume(Math.max(0, Math.min(100, Number(state && state.volume) || 0)));
      if (state && state.status === 'playing') askPlay();
      else control('play');
    }
  });

  els.takeover.addEventListener('click', function () { register(true); });

  els.addToggle.addEventListener('click', function () {
    els.add.hidden = !els.add.hidden;
    els.addToggle.setAttribute('aria-expanded', String(!els.add.hidden));
    if (!els.add.hidden) els.addInput.focus();
  });
  els.add.addEventListener('submit', function (event) {
    event.preventDefault();
    var value = els.addInput.value.trim();
    if (!value) return;
    control('add', value).then(function (data) { if (data && data.ok !== false) els.addInput.value = ''; });
  });

  $('vq-focus').addEventListener('click', function () {
    var focused = root.classList.toggle('is-focused');
    this.setAttribute('aria-pressed', String(focused));
    this.setAttribute('aria-label', focused ? 'Показать боковую панель' : 'Скрыть боковую панель');
  });

  $('vq-fullscreen').addEventListener('click', function () {
    var action = document.fullscreenElement ? document.exitFullscreen() : els.stage.requestFullscreen && els.stage.requestFullscreen();
    if (action && action.catch) action.catch(function () { toast('Полноэкранный режим недоступен в этом браузере.', true); });
  });

  document.addEventListener('keydown', function (event) {
    if (event.target.closest('input, textarea, select, button, a, [contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
    var state = lastState || {};
    var item = state.current;
    if (event.code === 'Space') { event.preventDefault(); control('toggle'); }
    else if (event.code === 'KeyN') control('skip');
    else if (event.code === 'KeyL') control('lock');
    else if (event.code === 'Escape' && state.warning) control('cancelWarning');
    else if ((event.code === 'ArrowRight' || event.code === 'ArrowLeft') && item) {
      event.preventDefault();
      control('seek', playbackPosition() + (event.code === 'ArrowRight' ? 10 : -10));
    }
  });

  // ---------- старт ----------

  var online = false;
  var refreshPending = false;
  setInterval(function () {
    if (online || refreshPending) return;
    refreshPending = true;
    client.refresh().finally(function () { refreshPending = false; });
  }, 3000);

  var initial = window.__VQ_INITIAL__ || null;
  var client = MusicClient.connect({
    namespace: 'video',
    stateUrl: '/admin/video/api/state',
    initial: initial,
    websocketPort: root.dataset.wsPort,
    onState: applyState,
    onQueue: renderQueue,
    onConnection: function (connected) { online = connected; els.ws.classList.toggle('is-on', connected); els.ws.title = connected ? 'Связь с сервером установлена' : 'Переподключение к серверу'; els.ws.setAttribute('aria-label', els.ws.title); },
  });

  if (initial && initial.queue) renderQueue(initial.queue);
  register(true);
  requestAnimationFrame(tick);
})();
