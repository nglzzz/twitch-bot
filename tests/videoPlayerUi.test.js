'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(ROOT, 'src/views/pages/admin-video.handlebars'), 'utf8');
const musicClientSource = fs.readFileSync(path.join(ROOT, 'public/js/music-client.js'), 'utf8');
const playerSource = fs.readFileSync(process.env.VIDEO_PLAYER_SOURCE || path.join(ROOT, 'public/js/video-player.js'), 'utf8');

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = Object.create(null);
    this.attributes = Object.create(null);
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
    this.className = '';
    this.classList = {
      toggle: (name, force) => this.toggleClass(name, force),
      add: (name) => this.toggleClass(name, true),
      remove: (name) => this.toggleClass(name, false),
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.max = '';
    this.textContent = '';
    this.innerHTML = '';
  }

  toggleClass(name, force) {
    const names = new Set(this.className.split(/\s+/).filter(Boolean));
    if (force) names.add(name); else names.delete(name);
    this.className = [...names].join(' ');
  }

  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener({ preventDefault() {}, target: this, ...event });
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() {}
  contains() { return true; }
  closest(selector) { return selector.indexOf('data-action') >= 0 && this.dataset.action ? this : null; }
}

function createHarness(initialState = idleState(), registerState = null, harnessOptions = {}) {
  let now = 10_000;
  const clock = { timeouts: [], intervals: [], frames: [] };
  const requests = [];
  const elements = Object.fromEntries([...template.matchAll(/id="([^"]+)"/g)].map(([_, id]) => [id, new MockElement()]));
  const root = elements.vq;
  root.dataset = { csrf: 'csrf-video-test', wsPort: '28081', settingsUrl: '/admin/video/settings' };
  let socket;
  let youtube;
  let serverState = structuredClone(initialState);
  let registrationState = registerState ? structuredClone(registerState) : null;
  const queue = [];
  const youtubePlayers = [];

  class FakeSocket {
    constructor() { this.listeners = Object.create(null); socket = this; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    emit(type, data) { for (const callback of this.listeners[type] || []) callback(data); }
  }

  class FakeYouTubePlayer {
    constructor(_target, options) {
      this.options = options;
      this.time = 0;
      this.timeAt = now;
      this.running = false;
      this.pauseCalls = 0;
      this.seekCalls = [];
      this.delaySeek = false;
      this.pendingSeek = null;
      this.delayLoad = Boolean(harnessOptions.delayYoutubeLoad);
      this.pendingLoad = null;
      this.queuedPlay = false;
      this.videoId = null;
      youtube = this;
      youtubePlayers.push(this);
      queueMicrotask(() => options.events.onReady());
    }
    beginLoad(videoId, startSeconds, play) {
      this.videoId = videoId;
      this.pendingLoad = { videoId, startSeconds, play };
      this.time = startSeconds;
      this.timeAt = now;
      this.running = false;
      if (!this.delayLoad) this.resolveLoad();
    }
    loadVideoById({ videoId, startSeconds = 0 }) { this.beginLoad(videoId, startSeconds, true); }
    cueVideoById({ videoId, startSeconds = 0 }) { this.beginLoad(videoId, startSeconds, false); }
    resolveLoad() {
      assert.ok(this.pendingLoad, 'a YouTube load is pending');
      const pending = this.pendingLoad;
      this.pendingLoad = null;
      this.videoId = pending.videoId;
      this.time = pending.startSeconds;
      this.timeAt = now;
      this.running = pending.play || this.queuedPlay;
      this.queuedPlay = false;
      this.options.events.onStateChange({ data: this.running ? 1 : 5 });
    }
    playVideo() {
      this.playCalls = (this.playCalls || 0) + 1;
      if (this.pendingLoad) { this.queuedPlay = true; return; }
      this.time = this.getCurrentTime(); this.timeAt = now; this.running = true; this.options.events.onStateChange({ data: 1 });
    }
    pauseVideo() { this.pauseCalls += 1; this.time = this.getCurrentTime(); this.timeAt = now; this.running = false; this.options.events.onStateChange({ data: 2 }); }
    nativePlay() { this.timeAt = now; this.running = true; this.options.events.onStateChange({ data: 1 }); }
    nativePause() { this.time = this.getCurrentTime(); this.timeAt = now; this.running = false; this.options.events.onStateChange({ data: 2 }); }
    emitState(data) { this.running = data === 1; this.options.events.onStateChange({ data }); }
    seekTo(seconds) {
      this.seekCalls.push({ seconds, wasPlaying: this.running });
      if (this.delaySeek) {
        this.pendingSeek = seconds;
        return;
      }
      this.time = seconds;
      this.timeAt = now;
    }
    resolveSeek({ paused = false } = {}) {
      assert.notEqual(this.pendingSeek, null, 'a seek is pending');
      this.time = this.pendingSeek;
      this.timeAt = now;
      this.pendingSeek = null;
      this.running = !paused;
      this.options.events.onStateChange({ data: paused ? 2 : 1 });
    }
    getCurrentTime() { return this.time + (this.running ? (now - this.timeAt) / 1000 : 0); }
    getDuration() { return 600; }
    getPlayerState() { return this.running ? 1 : 2; }
    setVolume() {}
    setPlaybackRate(rate) {
      this.playbackRate = rate;
      if (!this.pauseOnRate) return;
      this.pendingPause = () => {
        this.running = false;
        this.options.events.onStateChange({ data: 2 });
      };
      if (this.pauseOnRate !== 'async') this.pendingPause();
    }
    getPlaybackRate() { return this.lagRate ? 1 : (this.playbackRate || 1); }
    unMute() {}
    destroy() { this.running = false; }
  }
  const YT = { Player: FakeYouTubePlayer };
  const window = {
    YT,
    location: { protocol: 'http:', hostname: 'localhost', host: 'localhost' },
    addEventListener() {},
    confirm: () => true,
  };
  const document = {
    activeElement: null,
    fullscreenElement: null,
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: (tag) => new MockElement(tag),
    createElementNS: (_namespace, tag) => new MockElement(tag),
    head: { appendChild() {} },
  };
  const fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, body });
    let response;
    if (url.endsWith('/player/register')) {
      const registeredState = structuredClone(registrationState || serverState);
      registeredState.player = { online: true, activeId: body.playerId, problem: null };
      registeredState.seq += 1;
      serverState = structuredClone(registeredState);
      response = { ok: true, state: registeredState, queue };
    } else if (url.endsWith('/control')) {
      if (body.action === 'play' || (body.action === 'toggle' && serverState.status !== 'playing')) {
        if (serverState.status !== 'playing') { serverState.status = 'playing'; serverState.seq += 1; serverState.playbackSeq += 1; }
      } else if (body.action === 'pause' || (body.action === 'toggle' && serverState.status === 'playing')) {
        if (serverState.status !== 'paused') { serverState.status = 'paused'; serverState.seq += 1; serverState.playbackSeq += 1; }
      }
      if (body.action === 'seek') {
        serverState.positionSec = body.value;
        serverState.seekSeq += 1;
        serverState.playbackSeq += 1;
        serverState.seq += 1;
      }
      if (body.action === 'playbackRate') serverState.playbackRate = body.value;
      response = { ok: true, state: structuredClone(serverState), queue };
    } else if (url.endsWith('/player/report')) {
      if (['playing', 'paused'].includes(body.event) && serverState.current && body.requestId === serverState.current.id && body.playbackSeq === serverState.playbackSeq) {
        serverState.status = body.event;
        serverState.positionSec = body.position;
        serverState.seq += 1;
        serverState.playbackSeq += 1;
        response = { ok: true, active: true, state: structuredClone(serverState) };
      } else {
        response = { ok: true, active: true };
      }
    } else {
      response = { state: structuredClone(serverState), queue };
    }
    return { ok: true, status: 200, json: async () => response };
  };
  class FakeDate extends Date { static now() { return now; } }
  const sandbox = {
    document, window, location: window.location, YT, WebSocket: FakeSocket, fetch, Date: FakeDate,
    setTimeout: (callback, delay) => { clock.timeouts.push({ callback, delay }); return clock.timeouts.length; },
    clearTimeout() {},
    setInterval: (callback, delay) => { clock.intervals.push({ callback, delay }); return clock.intervals.length; },
    clearInterval() {},
    requestAnimationFrame: (callback) => { clock.frames.push(callback); return clock.frames.length; },
    isFinite,
    console,
    confirm: () => true,
  };
  vm.runInNewContext(musicClientSource, sandbox, { filename: 'music-client.js' });
  window.MusicClient = window.MusicClient || sandbox.MusicClient;
  sandbox.MusicClient = window.MusicClient;
  window.__VQ_INITIAL__ = { state: structuredClone(initialState), queue };
  vm.runInNewContext(playerSource, sandbox, { filename: 'video-player.js' });

  return {
    elements, requests, clock,
    get serverState() { return serverState; },
    setServerState(next) { const value = structuredClone(next); if (value.player && !value.player.activeId && serverState.player && serverState.player.activeId) value.player = structuredClone(serverState.player); serverState = value; },
    setRegistrationState(next) { serverState = structuredClone(next); registrationState = structuredClone(next); },
    get youtube() { return youtube; },
    youtubePlayers,
    get socket() { return socket; },
    advance(ms) { now += ms; },
    frame() { const callback = clock.frames.shift(); assert.ok(callback, 'animation frame was scheduled'); callback(); },
    tickProgress() { const timer = clock.intervals.find((item) => item.delay === 1000); assert.ok(timer, 'progress timer was scheduled'); timer.callback(); },
    broadcastState(next) {
      serverState = structuredClone(next);
      socket.emit('message', { data: JSON.stringify({ type: 'video:state', state: structuredClone(next) }) });
    },
  };
}

