'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, beforeEach, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-music-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const repo = require('../src/repositories/music.repo');
const { createSettingsStore, defaultSettings, applyForm, normalizeSettings } = require('../src/services/music/musicSettings.service');
const { createMusicService } = require('../src/services/music/music.service');

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function track(id, extra = {}) {
  return { provider: 'youtube', externalId: id, title: `Song ${id}`, author: 'Artist', durationSec: 200, viewCount: 100000, likeCount: 1000, tags: [], thumbnail: '', isLive: false, url: `https://youtu.be/${id}`, ...extra };
}

const viewer = (login, badges = {}, extra = {}) => ({ login, display: login, tags: { username: login, badges, ...extra } });

let ctx;

function setup({ tracks = {}, ratings = {}, playlist = [], follower = false, ...settings } = {}) {
  db.exec('DELETE FROM music_request; DELETE FROM music_blacklist_track; DELETE FROM music_blacklist_user; DELETE FROM music_settings;');
  const store = createSettingsStore({ repo });
  const base = defaultSettings();
  store.save({ ...base, ...settings, limits: { ...base.limits, ...settings.limits }, paid: { ...base.paid, ...settings.paid }, community: { ...base.community, ...settings.community }, player: { ...base.player, announce: false, ...settings.player }, filters: { ...base.filters, ...settings.filters }, backup: { ...base.backup, ...settings.backup } });
  const library = { aaaaaaaaaaa: track('aaaaaaaaaaa'), bbbbbbbbbbb: track('bbbbbbbbbbb'), ccccccccccc: track('ccccccccccc'), ddddddddddd: track('ddddddddddd'), ...tracks };
  const pending = [];
  const said = [];
  const events = [];
  let clock = 1_000_000;
  const provider = {
    resolve: async (input) => (library[input] ? { track: library[input], startSec: 0 } : null),
    getVideo: async (id) => library[id] || null,
    getPlaylistItems: async () => playlist.map((id) => ({ externalId: id, title: id })),
    getRating: async (id) => ratings[id] || null,
  };
  const service = createMusicService({
    repo,
    settingsStore: store,
    provider,
    broadcast: (payload) => events.push(payload),
    say: (message) => said.push(message),
    isFollower: async () => follower,
    getRubAmount: async (amount, currency) => (currency === 'USD' ? amount * 100 : amount),
    now: () => clock,
    timers: { setTimeout: (fn) => { pending.push(fn); return pending.length; }, clearTimeout: () => {}, setInterval: () => null, clearInterval: () => {} },
    random: () => 0,
  });
  service.init();
  ctx = { service, store, said, events, pending, tick: (ms) => { clock += ms; }, library };
  return ctx;
}

const request = (input, who = viewer('alice')) => ctx.service.requestTrack({ input, requester: who, source: 'chat' });
const donate = (input, amount = 100, donationId = String(Math.random()), currency = 'RUB', donor = 'Donor') => ctx.service.requestTrack({ input, requester: { login: donor.toLowerCase(), display: donor }, source: 'donation', payment: { amount, currency, amountRub: currency === 'RUB' ? amount : amount * 100, donationId } });
const queueIds = () => ctx.service.getQueue().map((item) => item.externalId);

beforeEach(() => setup());

test('chat request is queued and duplicates / limits are rejected', async () => {
  const first = await request('aaaaaaaaaaa');
  assert.equal(first.ok, true);
  assert.match(first.message, /Song aaaaaaaaaaa/);
  assert.equal((await request('aaaaaaaaaaa', viewer('bob'))).code, 'duplicate');
  assert.equal((await request('bbbbbbbbbbb')).ok, true);
  assert.equal((await request('ccccccccccc')).code, 'user_limit');
  assert.equal((await request('zzz', viewer('carol'))).code, 'not_found');
  assert.equal((await request('', viewer('carol'))).code, 'empty');
});

