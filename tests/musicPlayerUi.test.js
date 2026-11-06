'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const adminTemplate = fs.readFileSync(path.join(ROOT, 'src/views/pages/admin-music.handlebars'), 'utf8');
const publicTemplate = fs.readFileSync(path.join(ROOT, 'src/views/pages/music.handlebars'), 'utf8');
const realMusicClient = (() => {
  const sandbox = { window: {}, location: { protocol: 'http:', hostname: 'localhost' } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/music-client.js'), 'utf8'), sandbox);
  return sandbox.window.MusicClient;
})();

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = Object.create(null);
    this.attributes = Object.create(null);
    this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
    this.className = '';
    this.classList = {
      toggle: (name, force) => this.toggleClass(name, force),
      add: (name) => this.toggleClass(name, true),
      remove: (name) => this.toggleClass(name, false),
    };
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.max = '';
    this.textContent = '';
    this.lastElementChild = { textContent: '' };
  }

  toggleClass(name, force) {
    const names = new Set(this.className.split(/\s+/).filter(Boolean));
    if (force) names.add(name); else names.delete(name);
    this.className = [...names].join(' ');
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener({ preventDefault() {}, ...event });
  }

  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector() { return new MockElement(); }
}

function createPlayer() {
  const ids = [...adminTemplate.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const elements = Object.fromEntries([...new Set(ids)].map((id) => [id, new MockElement()]));
  const windowListeners = Object.create(null);
  const requests = [];
  let state = { current: null, status: 'stopped', volume: 40, player: { online: true } };
  let position = 0;
  let animationFrame;
  let callbacks;
  const document = {
    activeElement: null,
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: (tag) => new MockElement(tag),
    createElementNS: (_ns, tag) => new MockElement(tag),
  };
  const window = {
    addEventListener(type, listener) { (windowListeners[type] ||= []).push(listener); },
    confirm: () => true,
  };
  const fetch = (url, options) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return Promise.resolve({ status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ ok: true }) });
  };
  const musicClient = {
    splitTitle: realMusicClient.splitTitle,
    connect(options) { callbacks = options; return { getState: () => state, position: () => position }; },
    formatTime(seconds) { const value = Math.max(0, Math.floor(Number(seconds) || 0)); return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0'); },
  };
  const script = [...adminTemplate.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).find((candidate) => candidate.includes('music-now-seek'))
    .replace('{{csrfToken}}', 'csrf-test-token')
    .replace('{{{initialJson}}}', JSON.stringify(state))
    .replace('{{websocketPort}}', '28081');
  vm.runInNewContext(script, {
    document, window, fetch, MusicClient: musicClient,
    requestAnimationFrame(callback) { animationFrame = callback; },
    setTimeout: () => 1, clearTimeout() {},
  });
  function setState(next, nextPosition) {
    state = next;
    if (nextPosition !== undefined) position = nextPosition;
    callbacks.onState(state);
    tick();
  }
  function tick() { const callback = animationFrame; if (callback) callback(); }
  function pointerUp() { for (const listener of windowListeners.pointerup || []) listener({}); }
  return { elements, requests, setState, tick, pointerUp };
}

const track = (id, overrides = {}) => ({ id, title: 'Song', author: 'Artist', playSec: 120, startSec: 30, ...overrides });
const playing = (current) => ({ current, status: 'playing', volume: 40, player: { online: true } });

async function flushPromises() { await new Promise((resolve) => setImmediate(resolve)); }

test('admin seek sends an absolute timestamp and CSRF token after pointer release', async () => {
  const player = createPlayer();
  player.setState(playing(track('one')), 30);
  const seek = player.elements['music-now-seek'];
  assert.equal(seek.disabled, false);
  assert.equal(seek.max, '120');
  seek.dispatch('pointerdown');
  seek.value = '15';
  seek.dispatch('input');
  player.pointerUp();
  await flushPromises();
  assert.equal(player.requests.length, 1);
  assert.equal(player.requests[0].url, '/admin/music/api/control');
  assert.deepEqual(player.requests[0].body, { _csrf: 'csrf-test-token', action: 'seek', value: 45 });
});

test('seek preview remains stable while the player position and state update during scrubbing', () => {
  const player = createPlayer();
  player.setState(playing(track('one')), 40);
  const seek = player.elements['music-now-seek'];
  seek.dispatch('pointerdown');
  seek.value = '22';
  seek.dispatch('input');
  player.tick();
  player.setState(playing(track('one')), 50);
  player.tick();
  assert.equal(seek.value, '22');
  assert.equal(player.elements['music-now-pos'].textContent, '0:22');
  assert.equal(player.elements['music-now-fill'].style.width, (22 / 120 * 100) + '%');
  assert.equal(player.requests.length, 0);
});