function idleState() {
  return { status: 'stopped', current: null, positionSec: 0, positionAt: 10_000, volume: 80, accepting: true, loop: false, seekSeq: 0, playbackSeq: 0, seq: 0, votes: { enabled: true, skipWords: [], keepWords: [] }, player: { online: false, activeId: null }, queueInfo: { count: 0, totalSec: 0 } };
}

function playingState(overrides = {}) {
  return {
    ...idleState(),
    status: 'playing',
    positionSec: 30,
    positionAt: 10_000,
    seq: 4,
    current: { id: 'request-1', provider: 'youtube', externalId: 'abcdefghijk', title: 'Test video', requestedBy: 'viewer', startSec: 30, durationSec: 600, endSec: 150, playSec: 120, isPaid: false, isVertical: false },
    player: { online: true, activeId: null },
    ...overrides,
  };
}

async function settle() { await new Promise((resolve) => setImmediate(resolve)); await Promise.resolve(); await new Promise((resolve) => setImmediate(resolve)); }

// A fresh player registration can return a playing request after the page rendered idle.
test('registration snapshot drives the progress bar and progress reports', async () => {
  const harness = createHarness(idleState(), playingState());
  await settle();
  await settle();
  assert.ok(harness.youtube, 'YouTube adapter created from registration response; requests=' + JSON.stringify(harness.requests));
  harness.advance(2_000);
  harness.frame();
  assert.equal(harness.elements['vq-time'].textContent, '0:02 / 2:00');
  assert.equal(harness.elements['vq-fill'].style.width, '1.6666666666666667%');
  harness.tickProgress();
  await settle();
  const report = harness.requests.find((entry) => entry.url.endsWith('/player/report'));
  assert.equal(report.body.requestId, 'request-1');
  assert.equal(report.body.position, 32);
});