test('too long free request is rejected, paid one is capped', async () => {
  setup({ tracks: { lllllllllll: track('lllllllllll', { durationSec: 3000 }) } });
  assert.equal((await request('lllllllllll')).code, 'too_long');
  const paid = await donate('lllllllllll', 500);
  assert.equal(paid.ok, true);
  assert.equal(paid.request.playLimitSec, undefined);
  const stored = repo.findQueued()[0];
  assert.equal(stored.playLimitSec, 1200);
  assert.equal(ctx.service.getQueue()[0].playSec, 1200);
});

test('request roles, user blacklist and play types are enforced for chat', async () => {
  setup({ community: { requestRoles: ['subscriber'] } });
  assert.equal((await request('aaaaaaaaaaa')).code, 'role');
  assert.equal((await request('aaaaaaaaaaa', viewer('sub', { subscriber: '3' }))).ok, true);
  assert.equal((await request('bbbbbbbbbbb', viewer('boss', { broadcaster: '1' }))).ok, true);

  setup({ community: { requestRoles: ['follower'] }, follower: true });
  assert.equal((await request('aaaaaaaaaaa')).ok, true);

  setup();
  repo.addBlacklistedUser('Troll');
  assert.equal((await request('aaaaaaaaaaa', viewer('troll'))).code, 'user_blacklisted');

  setup({ playTypes: 'paid' });
  assert.equal((await request('aaaaaaaaaaa')).code, 'type');
  assert.equal((await donate('aaaaaaaaaaa')).ok, true);
});

test('paid requests jump ahead of free ones but keep their own order', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await request('bbbbbbbbbbb', viewer('u2'));
  await donate('ccccccccccc');
  await donate('ddddddddddd');
  assert.deepEqual(queueIds(), ['ccccccccccc', 'ddddddddddd', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);

  setup({ paid: { prioritize: false } });
  await request('aaaaaaaaaaa', viewer('u1'));
  await donate('ccccccccccc');
  assert.deepEqual(queueIds(), ['aaaaaaaaaaa', 'ccccccccccc']);
});

test('price per second limits playback to the paid amount', async () => {
  setup({ paid: { pricePerSecondEnabled: true, pricePerSecondRub: 2, minAmountRub: 10 } });
  assert.equal((await donate('aaaaaaaaaaa', 60)).ok, true);
  assert.equal(repo.findQueued()[0].playLimitSec, 30);
  assert.equal((await donate('bbbbbbbbbbb', 5)).code, 'min_amount');
  assert.equal((await donate('ccccccccccc', 1, 'x', 'USD')).ok, true);
  assert.equal(repo.findQueued()[1].playLimitSec, 50);
});

test('filters reject blocked tags, low views, low like ratio and blacklisted tracks even when paid', async () => {
  setup({
    filters: { blockedTags: ['phonk'], minViews: 1000, minLikePercent: 80 },
    tracks: {
      ttttttttttt: track('ttttttttttt', { tags: ['Phonk'] }),
      hhhhhhhhhhh: track('hhhhhhhhhhh', { title: 'Song #phonk' }),
      vvvvvvvvvvv: track('vvvvvvvvvvv', { viewCount: 10 }),
      rrrrrrrrrrr: track('rrrrrrrrrrr'),
    },
    ratings: { rrrrrrrrrrr: { likes: 10, dislikes: 90, percent: 10 } },
  });
  assert.equal((await request('ttttttttttt')).code, 'filtered');
  assert.equal((await request('hhhhhhhhhhh')).code, 'filtered');
  assert.equal((await request('vvvvvvvvvvv')).code, 'filtered');
  assert.equal((await donate('rrrrrrrrrrr')).code, 'filtered');
  repo.addBlacklistedTrack({ provider: 'youtube', externalId: 'aaaaaaaaaaa', title: 'x' });
  assert.equal((await donate('aaaaaaaaaaa')).code, 'filtered');
  const admin = await ctx.service.requestTrack({ input: 'aaaaaaaaaaa', requester: { login: 'admin' }, source: 'admin' });
  assert.equal(admin.ok, true);
});

