'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, beforeEach, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-video-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const repo = require('../src/repositories/video.repo');
const realProviders = require('../src/video/providers');
const { createSettingsStore, defaultSettings, applyForm, normalizeSettings } = require('../src/services/video/videoSettings.service');
const { createVideoService } = require('../src/services/video/video.service');

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const DAY = 86400000;
const yt = (id) => `https://youtu.be/${id}`;

function item(id, extra = {}) {
  return {
    provider: 'youtube', externalId: id, kind: 'video', title: `Video ${id}`, author: 'Author', channelId: 'chan1',
    durationSec: 120, thumbnail: '', url: yt(id), embed: null, isVertical: false, viewCount: 50000, publishedAt: 1_000_000 - 30 * DAY, isLive: false, ...extra,
  };
}

const viewer = (login, badges = {}, extra = {}) => ({ login, display: login, messageId: `msg-${login}-${Math.random()}`, tags: { username: login, badges, ...extra } });

let ctx;

function setup({ library: extraLibrary = {}, follower = false, ...overrides } = {}) {
  db.exec('DELETE FROM video_request; DELETE FROM video_blacklist_item; DELETE FROM video_blacklist_user; DELETE FROM video_blacklist_channel; DELETE FROM video_settings;');
  const store = createSettingsStore({ repo });
  const base = defaultSettings();
  const merged = { ...base, accepting: true };
  for (const [key, value] of Object.entries(overrides)) merged[key] = typeof value === 'object' && !Array.isArray(value) ? { ...base[key], ...value } : value;
  merged.player = { ...merged.player, announce: false };
  store.save(merged);
  const library = {
    aaaaaaaaaaa: item('aaaaaaaaaaa'), bbbbbbbbbbb: item('bbbbbbbbbbb'), ccccccccccc: item('ccccccccccc'), ddddddddddd: item('ddddddddddd'),
    '7106594312292453675': item('7106594312292453675', { provider: 'tiktok', kind: 'tiktok', durationSec: null, isVertical: true, publishedAt: null, viewCount: null }),
    ...extraLibrary,
  };
  const pending = [];
  const said = [];
  const activity = [];
  let clock = 1_000_000;
  const providers = {
    find: realProviders.find,
    resolve: async (link) => library[link.id] || null,
    search: async () => null,
  };
  const service = createVideoService({
    repo,
    settingsStore: store,
    providers,
    say: (message) => said.push(message),
    isFollower: async () => follower,
    getRubAmount: async (amount) => amount,
    onActivityChange: (change) => activity.push(change),
    now: () => clock,
    timers: { setTimeout: (fn) => { pending.push(fn); return pending.length; }, clearTimeout: () => {}, setInterval: () => null, clearInterval: () => {} },
    random: () => 0,
  });
  service.init();
  service._state.userPaused = false;
  ctx = { service, store, said, pending, activity, tick: (ms) => { clock += ms; }, library };
  return ctx;
}

const request = (id, who = viewer('alice')) => ctx.service.requestVideo({ input: `смотри ${yt(id)}`, requester: who, source: 'chat' });
const donate = (text, amount = 100, donor = 'Donor') => ctx.service.requestVideo({
  input: text, requester: { login: donor.toLowerCase(), display: donor }, source: 'donation',
  payment: { amount, currency: 'RUB', amountRub: amount, donationId: String(Math.random()) },
});
const queueIds = () => ctx.service.getQueue().map((entry) => entry.externalId);
const currentId = () => ctx.service.getState().current?.externalId || null;
const vote = (login, message, badges = {}) => ctx.service.vote({ login, tags: { username: login, badges }, message });
const runTimers = async () => { while (ctx.pending.length) await ctx.pending.shift()(); await new Promise((resolve) => setImmediate(resolve)); };

beforeEach(() => setup());