// Playing and seeking must use the freshest state returned by the control API.
test('play and seek preserve the playing state returned by the server', async () => {
  const harness = createHarness(playingState({ status: 'paused', seq: 4 }));
  harness.setServerState(playingState({ status: 'paused', seq: 4 }));
  await settle();
  await settle();
  assert.ok(harness.youtube);
  const pauseCalls = harness.youtube.pauseCalls;

  harness.elements['vq-toggle'].dataset.action = 'toggle';
  harness.elements.vq.dispatch('click', { target: harness.elements['vq-toggle'] });
  await settle();
  assert.equal(harness.serverState.status, 'playing', JSON.stringify(harness.requests));
  assert.equal(harness.requests.some((entry) => entry.body?.action === 'toggle'), true);

  harness.elements['vq-seek'].value = '45';
  harness.elements['vq-seek'].dispatch('change');
  await settle();
  assert.equal(harness.requests.filter((entry) => entry.body?.action === 'seek').at(-1).body.value, 75);
  assert.equal(harness.serverState.status, 'playing');
  assert.equal(harness.youtube.running, true, 'a seek must leave the embedded video playing');
  assert.equal(harness.youtube.pauseCalls, pauseCalls, 'a seek must not issue a pause to the embedded player');
});

// HTTP snapshots may overtake the socket; an older one must not undo a seek/play.
test('an older WebSocket state cannot undo a newer seek or pause the video', async () => {
  const initial = playingState({ status: 'paused', seq: 2 });
  const harness = createHarness(initial);
  harness.setServerState(playingState({ status: 'paused', seq: 2 }));
  await settle();
  await settle();
  const id = harness.requests.find((entry) => entry.url.endsWith('/player/register')).body.playerId;
  harness.setServerState(playingState({ status: 'playing', positionSec: 90, seq: 5, seekSeq: 1, player: { online: true, activeId: id } }));
  await harness.elements['vq-seek'].dispatch('input');
  harness.elements['vq-seek'].value = '60';
  await harness.elements['vq-seek'].dispatch('change');
  await settle();
  const seekCallsAfterFreshState = harness.youtube.seekCalls.length;
  const pauseCallsAfterFreshState = harness.youtube.pauseCalls;

  for (const seq of [4, 0]) {
    harness.socket.emit('message', { data: JSON.stringify({ type: 'video:state', state: playingState({ status: 'paused', positionSec: 50, positionAt: 9_000, seq, seekSeq: 0, player: { online: true, activeId: id } }) }) });
  }
  assert.equal(harness.youtube.seekCalls.length, seekCallsAfterFreshState, 'older seek sequence ignored');
  assert.equal(harness.youtube.pauseCalls, pauseCallsAfterFreshState, 'older paused status ignored');
});