test('playback advances on ended / progress past the end and respects autoplay and delay', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await request('bbbbbbbbbbb', viewer('u2'));
  assert.equal(ctx.service.getState().status, 'stopped');
  await ctx.service.play();
  let state = ctx.service.getState();
  assert.equal(state.status, 'playing');
  assert.equal(state.current.externalId, 'aaaaaaaaaaa');

  ctx.service.registerPlayer('dock-1');
  assert.deepEqual(await ctx.service.playerReport({ playerId: 'other', event: 'ended', requestId: state.current.id }), { ok: false, active: false });
  await ctx.service.playerReport({ playerId: 'dock-1', event: 'progress', requestId: state.current.id, position: 199.9 });
  state = ctx.service.getState();
  assert.equal(state.current.externalId, 'bbbbbbbbbbb');
  assert.equal(repo.findHistory()[0].status, 'played');

  // Задержка между треками.
  const s = ctx.store.get();
  ctx.store.save({ ...s, player: { ...s.player, delaySec: 5 } });
  await request('ccccccccccc', viewer('u3'));
  await ctx.service.playerReport({ playerId: 'dock-1', event: 'ended', requestId: state.current.id });
  assert.equal(ctx.service.getState().status, 'waiting');
  await ctx.pending.shift()();
  assert.equal(ctx.service.getState().current.externalId, 'ccccccccccc');

  // Без автоплея после окончания плеер останавливается.
  ctx.store.save({ ...ctx.store.get(), player: { ...ctx.store.get().player, autoplay: false, delaySec: 0 } });
  await request('ddddddddddd', viewer('u4'));
  await ctx.service.playerReport({ playerId: 'dock-1', event: 'ended', requestId: ctx.service.getState().current.id });
  assert.equal(ctx.service.getState().status, 'stopped');
  assert.equal(ctx.service.getState().current, null);
  await ctx.service.play();
  assert.equal(ctx.service.getState().current.externalId, 'ddddddddddd');
});

test('new request auto-starts only after playback was started once', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  assert.equal(ctx.service.getState().status, 'stopped');
  await ctx.service.play();
  await ctx.service.skip();
  assert.equal(ctx.service.getState().status, 'stopped');
  await request('bbbbbbbbbbb', viewer('u2'));
  assert.equal(ctx.service.getState().status, 'playing');
  await ctx.service.pause();
  await ctx.service.skip();
  await request('ccccccccccc', viewer('u3'));
  assert.notEqual(ctx.service.getState().status, 'playing');
});

test('vote skip uses weights, ignores repeated votes; mods skip instantly', async () => {
  setup({ community: { voteSkipThreshold: 3, vipVoteWeight: 2 } });
  await request('aaaaaaaaaaa', viewer('u1'));
  await request('bbbbbbbbbbb', viewer('u2'));
  await ctx.service.play();
  assert.match((await ctx.service.skipCommand({ login: 'v1', tags: { badges: {} } })).message, /1\/3/);
  assert.match((await ctx.service.voteSkip({ login: 'v1', tags: { badges: {} } })).message, /уже/);
  const result = await ctx.service.voteSkip({ login: 'vip', tags: { badges: { vip: '1' } } });
  assert.match(result.message, /пропущен/);
  assert.equal(ctx.service.getState().current.externalId, 'bbbbbbbbbbb');
  assert.equal(ctx.service.getState().votes.total, 0);
  await ctx.service.skipCommand({ login: 'mod', tags: { mod: true, badges: { moderator: '1' } } });
  assert.equal(ctx.service.getState().current, null);
});

test('backup playlist plays when queue is empty and is interrupted by a real request', async () => {
  setup({ backup: { playlistUrl: 'PLx', interrupt: true }, playlist: ['ppppppppppp', 'qqqqqqqqqqq'], tracks: { ppppppppppp: track('ppppppppppp'), qqqqqqqqqqq: track('qqqqqqqqqqq') } });
  await ctx.service.reloadBackup();
  await ctx.service.play();
  assert.equal(ctx.service.getState().current.isBackup, true);
  assert.deepEqual(queueIds(), []);
  await request('aaaaaaaaaaa', viewer('u1'));
  const state = ctx.service.getState();
  assert.equal(state.current.externalId, 'aaaaaaaaaaa');
  const history = repo.findHistory();
  assert.equal(history[0].source, 'backup');
  assert.equal(history[0].statusReason, 'interrupted');
});