test('requests are accepted only while accepting is on; first one starts playing', async () => {
  setup({ accepting: false });
  assert.equal((await request('aaaaaaaaaaa')).code, 'closed');
  ctx.service.setAccepting(true);
  const first = await request('aaaaaaaaaaa');
  assert.equal(first.ok, true);
  assert.equal(currentId(), 'aaaaaaaaaaa');
  const second = await request('bbbbbbbbbbb', viewer('bob'));
  assert.match(second.message, /Место в очереди: 1/);
  assert.deepEqual(queueIds(), ['bbbbbbbbbbb']);
  assert.deepEqual(ctx.activity.at(-1), { active: true, idle: false });
});

test('same video from another viewer joins the request; deleting messages removes or promotes', async () => {
  await request('aaaaaaaaaaa', viewer('alice')); // играет
  const bob = viewer('bob');
  const carol = viewer('carol');
  assert.equal((await request('bbbbbbbbbbb', bob)).ok, true);
  const co = await request('bbbbbbbbbbb', carol);
  assert.equal(co.code, 'co_request');
  assert.deepEqual(ctx.service.getQueue()[0].coRequesters, ['carol']);
  assert.equal((await request('bbbbbbbbbbb', carol)).code, 'duplicate_own');

  await ctx.service.onMessageDeleted(bob.messageId);
  const queued = ctx.service.getQueue()[0];
  assert.equal(queued.requestedByLogin, 'carol');
  assert.deepEqual(queued.coRequesters, []);
  await ctx.service.onMessageDeleted(carol.messageId);
  assert.deepEqual(queueIds(), []);

  setup({ chat: { coRequest: false } });
  await request('aaaaaaaaaaa', viewer('alice'));
  assert.equal((await request('aaaaaaaaaaa', viewer('bob'))).code, 'duplicate');
});

test('role limits: best of viewer roles, 0 forbids, first-time chatters can be blocked', async () => {
  setup({ limits: { roleLimits: { everyone: 1, follower: 1, subscriber: 2, vip: 3, moderator: 5 } } });
  assert.equal((await request('aaaaaaaaaaa')).ok, true);
  assert.equal((await request('bbbbbbbbbbb')).code, 'user_limit');
  const sub = viewer('sub', { subscriber: '1' });
  assert.equal((await request('bbbbbbbbbbb', sub)).ok, true);
  assert.equal((await request('ccccccccccc', sub)).ok, true);
  assert.equal((await request('ddddddddddd', sub)).code, 'user_limit');

  setup({ limits: { roleLimits: { everyone: 0, follower: 2, subscriber: 2, vip: 3, moderator: 5 } } });
  assert.equal((await request('aaaaaaaaaaa')).code, 'role');
  setup({ follower: true, limits: { roleLimits: { everyone: 0, follower: 2, subscriber: 2, vip: 3, moderator: 5 } } });
  assert.equal((await request('aaaaaaaaaaa')).ok, true);

  setup({ chat: { firstTimeChatters: false } });
  assert.equal((await request('aaaaaaaaaaa', viewer('newbie', {}, { 'first-msg': true }))).code, 'first_message');
});

test('vote skip: difference of skip and keep, block window, warning with cancel', async () => {
  setup({ voting: { needed: 3, blockSec: 10, action: 'warning', warningSec: 7 } });
  await request('aaaaaaaaaaa');
  await request('bbbbbbbbbbb', viewer('bob'));
  assert.equal(currentId(), 'aaaaaaaaaaa');
  assert.equal(await vote('x', 'hello'), null);
  assert.equal((await vote('u1', 'скип')).ok, false); // голосование ещё закрыто
  ctx.tick(11_000);
  await vote('u1', 'скип');
  await vote('u2', 'SKIP подробности');
  await vote('u3', 'оставить');
  await vote('u4', 'скип');
  assert.equal(ctx.service.getState().votes.skip, 3);
  assert.equal(ctx.service.getState().votes.keep, 1);
  assert.equal((await vote('u1', 'скип')).ok, false); // один голос на зрителя
  const result = await vote('u5', 'скип');
  assert.equal(result.silent, false);
  assert.equal(ctx.service.getState().warning.reason, 'vote');
  assert.equal(ctx.service.getState().status, 'paused');

  ctx.service.cancelWarning();
  assert.equal(ctx.service.getState().status, 'playing');
  assert.equal(ctx.service.getState().votes.skip, 0);

  ctx.tick(11_000);
  for (const login of ['a', 'b', 'c']) await vote(login, 'skip');
  await runTimers();
  assert.equal(currentId(), 'bbbbbbbbbbb');
  const history = repo.findHistory();
  assert.equal(history[0].statusReason, 'vote');
  assert.equal(history[0].votesSkip, 3);
});