test('a delayed YouTube seek ignores its old time and resumes if the embed pauses', async () => {
  const harness = createHarness(playingState({ status: 'playing', seq: 4 }));
  harness.setServerState(playingState({ status: 'playing', seq: 4 }));
  await settle();
  await settle();
  assert.ok(harness.youtube);
  harness.youtube.delaySeek = true;
  harness.elements['vq-seek'].value = '60';
  harness.elements['vq-seek'].dispatch('change');
  await settle();
  assert.equal(harness.serverState.status, 'playing');
  assert.equal(harness.youtube.running, true, 'embedded playback continues while the seek is pending');

  harness.advance(1_000);
  harness.tickProgress();
  await settle();
  const pendingReport = harness.requests.filter((entry) => entry.url.endsWith('/player/report')).at(-1);
  assert.equal(pendingReport.body.requestId, 'request-1');
  assert.equal(Object.hasOwn(pendingReport.body, 'position'), false, 'old embed time cannot overwrite the seek target');

  harness.youtube.resolveSeek({ paused: true });
  assert.equal(harness.youtube.running, true, 'player resumes after the embed reports the delayed paused state');
  assert.equal(harness.youtube.getCurrentTime(), 90);
  assert.equal(harness.serverState.status, 'playing', 'playing server state is preserved');
});


test('seeking a paused YouTube video keeps it paused', async () => {
  const harness = createHarness(playingState({ status: 'paused', seq: 4 }));
  harness.setServerState(playingState({ status: 'paused', seq: 4 }));
  await settle();
  await settle();
  assert.ok(harness.youtube);
  harness.youtube.delaySeek = true;
  harness.elements['vq-seek'].value = '60';
  harness.elements['vq-seek'].dispatch('change');
  await settle();
  harness.youtube.resolveSeek({ paused: true });
  assert.equal(harness.youtube.running, false, 'a paused video stays paused after seeking');
  assert.equal(harness.serverState.status, 'paused');
});

test('a slow seek never reports the old position with its new sequence', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  harness.youtube.delaySeek = true;
  harness.elements['vq-seek'].value = '60';
  harness.elements['vq-seek'].dispatch('change');
  await settle();
  // Some embeds keep reporting PLAYING and their previous clock until seek finishes.
  harness.youtube.running = true;
  harness.advance(5_000);
  harness.tickProgress();
  await settle();
  const report = harness.requests.filter((entry) => entry.url.endsWith('/player/report')).at(-1);
  assert.equal(report.body.seekSeq, harness.serverState.seekSeq);
  assert.equal(Object.hasOwn(report.body, 'position'), false);
  assert.equal(harness.serverState.positionSec, 90);
});

test('playback rate is applied to YouTube and disabled without a video', async () => {
  const idle = createHarness(idleState());
  await settle();
  assert.equal(idle.elements['vq-rate'].disabled, true);

  const harness = createHarness(playingState());
  await settle();
  await settle();
  assert.equal(harness.elements['vq-rate'].disabled, false);
  assert.equal(harness.elements['vq-rate'].value, '1');
  harness.elements['vq-rate'].value = '1.5';
  harness.elements['vq-rate'].dispatch('change');
  await settle();
  assert.equal(harness.youtube.playbackRate, 1.5);
  const saved = harness.requests.find((entry) => entry.url.endsWith('/control') && entry.body.action === 'playbackRate');
  assert.equal(saved.body.value, 1.5);
  assert.equal(harness.elements['vq-rate'].value, '1.5');
});

