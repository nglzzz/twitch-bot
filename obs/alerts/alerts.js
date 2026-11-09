// Алерты донатов. Бот присылает готовый алерт (вид из StreamElements + «родная» озвучка сервиса),
// страница его проигрывает и сообщает боту, что закончила. Очередь, пауза и пропуски — на стороне бота.
(function (D) {
  'use strict';

  const cfg = D.config || {};
  const root = document.getElementById('alert');
  const mediaBox = document.getElementById('media');
  const titleBox = document.getElementById('title');
  const messageBox = document.getElementById('message');
  const MAX_ALERT_MS = 3 * 60 * 1000;
  const MAX_VOICE_MS = 2 * 60 * 1000;
  const FADE_MS = 350;
  const loadedFonts = new Set(['Nunito']);
  let playing = null;
  let bot = null;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));

  function loadFont(family) {
    if (!family || loadedFonts.has(family) || /^(sans-serif|serif|monospace|system-ui)$/i.test(family)) return;
    loadedFonts.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700;800&display=swap`;
    document.head.appendChild(link);
  }

  function styleText(node, s) {
    node.style.fontFamily = `'${s.fontFamily}', 'Nunito', sans-serif`;
    node.style.fontSize = `${s.fontSize}px`;
    if (s.fontWeight) node.style.fontWeight = s.fontWeight;
    node.style.color = s.color;
    node.style.textShadow = s.textShadow || 'none';
    node.style.textAlign = s.align || 'center';
  }

  /** Картинка/видео алерта; ждём, пока можно показывать, но не дольше 4 секунд. */
  function makeMedia(src, type, volume) {
    if (!src) return { node: null, ready: Promise.resolve(), play() {}, stop() {}, ended: Promise.resolve() };
    if (type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(src)) {
      const v = document.createElement('video');
      v.src = src;
      v.preload = 'auto';
      v.playsInline = true;
      v.volume = clamp01(volume);
      const ready = new Promise((resolve) => { v.addEventListener('canplay', resolve, { once: true }); v.addEventListener('error', resolve, { once: true }); });
      const ended = new Promise((resolve) => { v.addEventListener('ended', resolve, { once: true }); v.addEventListener('error', resolve, { once: true }); });
      return {
        node: v,
        ready: Promise.race([ready, wait(4000)]),
        play() { v.play().catch(() => {}); },
        stop() { v.pause(); v.removeAttribute('src'); v.load(); },
        ended,
      };
    }
    const img = new Image();
    img.src = src;
    const ready = new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
    return { node: img, ready: Promise.race([ready, wait(4000)]), play() {}, stop() {}, ended: Promise.resolve() };
  }

  /** Озвучку начинаем качать сразу: SE генерирует её до 10 секунд. */
  function prepareSound(url) {
    const a = new Audio();
    a.preload = 'auto';
    a.src = url;
    return a;
  }

  function playSound(source, volume, alive) {
    return new Promise((resolve) => {
      if (!source || !alive()) { resolve(); return; }
      const a = typeof source === 'string' ? new Audio(source) : source;
      a.volume = clamp01(volume);
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(cap); a.pause(); resolve(); };
      const cap = setTimeout(finish, MAX_VOICE_MS);
      a.addEventListener('ended', finish);
      a.addEventListener('error', finish);
      a.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(a.duration) && a.duration > 0) { clearTimeout(cap); setTimeout(finish, a.duration * 1000 + 3000); }
      });
      if (playing && !playing.sounds.includes(a)) playing.sounds.push(a);
      a.play().catch(finish);
    });
  }

  function render(alert) {
    const view = alert.view;
    root.className = `alert alert--${view.layout === 'row' ? 'row' : 'column'} anim-${view.text.animation || 'none'}`;
    titleBox.textContent = '';
    for (const part of alert.title) {
      const span = document.createElement('span');
      span.textContent = part.text;
      if (part.hl) { span.className = 'hl'; span.style.color = view.text.title.highlight; }
      titleBox.appendChild(span);
    }
    styleText(titleBox, view.text.title);
    titleBox.style.marginTop = `${view.text.title.marginTop || 0}px`;
    messageBox.textContent = view.showMessage ? alert.message : '';
    styleText(messageBox, view.text.message);
    loadFont(view.text.title.fontFamily);
    loadFont(view.text.message.fontFamily);
  }

  async function play(alert) {
    const state = { id: alert.id, stopped: false, sounds: [], media: null };
    playing = state;
    const alive = () => !state.stopped && playing === state;
    const view = alert.view;

    render(alert);
    const voices = (alert.media || []).filter((m) => m.url).map((m) => prepareSound(m.url));
    state.sounds.push(...voices);
    const graphics = alert.video ? { src: alert.video, type: 'video', volume: 1 } : view.graphics;
    state.media = makeMedia(graphics && graphics.src, graphics && graphics.type, graphics ? graphics.volume : 1);
    mediaBox.textContent = '';
    if (state.media.node) mediaBox.appendChild(state.media.node);
    await state.media.ready;
    if (!alive()) return;

    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('is-shown'));
    state.media.play();
    if (view.audio && view.audio.src) playSound(view.audio.src, view.audio.volume, alive);

    const minShown = wait(view.duration * 1000);
    const spoken = (async () => {
      if (alert.video) await state.media.ended; // видеосообщение — сначала оно
      await wait(Math.min(view.tts.delay || 0, view.duration) * 1000);
      for (const voice of voices) {
        if (!alive()) return;
        await playSound(voice, (alert.ttsVolume ?? 0.75) * (cfg.voiceVolume ?? 1), alive);
      }
    })();
    await Promise.race([Promise.all([minShown, spoken]), wait(MAX_ALERT_MS)]);
    if (!alive()) return;
    await hide(state);
    if (bot) bot.send({ type: 'alerts:done', id: alert.id });
  }

  async function hide(state) {
    root.classList.remove('is-shown');
    await wait(FADE_MS);
    state.sounds.forEach((a) => a.pause());
    if (state.media) state.media.stop();
    if (playing === state) { playing = null; root.hidden = true; mediaBox.textContent = ''; }
  }

  function stop(id) {
    if (!playing || (id && playing.id !== id)) return;
    const state = playing;
    state.stopped = true;
    hide(state);
  }

  // Видео вариаций качаем заранее по одному, чтобы алерт показывался сразу, а не ждал загрузки.
  const preloaded = new Set();
  async function preload(urls) {
    for (const url of urls) {
      if (preloaded.has(url)) continue;
      preloaded.add(url);
      try { await fetch(url, { mode: 'no-cors', cache: 'force-cache' }); } catch (e) { preloaded.delete(url); }
    }
  }

  function onMessage(m) {
    if (m.type === 'alerts:play' && m.alert) {
      if (playing && playing.id === m.alert.id) return; // бот переслал текущий после переподключения
      if (playing) stop();
      play(m.alert).catch(() => { if (bot) bot.send({ type: 'alerts:done', id: m.alert.id }); });
    } else if (m.type === 'alerts:stop') {
      stop(m.id);
    } else if (m.type === 'alerts:preload' && Array.isArray(m.urls)) {
      preload(m.urls);
    }
  }

  D.alerts = { play: (alert) => onMessage({ type: 'alerts:play', alert }), stop };

  // #ws=ws://localhost:8099 — проверка с тестовым ботом.
  const wsOverride = (location.hash.match(/[#&]ws=([^&]+)/) || [])[1];
  if (wsOverride) cfg.websocket = decodeURIComponent(wsOverride);

  if (/(^|[#&])demo\b/.test(location.hash)) {
    demo();
  } else {
    bot = D.connectBot({ onOpen: () => bot.send({ type: 'alerts:hello' }), onMessage });
  }

  // #demo — проверка вида без бота: пара алертов по кругу.
  function demo() {
    const view = (graphics, template) => ({
      duration: 6, layout: 'column', showMessage: true, graphics, audio: null,
      tts: { enabled: true, voice: 'Tatyana', volume: 0.75, minAmount: 0, announce: true, delay: 0 },
      text: {
        template, animation: 'pulse',
        title: { fontFamily: 'Nunito', fontSize: 30, fontWeight: 'bold', color: '#ffffff', textShadow: 'rgba(0, 0, 0, 0.8) 1px 1px 1px', align: 'center', marginTop: 20, highlight: 'rgb(106, 111, 252)' },
        message: { fontFamily: 'Nunito', fontSize: 16, color: '#ffffff', textShadow: 'rgba(0, 0, 0, 0.8) 1px 1px 1px', align: 'center' },
      },
    });
    const samples = [
      { name: 'Бабка_Зина', amount: '150', message: 'Внучок, держи на пирожки. И шапку надень!', graphics: { src: 'https://cdn.streamelements.com/uploads/0c0d02cd-ed57-4ffe-b9c1-4ca88e1d47ba.mp4', type: 'video', volume: 0.6 } },
      { name: 'Шейх Валера', amount: '1000', message: 'За стрим!', graphics: { src: 'https://cdn.streamelements.com/uploads/8927f333-61e1-4124-b6e6-884e16d267f7.mp4', type: 'video', volume: 0.6 } },
    ];
    let i = 0;
    const next = () => {
      const s = samples[i++ % samples.length];
      const alert = {
        id: `demo-${i}`, view: view(s.graphics, '{name} занёс {currency}{amount} стримеру!'), message: s.message, media: [], ttsVolume: 0.75,
        title: [{ text: s.name, hl: true }, { text: ' занёс ' }, { text: `₽${s.amount}`, hl: true }, { text: ' стримеру!' }],
      };
      play(alert).then(() => setTimeout(next, 1500));
    };
    next();
  }
})(window.Dvor = window.Dvor || {});