test('immediate skip action, vote changing and lock by keep votes', async () => {
  setup({ voting: { needed: 2, blockSec: 0, action: 'skip', canChangeVote: true, lockEnabled: true, lockVotes: 2 } });
  await request('aaaaaaaaaaa');
  await request('bbbbbbbbbbb', viewer('bob'));
  await vote('u1', 'skip');
  await vote('u1', 'keep'); // передумал
  assert.deepEqual([ctx.service.getState().votes.skip, ctx.service.getState().votes.keep], [0, 1]);
  await vote('u2', 'keep');
  assert.equal(ctx.service.getState().votes.locked, true);
  assert.equal((await vote('u3', 'skip')).ok, false);

  await ctx.service.skip();
  assert.equal(currentId(), 'bbbbbbbbbbb');
  await vote('m1', 'skip', { moderator: '1' });
  await vote('m2', 'skip');
  assert.equal(currentId(), null);
});

test('paid videos go first, are protected from votes and limited by price per minute', async () => {
  setup({ voting: { blockSec: 0, needed: 1 }, paid: { pricePerMinuteEnabled: true, pricePerMinuteRub: 100, endAction: 'warning' } });
  await request('aaaaaaaaaaa');
  await request('bbbbbbbbbbb', viewer('bob'));
  const paid = await donate(`глянь ${yt('ccccccccccc')}`, 50);
  assert.equal(paid.ok, true);
  assert.match(paid.message, /Оплачено 0:30/);
  assert.deepEqual(queueIds(), ['ccccccccccc', 'bbbbbbbbbbb']);
  assert.equal((await donate(`${yt('ddddddddddd')}`, 1)).code, 'too_cheap');

  await ctx.service.skip();
  assert.equal(currentId(), 'ccccccccccc');
  assert.equal((await vote('u1', 'skip')).ok, false);
  assert.equal(ctx.service.getState().votes.blocked, 'paid');

  // Кончилось оплаченное время — пауза с отсчётом, стример может досмотреть.
  const state = ctx.service.getState();
  ctx.service.registerPlayer('p1');
  await ctx.service.playerReport({ playerId: 'p1', event: 'progress', requestId: state.current.id, position: 30, seekSeq: ctx.service.getState().seekSeq });
  assert.equal(ctx.service.getState().warning.reason, 'paid');
  ctx.service.cancelWarning();
  assert.equal(ctx.service.getState().current.playSec, 120);
});

test('donations: only with a video link while accepting, !sr goes to music', async () => {
  const donation = (message) => ({ _id: String(Math.random()), donorName: 'Donor', amount: 100, currency: 'RUB', message });
  assert.equal(await ctx.service.handleDonation(donation('просто спасибо')), null);
  assert.equal(await ctx.service.handleDonation(donation(`!sr ${yt('aaaaaaaaaaa')}`)), null);
  const handled = await ctx.service.handleDonation(donation(`вот ${yt('aaaaaaaaaaa')}`));
  assert.equal(handled.ok, true);
  assert.equal(ctx.service.getState().current.isPaid, true);
  ctx.service.setAccepting(false);
  assert.equal(await ctx.service.handleDonation(donation(yt('bbbbbbbbbbb'))), null);
});