test('player error marks the request failed and moves on', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await request('bbbbbbbbbbb', viewer('u2'));
  await ctx.service.play();
  ctx.service.registerPlayer('dock');
  await ctx.service.playerReport({ playerId: 'dock', event: 'error', requestId: ctx.service.getState().current.id, errorCode: 150 });
  assert.equal(repo.findHistory()[0].status, 'failed');
  assert.match(ctx.said.at(-1), /запретил/);
  assert.equal(ctx.service.getState().current.externalId, 'bbbbbbbbbbb');
});

test('a broken player pauses the queue instead of skipping every track', async () => {
  const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff'];
  ids.forEach((id) => { ctx.library[id] = ctx.library[id] || track(id); });
  for (const [i, id] of ids.entries()) await request(id, viewer(`u${i}`));
  await ctx.service.play();
  ctx.service.registerPlayer('dock');
  const fail = () => ctx.service.playerReport({ playerId: 'dock', event: 'error', requestId: ctx.service.getState().current.id, errorCode: 152 });
  await fail();
  await fail();
  assert.equal(ctx.service.getState().current.externalId, 'ccccccccccc');
  await fail();
  let state = ctx.service.getState();
  assert.equal(state.current.externalId, 'ccccccccccc', 'third error in a row does not skip');
  assert.equal(state.status, 'paused');
  assert.match(state.player.problem, /152/);

  // «Играть» сбрасывает проблему; реальная позиция от плеера — тоже.
  await ctx.service.play();
  assert.equal(ctx.service.getState().player.problem, null);
  await fail();
  await ctx.service.playerReport({ playerId: 'dock', event: 'progress', requestId: ctx.service.getState().current.id, position: 3 });
  await fail();
  await fail();
  state = ctx.service.getState();
  assert.equal(state.status, 'playing', 'streak was reset by real playback');
});

test('progress without a position keeps the track position', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await ctx.service.play();
  ctx.service.registerPlayer('dock');
  const id = ctx.service.getState().current.id;
  await ctx.service.playerReport({ playerId: 'dock', event: 'progress', requestId: id, position: 40 });
  ctx.tick(5000);
  await ctx.service.playerReport({ playerId: 'dock', event: 'progress', requestId: id });
  await ctx.service.playerReport({ playerId: 'dock', event: 'progress', requestId: id, position: null });
  assert.ok(ctx.service.getState().positionSec >= 40);
});

test('a new dock does not take over an online player unless asked', () => {
  ctx.service.registerPlayer('browser-tab');
  ctx.service.registerPlayer('obs-dock', { takeover: false });
  assert.equal(ctx.service.getState().player.activeId, 'browser-tab');
  ctx.service.registerPlayer('obs-dock');
  assert.equal(ctx.service.getState().player.activeId, 'obs-dock');
});