test('one pointer release commits one seek request', async () => {
  const player = createPlayer();
  player.setState(playing(track('one')), 30);
  const seek = player.elements['music-now-seek'];
  seek.dispatch('pointerdown');
  seek.value = '19';
  seek.dispatch('input');
  seek.dispatch('change');
  player.pointerUp();
  player.pointerUp();
  seek.dispatch('change');
  await flushPromises();
  assert.equal(player.requests.filter((request) => request.body && request.body.action === 'seek').length, 1);
});

test('range input followed by change commits once for keyboard or assistive input', async () => {
  const player = createPlayer();
  player.setState(playing(track('one')), 30);
  const seek = player.elements['music-now-seek'];
  seek.value = '12';
  seek.dispatch('input');
  seek.dispatch('change');
  player.pointerUp();
  await flushPromises();
  const seeks = player.requests.filter((request) => request.body && request.body.action === 'seek');
  assert.equal(seeks.length, 1);
  assert.equal(seeks[0].body.value, 42);
});

test('keyboard arrows seek in five second steps and clamp to track bounds', async () => {
  const player = createPlayer();
  player.setState(playing(track('one')), 30);
  const seek = player.elements['music-now-seek'];
  seek.value = '0';
  seek.dispatch('keydown', { key: 'ArrowLeft' });
  seek.value = '15';
  seek.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(seek.value, '20');
  seek.value = '20';
  seek.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(seek.value, '15');
  seek.value = '118';
  seek.dispatch('keydown', { key: 'ArrowRight' });
  await flushPromises();
  const seeks = player.requests.filter((request) => request.body && request.body.action === 'seek');
  assert.deepEqual(seeks.map((request) => request.body.value), [30, 50, 45, 150]);
  assert.equal(seek.value, '120');
});

test('cancel and track switch do not commit a stale preview', async () => {
  const player = createPlayer();
  player.setState(playing(track('one')), 30);
  const seek = player.elements['music-now-seek'];
  seek.dispatch('pointerdown');
  seek.value = '25';
  seek.dispatch('input');
  seek.dispatch('pointercancel');
  player.pointerUp();
  assert.notEqual(seek.value, '25');

  seek.dispatch('pointerdown');
  seek.value = '35';
  seek.dispatch('input');
  player.setState(playing(track('two', { startSec: 0 })), 4);
  seek.value = '40';
  seek.dispatch('input');
  assert.equal(seek.value, '4');
  player.pointerUp();
  seek.dispatch('pointerdown');
  seek.value = '30';
  seek.dispatch('input');
  player.setState(playing(track('two', { startSec: 1, playSec: 60 })), 10);
  assert.notEqual(seek.value, '30');
  assert.equal(seek.max, '60');
  assert.equal(player.elements['music-now-len'].textContent, '1:00');
  player.pointerUp();
  await flushPromises();
  assert.equal(player.requests.filter((request) => request.body && request.body.action === 'seek').length, 0);
});

test('empty player keeps the seek slider disabled and exposes no public seek control', () => {
  const player = createPlayer();
  player.setState({ current: null, status: 'stopped', volume: 40, player: { online: false } }, 0);
  const seek = player.elements['music-now-seek'];
  assert.equal(seek.disabled, true);
  assert.equal(seek.value, '0');
  assert.equal(seek.max, '0');
  const zeroDuration = createPlayer();
  zeroDuration.setState(playing(track('zero', { playSec: 0, durationSec: 90 })), 30);
  assert.equal(zeroDuration.elements['music-now-seek'].disabled, true);
  assert.equal(zeroDuration.elements['music-now-seek'].max, '0');
  assert.doesNotMatch(publicTemplate, /type="range"[^>]*aria-label="Позиция трека"|id="music-hero-seek"/);
});

test('splitTitle strips video noise and splits artist from track', () => {
  const split = (title, author = 'Channel') => ({ ...realMusicClient.splitTitle({ title, author }) });
  assert.deepEqual(split('Queen – Bohemian Rhapsody (Official Video Remastered)'), { title: 'Bohemian Rhapsody', artist: 'Queen' });
  assert.deepEqual(split('/kerbal x BLANKED x MehDead — Ex Mashup'), { title: 'Ex Mashup', artist: '/kerbal x BLANKED x MehDead' });
  assert.deepEqual(split('Song [Official Music Video] (feat. X)', 'Artist - Topic'), { title: 'Song (feat. X)', artist: 'Artist' });
  assert.deepEqual(split('Виктор Цой - Группа Крови (клип)'), { title: 'Группа Крови', artist: 'Виктор Цой' });
  assert.deepEqual(split('(Official Video)'), { title: '(Official Video)', artist: 'Channel' });
  assert.deepEqual(split('INSTASAMKA - JUICY (премьера клипа, 2021, prod. realmoneyken)'), { title: 'JUICY', artist: 'INSTASAMKA' });
  assert.deepEqual(split('Человек-яйца', 'Тот Самый - Topic'), { title: 'Человек-яйца', artist: 'Тот Самый' });
});