test('TikTok without duration gets it from the player and is capped for free requests', async () => {
  setup({ limits: { maxFreeDurationSec: 60 } });
  const result = await ctx.service.requestVideo({ input: 'https://www.tiktok.com/@tiktok/video/7106594312292453675', requester: viewer('alice'), source: 'chat' });
  assert.equal(result.ok, true);
  const state = ctx.service.getState();
  assert.equal(state.current.durationSec, null);
  ctx.service.registerPlayer('p1');
  await ctx.service.playerReport({ playerId: 'p1', event: 'progress', requestId: state.current.id, position: 1, duration: 95 });
  assert.equal(ctx.service.getState().current.durationSec, 95);
  assert.equal(ctx.service.getState().current.playSec, 60);
});

test('filters, blacklists and disabled platforms', async () => {
  setup({
    filters: { minViews: 1000, maxAgeDays: 10, uniqueOnly: true },
    library: { eeeeeeeeeee: item('eeeeeeeeeee', { viewCount: 10 }), fffffffffff: item('fffffffffff', { publishedAt: 1_000_000 - 2 * DAY }) },
  });
  assert.equal((await request('eeeeeeeeeee')).code, 'filtered');
  assert.equal((await request('aaaaaaaaaaa')).code, 'filtered'); // 30 дней — слишком старое
  assert.equal((await request('fffffffffff')).ok, true);
  await ctx.service.skip();
  assert.equal((await request('fffffffffff', viewer('bob'))).code, 'filtered'); // уже смотрели

  setup();
  repo.addBlacklistedChannel({ provider: 'youtube', channelId: 'chan1', name: 'Author' });
  assert.equal((await request('aaaaaaaaaaa')).code, 'filtered');

  setup({ providers: { tiktok: false } });
  const tiktok = await ctx.service.requestVideo({ input: 'https://www.tiktok.com/@x/video/7106594312292453675', requester: viewer('alice'), source: 'chat' });
  assert.equal(tiktok.code, 'provider_disabled');
});

test('queue duration limit closes accepting automatically', async () => {
  setup({ limits: { maxQueueDurationMin: 4 } });
  ctx.store.save({ ...ctx.store.get(), chat: { ...ctx.store.get().chat, announceAccepting: true } });
  await request('aaaaaaaaaaa');
  assert.equal(ctx.store.get().accepting, true);
  await request('bbbbbbbbbbb', viewer('bob'));
  assert.equal(ctx.store.get().accepting, false);
  assert.match(ctx.said.at(-1), /заполнена/);
});

test('settings form keeps words and role limits sane', () => {
  const next = applyForm(normalizeSettings(null), {
    _section: ['voting', 'limits'],
    'voting.skipWords': 'NOPERS\nскип',
    'voting.keepWords': 'NOPERS\nCLAP',
    'voting.needed': '5',
    'voting.enabled': 'on',
    'limits.roleLimits.subscriber': '4',
    'limits.maxFreeDurationMin': '2,5',
  });
  assert.deepEqual(next.voting.skipWords, ['NOPERS', 'скип']);
  assert.deepEqual(next.voting.keepWords, ['CLAP']);
  assert.equal(next.voting.needed, 5);
  assert.equal(next.limits.roleLimits.subscriber, 4);
  assert.equal(next.limits.maxFreeDurationSec, 150);
});

test('viewers without rights cannot join others requests; lock survives a vote warning', async () => {
  setup({ limits: { roleLimits: { everyone: 0, follower: 0, subscriber: 2, vip: 3, moderator: 5 } }, voting: { needed: 1, blockSec: 0, action: 'warning' } });
  const sub = viewer('sub', { subscriber: '1' });
  await request('aaaaaaaaaaa', sub);
  await request('bbbbbbbbbbb', sub);
  assert.equal((await request('bbbbbbbbbbb', viewer('pleb'))).code, 'role');

  await vote('u1', 'skip');
  assert.equal(ctx.service.getState().warning.reason, 'vote');
  ctx.service.toggleLock();
  const state = ctx.service.getState();
  assert.equal(state.warning, null);
  assert.equal(state.votes.locked, true);
  assert.equal(state.status, 'playing');
});