test('!wrongsong removes the viewer\'s latest queued chat request only', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await request('bbbbbbbbbbb', viewer('u2'));
  await request('ccccccccccc', viewer('u2'));
  let result = await ctx.service.cancelOwnRequest({ login: 'u2' });
  assert.equal(result.ok, true);
  assert.deepEqual(queueIds(), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.equal(repo.findHistory()[0].statusReason, 'cancelled');

  result = await ctx.service.cancelOwnRequest({ login: 'nobody' });
  assert.equal(result.ok, false);
  assert.match(result.message, /нет твоих/);

  // Играющий трек отменить нельзя.
  await ctx.service.play();
  result = await ctx.service.cancelOwnRequest({ login: 'u1' });
  assert.equal(result.ok, false);
  assert.match(result.message, /уже играет/);
  assert.equal(ctx.service.getState().current.externalId, 'aaaaaaaaaaa');

  // Донатный заказ — тоже нет.
  await donate('ddddddddddd', 100, 'don-1', 'RUB', 'Payer');
  result = await ctx.service.cancelOwnRequest({ login: 'payer' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Донатный/);
  assert.ok(queueIds().includes('ddddddddddd'));
});

test('reorder and remove keep the queue consistent', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await request('bbbbbbbbbbb', viewer('u2'));
  await request('ccccccccccc', viewer('u3'));
  const ids = ctx.service.getQueue().map((item) => item.id);
  ctx.service.reorder([ids[2], ids[0]]);
  assert.deepEqual(queueIds(), ['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
  await ctx.service.removeRequest(ids[0]);
  assert.deepEqual(queueIds(), ['ccccccccccc', 'bbbbbbbbbbb']);
  await ctx.service.blacklistRequest(ids[1]);
  assert.deepEqual(queueIds(), ['ccccccccccc']);
  assert.equal(repo.isTrackBlacklisted('youtube', 'bbbbbbbbbbb'), true);
});

test('donation messages are parsed for links, !sr and sr: and handled once', async () => {
  const parse = ctx.service.parseDonationMessage;
  const findUrl = (text) => (/youtu\.be\/(\w+)/.exec(text) ? 'URL' : null);
  assert.equal(parse('держи https://youtu.be/abc', findUrl), 'URL');
  assert.equal(parse('Привет! !sr Сплин выхода нет', findUrl), 'Сплин выхода нет');
  assert.equal(parse('!ык кино группа крови', findUrl), 'кино группа крови');
  assert.equal(parse('sr: aaaaaaaaaaa', findUrl), 'aaaaaaaaaaa');
  assert.equal(parse('просто спасибо за стрим', findUrl), null);
  assert.equal(parse('user sr:ok', findUrl), 'ok');

  const donation = { _id: 'don-1', donorName: '❤️ Rich Guy', amount: 300, currency: 'RUB', message: 'sr: aaaaaaaaaaa' };
  const result = await ctx.service.handleDonation(donation);
  assert.equal(result.ok, true);
  assert.match(ctx.said.at(-1), /^@Rich Guy/);
  assert.equal(repo.findQueued()[0].isPaid, true);
  assert.equal(repo.findQueued()[0].amountRub, 300);
  assert.equal(await ctx.service.handleDonation(donation), null);
  assert.equal(repo.findQueued().length, 1);
});

test('restart restores the playing track as paused', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await ctx.service.play();
  const restarted = createMusicService({ repo, settingsStore: ctx.store, provider: {}, timers: { setTimeout, clearTimeout, setInterval: () => null, clearInterval: () => {} } });
  restarted.init();
  assert.equal(restarted.getState().status, 'paused');
  assert.equal(restarted.getState().current.externalId, 'aaaaaaaaaaa');
});

test('settings form keeps other sections untouched and validates values', () => {
  const current = normalizeSettings(defaultSettings());
  const next = applyForm(current, { _section: 'limits', 'limits.maxQueue': '7', 'limits.maxFreeDurationMin': '2.5' });
  assert.equal(next.limits.maxQueue, 7);
  assert.equal(next.limits.maxFreeDurationSec, 150);
  assert.equal(next.backup.shuffle, current.backup.shuffle);
  assert.equal(next.obs.dockToken, current.obs.dockToken);
  const roles = applyForm(current, { _section: ['community'], 'community.requestRoles': ['vip', 'bogus'], 'community.skipRole': 'vip' });
  assert.deepEqual(roles.community.requestRoles, ['vip']);
  assert.equal(roles.community.voteSkipEnabled, false);
  const tags = applyForm(current, { _section: 'filters', 'filters.blockedTags': '#Phonk\nnightcore, phonk' });
  assert.deepEqual(tags.filters.blockedTags, ['phonk', 'nightcore']);
});

test('missing settings fall back to defaults instead of zero', () => {
  const normalized = normalizeSettings({ limits: {}, player: {}, community: {} });
  const defaults = defaultSettings();
  assert.equal(normalized.player.volume, defaults.player.volume);
  assert.equal(normalized.community.voteSkipThreshold, defaults.community.voteSkipThreshold);
  assert.equal(normalized.limits.maxQueue, defaults.limits.maxQueue);
  assert.equal(applyForm(normalized, { _section: 'limits', 'limits.maxQueue': '' }).limits.maxQueue, defaults.limits.maxQueue);
});

test('concurrent advances never leave two playing rows', async () => {
  setup({ backup: { playlistUrl: 'PLx' }, playlist: ['ppppppppppp'], tracks: { ppppppppppp: track('ppppppppppp') } });
  await ctx.service.play(); // бэкап играет
  await Promise.all([ctx.service.skip(), request('aaaaaaaaaaa', viewer('u1')), request('bbbbbbbbbbb', viewer('u2'))]);
  const playing = db.prepare("SELECT COUNT(*) AS n FROM music_request WHERE status = 'playing'").get().n;
  assert.equal(playing, 1);
  assert.equal(ctx.service.getState().current.isBackup, false);
});

test('paid request with unknown RUB amount is rejected when amount matters', async () => {
  setup({ paid: { minAmountRub: 50 } });
  const result = await ctx.service.requestTrack({ input: 'aaaaaaaaaaa', requester: { login: 'x' }, source: 'donation', payment: { amount: 1, currency: 'XYZ', amountRub: null, donationId: 'd' } });
  assert.equal(result.code, 'currency');
});

test('registering a dock does not count offline time as played', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await ctx.service.play();
  ctx.tick(60000);
  ctx.service.registerPlayer('dock');
  assert.equal(ctx.service.getState().positionSec, 0);
});