test('a YouTube pause caused by changing speed is resumed and not saved', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  assert.equal(harness.youtube.running, true);
  harness.youtube.pauseOnRate = 'async';
  harness.youtube.lagRate = true;
  harness.elements['vq-rate'].value = '1.5';
  harness.elements['vq-rate'].dispatch('change');
  await settle();
  assert.equal(typeof harness.youtube.pendingPause, 'function');
  harness.youtube.pendingPause();
  for (let i = 0; i < 5; i += 1) {
    const pending = harness.clock.timeouts.splice(0);
    for (const timer of pending) timer.callback();
  }
  assert.equal(harness.youtube.playbackRate, 1.5);
  assert.equal(harness.youtube.running, true, 'embed must keep playing after setPlaybackRate pauses it');
  const paused = harness.requests.filter((entry) => entry.url.endsWith('/player/report') && entry.body.event === 'paused');
  assert.equal(paused.length, 0);
});

test('native YouTube play and pause update the server snapshot and page controls', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  assert.equal(harness.serverState.status, 'playing');

  harness.youtube.nativePause();
  await settle();
  let change = harness.requests.filter((entry) => entry.url.endsWith('/player/report') && entry.body.event === 'paused').at(-1);
  assert.ok(change, 'native pause is reported to the server');
  assert.equal(change.body.requestId, 'request-1');
  assert.equal(change.body.position, 30);
  assert.equal(change.body.seekSeq, 0);
  assert.equal(change.body.playbackSeq, 0);
  assert.equal(change.body.seq, undefined, 'playback reports do not depend on unrelated state broadcasts');
  assert.equal(harness.serverState.status, 'paused');
  assert.equal(harness.elements['vq-toggle'].classList.contains('is-playing'), false);
  assert.equal(harness.elements['vq-toggle'].getAttribute('aria-label'), 'Воспроизвести');

  harness.youtube.nativePlay();
  await settle();
  change = harness.requests.filter((entry) => entry.url.endsWith('/player/report') && entry.body.event === 'playing').at(-1);
  assert.ok(change, 'native play is reported to the server');
  assert.equal(change.body.requestId, 'request-1');
  assert.equal(change.body.seekSeq, 0);
  assert.equal(harness.serverState.status, 'playing');
  assert.equal(harness.elements['vq-toggle'].classList.contains('is-playing'), true);
  assert.equal(harness.elements['vq-toggle'].getAttribute('aria-label'), 'Пауза');
});

test('server-issued YouTube load, pause, and play events are not echoed as native changes', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  const playerId = harness.requests.find((entry) => entry.url.endsWith('/player/register')).body.playerId;

  harness.broadcastState(playingState({ status: 'paused', seq: 5, playbackSeq: 1, player: { online: true, activeId: playerId } }));
  harness.broadcastState(playingState({ status: 'playing', seq: 6, playbackSeq: 2, player: { online: true, activeId: playerId } }));
  await settle();

  const playbackReports = harness.requests.filter((entry) => entry.url.endsWith('/player/report') && ['playing', 'paused'].includes(entry.body.event));
  assert.deepEqual(playbackReports, [], 'server state changes and their embed callbacks are not reported back');
  assert.equal(harness.serverState.status, 'playing');
});

test('a native pause survives an unrelated newer state broadcast and its reply keeps the video paused', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  const playerId = harness.requests.find((entry) => entry.url.endsWith('/player/register')).body.playerId;

  harness.youtube.nativePause();
  harness.broadcastState(playingState({ seq: 5, playbackSeq: harness.serverState.playbackSeq, player: { online: true, activeId: playerId } }));
  await settle();

  const change = harness.requests.find((entry) => entry.url.endsWith('/player/report') && entry.body.event === 'paused');
  assert.ok(change, 'the native pause report is accepted after a vote-only state update');
  assert.equal(change.body.playbackSeq, 0);
  assert.equal(harness.serverState.status, 'paused');
  assert.equal(harness.elements['vq-toggle'].classList.contains('is-playing'), false);
  assert.equal(harness.youtube.running, false, 'the HTTP reply does not restart the native pause');
});