test('request is dropped when intake closes or the message is deleted during lookup', async () => {
  // requestVideo уступает управление на запросах к площадке — в это время приходит удаление.
  const alice = viewer('alice');
  const slow = ctx.service.requestVideo({ input: yt('aaaaaaaaaaa'), requester: alice, source: 'chat' });
  await ctx.service.onMessageDeleted(alice.messageId);
  assert.equal((await slow).code, 'message_deleted');

  const pending = request('bbbbbbbbbbb', viewer('bob'));
  ctx.service.setAccepting(false);
  assert.equal((await pending).code, 'closed');
});

test('seeking preserves playback status and rejects positions from before the seek', async () => {
  await request('aaaaaaaaaaa');
  ctx.service.registerPlayer('seek-player');
  const before = ctx.service.getState();
  ctx.service.seek(60);
  const sought = ctx.service.getState();
  assert.equal(sought.status, 'playing');
  assert.equal(sought.positionSec, 60);
  await ctx.service.playerReport({
    playerId: 'seek-player', event: 'progress', requestId: sought.current.id,
    position: 5, seekSeq: before.seekSeq,
  });
  assert.equal(ctx.service.getState().positionSec, 60);
  await ctx.service.playerReport({
    playerId: 'seek-player', event: 'progress', requestId: sought.current.id,
    position: 62, seekSeq: sought.seekSeq,
  });
  assert.equal(ctx.service.getState().positionSec, 62);
  assert.equal(ctx.service.getState().status, 'playing');
  await ctx.service.pause();
  ctx.service.seek(30);
  assert.equal(ctx.service.getState().status, 'paused');
  assert.equal(ctx.service.getState().positionSec, 30);
});

test('native player pause and play reports update state and preserve manual intent for autoplay', async () => {
  await request('aaaaaaaaaaa');
  await request('bbbbbbbbbbb', viewer('bob'));
  await request('ccccccccccc', viewer('carol'));
  ctx.service.registerPlayer('native-player');

  const playing = ctx.service.getState();
  const pausedReport = await ctx.service.playerReport({
    playerId: 'native-player', event: 'paused', requestId: playing.current.id,
    position: 42, seekSeq: playing.seekSeq, playbackSeq: playing.playbackSeq,
  });
  assert.equal(pausedReport.active, true);
  assert.equal(ctx.service.getState().status, 'paused');
  assert.equal(ctx.service._state.userPaused, true);
  assert.equal(ctx.service.getState().positionSec, 42);

  const paused = ctx.service.getState();
  ctx.service.seek(60);
  const sought = ctx.service.getState();
  await ctx.service.playerReport({
    playerId: 'native-player', event: 'playing', requestId: paused.current.id,
    position: 43, seekSeq: sought.seekSeq, playbackSeq: paused.playbackSeq,
  });
  assert.equal(ctx.service.getState().status, 'paused');
  assert.equal(ctx.service._state.userPaused, true);
  assert.equal(ctx.service.getState().positionSec, 60);

  const soughtPaused = ctx.service.getState();
  await ctx.service.playerReport({
    playerId: 'native-player', event: 'ended', requestId: soughtPaused.current.id,
  });
  assert.equal(ctx.service.getState().current.externalId, 'bbbbbbbbbbb');
  assert.equal(ctx.service.getState().status, 'paused');
  assert.equal(ctx.service._state.userPaused, true);

  const nextPaused = ctx.service.getState();
  await ctx.service.playerReport({
    playerId: 'native-player', event: 'playing', requestId: nextPaused.current.id,
    position: 0, seekSeq: nextPaused.seekSeq, playbackSeq: nextPaused.playbackSeq,
  });
  assert.equal(ctx.service.getState().status, 'playing');
  assert.equal(ctx.service._state.userPaused, false);

  const resumed = ctx.service.getState();
  await ctx.service.playerReport({
    playerId: 'native-player', event: 'ended', requestId: resumed.current.id,
  });
  assert.equal(ctx.service.getState().current.externalId, 'ccccccccccc');
  assert.equal(ctx.service.getState().status, 'playing');
});