test('chat is told about the new track only after a chat skip', async () => {
  setup({ player: { announce: true } });
  await request('aaaaaaaaaaa', viewer('u1'));
  await request('bbbbbbbbbbb', viewer('u2'));
  await request('ccccccccccc', viewer('u3'));
  await ctx.service.play();
  await ctx.service.skip(); // админка
  assert.deepEqual(ctx.said, []);
  const result = await ctx.service.skipCommand({ login: 'mod', tags: { mod: true, badges: { moderator: '1' } } });
  assert.match(result.message, /пропущен.*Сейчас играет: Song ccccccccccc .* заказ от @u3/);
  assert.deepEqual(ctx.said, []);

  // С паузой между треками объявление уходит при старте следующего.
  setup({ player: { announce: true, delaySec: 5 } });
  await request('aaaaaaaaaaa', viewer('u1'));
  await request('bbbbbbbbbbb', viewer('u2'));
  await ctx.service.play();
  ctx.service.registerPlayer('dock');
  await ctx.service.playerReport({ playerId: 'dock', event: 'ended', requestId: ctx.service.getState().current.id });
  assert.equal(ctx.service.getState().status, 'waiting');
  await ctx.pending.shift()();
  assert.deepEqual(ctx.said, []); // обычный переход — молча
});

test('seek moves the position, clamps it and ignores stale dock progress', async () => {
  await request('aaaaaaaaaaa', viewer('u1'));
  await ctx.service.play();
  ctx.service.registerPlayer('dock');
  const id = ctx.service.getState().current.id;
  assert.equal(ctx.service.seek(120).ok, true);
  let state = ctx.service.getState();
  assert.equal(state.positionSec, 120);
  assert.equal(state.seekSeq, 1);
  await ctx.service.playerReport({ playerId: 'dock', event: 'progress', requestId: id, position: 10, seekSeq: 0 });
  assert.equal(ctx.service.getState().positionSec, 120);
  await ctx.service.playerReport({ playerId: 'dock', event: 'progress', requestId: id, position: 121, seekSeq: 1 });
  assert.equal(ctx.service.getState().positionSec, 121);
  ctx.service.seek(9999);
  assert.equal(ctx.service.getState().positionSec, 199);
  ctx.service.seek(-5);
  assert.equal(ctx.service.getState().positionSec, 0);
  await ctx.service.skip();
  assert.equal(ctx.service.seek(10).ok, false);
});