test('an autoplay load that reports a transient pause keeps the next queued video playing', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  const player = harness.youtube;
  assert.equal(player.running, true, 'the current item is already playing');
  const playsBeforeLoad = player.playCalls || 0;
  player.delayLoad = true;

  const playerId = harness.requests.find((entry) => entry.url.endsWith('/player/register')).body.playerId;
  const next = playingState({
    seq: 5,
    playbackSeq: 1,
    positionSec: 0,
    current: { ...playingState().current, id: 'request-2', externalId: 'lmnopqrstuv', title: 'Next video' },
    player: { online: true, activeId: playerId },
  });
  harness.broadcastState(next);
  assert.ok(player.pendingLoad, 'the next autoplay load is delayed');
  assert.ok(player.playCalls > playsBeforeLoad, 'the next item requests play before the asynchronous load emits a new state');
  player.emitState(2);
  await settle();

  const prematurePause = harness.requests.find((entry) => entry.url.endsWith('/player/report') && entry.body.event === 'paused');
  assert.equal(prematurePause, undefined, 'the not-yet-started item cannot turn an embed loading pause into a user pause');
  assert.equal(harness.serverState.status, 'playing');

  player.resolveLoad();
  await settle();
  assert.equal(player.running, true, 'the queued next video starts when its delayed load completes');
  assert.equal(harness.serverState.status, 'playing');
});

test('native playback from a paused item enables autoplay for the next item', async () => {
  const harness = createHarness(playingState({ status: 'paused', seq: 4 }));
  await settle();
  await settle();
  assert.equal(harness.youtube.running, false, 'the initial item follows the server pause');

  harness.youtube.nativePlay();
  await settle();
  assert.equal(harness.serverState.status, 'playing', 'native playback clears the server pause');

  const playerId = harness.requests.find((entry) => entry.url.endsWith('/player/register')).body.playerId;
  const next = playingState({
    seq: harness.serverState.seq + 1,
    playbackSeq: harness.serverState.playbackSeq + 1,
    positionSec: 0,
    current: { ...playingState().current, id: 'request-2', externalId: 'lmnopqrstuv', title: 'Next video' },
    player: { online: true, activeId: playerId },
  });
  harness.broadcastState(next);

  assert.equal(harness.youtube.videoId, 'lmnopqrstuv');
  assert.equal(harness.youtube.running, true, 'the next item starts automatically after a native play');
  assert.equal(harness.serverState.status, 'playing');
});

test('late playback callbacks from a replaced YouTube adapter are ignored', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  const oldPlayer = harness.youtube;
  const playerId = harness.requests.find((entry) => entry.url.endsWith('/player/register')).body.playerId;
  const next = playingState({
    seq: 5,
    playbackSeq: 1,
    current: { ...playingState().current, id: 'request-2', provider: 'twitch', kind: 'clip', externalId: 'clip-id', title: 'Twitch clip' },
    player: { online: true, activeId: playerId },
  });
  harness.broadcastState(next);

  oldPlayer.nativePause();
  await settle();
  const stalePause = harness.requests.find((entry) => entry.url.endsWith('/player/report') && entry.body.event === 'paused');
  assert.equal(stalePause, undefined, 'an old iframe cannot pause the replacement item');
  assert.equal(harness.serverState.status, 'playing');
  assert.equal(harness.elements['vq-toggle'].classList.contains('is-playing'), true);
});

test('rapid native pause and play reports both transitions in order', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();

  harness.youtube.nativePause();
  harness.youtube.nativePlay();
  await settle();

  const transitions = harness.requests
    .filter((entry) => entry.url.endsWith('/player/report') && ['playing', 'paused'].includes(entry.body.event))
    .map((entry) => entry.body.event);
  assert.deepEqual(transitions, ['paused', 'playing']);
  assert.equal(harness.serverState.status, 'playing');
  assert.equal(harness.elements['vq-toggle'].classList.contains('is-playing'), true);
});

test('a native pause immediately after speed-change recovery is not swallowed', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  harness.youtube.pauseOnRate = true;
  harness.elements['vq-rate'].value = '1.5';
  harness.elements['vq-rate'].dispatch('change');
  await settle();
  assert.equal(harness.youtube.running, true, 'playback resumes after the speed change');

  harness.youtube.nativePause();
  await settle();
  assert.ok(harness.requests.some((entry) => entry.url.endsWith('/player/report') && entry.body.event === 'paused'));
  assert.equal(harness.serverState.status, 'paused');
});

test('a native pause immediately after a completed seek is not swallowed', async () => {
  const harness = createHarness(playingState());
  await settle();
  await settle();
  harness.elements['vq-seek'].value = '45';
  harness.elements['vq-seek'].dispatch('change');
  await settle();
  harness.tickProgress();
  await settle();

  harness.youtube.nativePause();
  await settle();
  assert.ok(harness.requests.some((entry) => entry.url.endsWith('/player/report') && entry.body.event === 'paused'));
  assert.equal(harness.serverState.status, 'paused');
});