test('native status reports require the active player and current request', async () => {
  await request('aaaaaaaaaaa');
  ctx.service.registerPlayer('active-player');
  const state = ctx.service.getState();

  assert.deepEqual(await ctx.service.playerReport({
    playerId: 'old-player', event: 'paused', requestId: state.current.id,
    position: 20, seekSeq: state.seekSeq, playbackSeq: state.playbackSeq,
  }), { ok: false, active: false });
  await ctx.service.playerReport({
    playerId: 'active-player', event: 'paused', requestId: 'old-request',
    position: 20, seekSeq: state.seekSeq, playbackSeq: state.playbackSeq,
  });
  assert.equal(ctx.service.getState().status, 'playing');
  assert.equal(ctx.service._state.userPaused, false);
});

test('playback revision ignores volume, vote, and progress updates but rejects stale controls', async () => {
  setup({ voting: { needed: 2, blockSec: 0, action: 'skip' } });
  await request('aaaaaaaaaaa');
  ctx.service.registerPlayer('revision-player');
  const initial = ctx.service.getState();

  await vote('voter', 'скип');
  await runTimers();
  ctx.service.setVolume(42);
  ctx.tick(5_001);
  await ctx.service.playerReport({
    playerId: 'revision-player', event: 'progress', requestId: initial.current.id,
    position: 5, seekSeq: initial.seekSeq,
  });
  const afterNoise = ctx.service.getState();
  assert.ok(afterNoise.seq > initial.seq);
  assert.equal(afterNoise.playbackSeq, initial.playbackSeq);

  await ctx.service.playerReport({
    playerId: 'revision-player', event: 'paused', requestId: initial.current.id,
    position: 5, seekSeq: afterNoise.seekSeq, playbackSeq: initial.playbackSeq,
  });
  const paused = ctx.service.getState();
  assert.equal(paused.status, 'paused');
  assert.ok(paused.playbackSeq > initial.playbackSeq);

  await ctx.service.play();
  const resumed = ctx.service.getState();
  assert.equal(resumed.status, 'playing');
  assert.ok(resumed.playbackSeq > paused.playbackSeq);
  await ctx.service.playerReport({
    playerId: 'revision-player', event: 'paused', requestId: initial.current.id,
    position: 10, seekSeq: resumed.seekSeq, playbackSeq: paused.playbackSeq,
  });
  assert.equal(ctx.service.getState().status, 'playing');

  ctx.service.seek(60);
  const sought = ctx.service.getState();
  assert.ok(sought.playbackSeq > resumed.playbackSeq);
  await ctx.service.playerReport({
    playerId: 'revision-player', event: 'paused', requestId: initial.current.id,
    position: 10, seekSeq: resumed.seekSeq, playbackSeq: sought.playbackSeq,
  });
  assert.equal(ctx.service.getState().status, 'playing');
  assert.equal(ctx.service.getState().positionSec, 60);
});

test('native pause and play reports preserve position when the embed omits it', async () => {
  await request('aaaaaaaaaaa');
  ctx.service.registerPlayer('position-player');
  ctx.tick(5_000);
  let state = ctx.service.getState();
  await ctx.service.playerReport({
    playerId: 'position-player', event: 'paused', requestId: state.current.id,
    seekSeq: state.seekSeq, playbackSeq: state.playbackSeq,
  });
  assert.equal(ctx.service.getState().positionSec, 5);
  assert.equal(ctx.service.getState().status, 'paused');

  ctx.tick(10_000);
  state = ctx.service.getState();
  await ctx.service.playerReport({
    playerId: 'position-player', event: 'playing', requestId: state.current.id,
    seekSeq: state.seekSeq, playbackSeq: state.playbackSeq,
  });
  assert.equal(ctx.service.getState().positionSec, 5);
  assert.equal(ctx.service.getState().status, 'playing');
  ctx.tick(1_000);
  assert.equal(ctx.service.getState().positionSec, 6);
});

test('autoplay disabled stops after an ended report and leaves the next request queued', async () => {
  setup({ player: { autoplay: false } });
  await request('aaaaaaaaaaa');
  await request('bbbbbbbbbbb', viewer('bob'));
  await ctx.service.play();
  ctx.service.registerPlayer('manual-player');
  const playing = ctx.service.getState();

  await ctx.service.playerReport({ playerId: 'manual-player', event: 'ended', requestId: playing.current.id });
  assert.equal(ctx.service.getState().current, null);
  assert.equal(ctx.service.getState().status, 'stopped');
  assert.equal(ctx.service._state.userPaused, true);
  assert.deepEqual(queueIds(), ['bbbbbbbbbbb']);
});

test('native playing reports do not cancel warning or player error pauses', async () => {
  setup({ voting: { needed: 1, blockSec: 0, action: 'warning', warningSec: 10 } });
  await request('aaaaaaaaaaa');
  await request('bbbbbbbbbbb', viewer('bob'));
  ctx.service.registerPlayer('warning-player');
  await vote('voter', 'скип');
  const warning = ctx.service.getState();
  assert.ok(warning.warning);

  await ctx.service.playerReport({
    playerId: 'warning-player', event: 'playing', requestId: warning.current.id,
    position: 50, seekSeq: warning.seekSeq, playbackSeq: warning.playbackSeq,
  });
  await ctx.service.playerReport({
    playerId: 'warning-player', event: 'paused', requestId: warning.current.id,
    position: 50, seekSeq: warning.seekSeq, playbackSeq: warning.playbackSeq,
  });
  assert.equal(ctx.service.getState().status, 'paused');
  assert.ok(ctx.service.getState().warning);
  assert.equal(ctx.service._state.userPaused, false);

  setup();
  await request('aaaaaaaaaaa');
  await request('bbbbbbbbbbb', viewer('bob'));
  await request('ccccccccccc', viewer('carol'));
  await request('ddddddddddd', viewer('dave'));
  ctx.service.registerPlayer('error-player');
  for (let i = 0; i < 3; i += 1) {
    const current = ctx.service.getState();
    await ctx.service.playerReport({
      playerId: 'error-player', event: 'error', requestId: current.current.id, errorCode: 101,
    });
  }
  const errorPause = ctx.service.getState();
  assert.ok(errorPause.player.problem);
  assert.equal(errorPause.status, 'paused');
  await ctx.service.playerReport({
    playerId: 'error-player', event: 'playing', requestId: errorPause.current.id,
    position: 1, seekSeq: errorPause.seekSeq, playbackSeq: errorPause.playbackSeq,
  });
  await ctx.service.playerReport({
    playerId: 'error-player', event: 'paused', requestId: errorPause.current.id,
    position: 1, seekSeq: errorPause.seekSeq, playbackSeq: errorPause.playbackSeq,
  });
  assert.equal(ctx.service.getState().status, 'paused');
  assert.ok(ctx.service.getState().player.problem);
  assert.equal(ctx.service._state.userPaused, false);
});

test('playback rate snaps to a supported step and is remembered', () => {
  setup();
  assert.equal(ctx.service.getState().playbackRate, 1);
  assert.equal(ctx.service.setPlaybackRate(1.5).playbackRate, 1.5);
  assert.equal(ctx.service.getState().playbackRate, 1.5);
  assert.equal(ctx.store.get().player.playbackRate, 1.5);
  assert.equal(ctx.service.setPlaybackRate(9).playbackRate, 2);
  assert.equal(ctx.service.setPlaybackRate('нет').ok, false);
  assert.equal(ctx.service.getState().playbackRate, 2);
});
