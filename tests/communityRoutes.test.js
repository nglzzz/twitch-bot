'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const handlebars = require('express-handlebars');
const { after, test } = require('node:test');
const { createCommunityRouter } = require('../src/webserver/community.routes');

const COMMUNITY_PAGE = {
  available: true,
  selectedBoard: 'games',
  selectedMode: 'all',
  selectedUser: '',
  boards: [{ value: 'games', label: 'Знатоки игр' }, { value: 'chat', label: 'Голоса чата' }],
  modes: [{ value: 'all', label: 'Все игры' }, { value: 'quiz', label: 'Викторина' }],
  stats: { totalPlayers: 1, totalMessages: 18, totalAnswers: 7, activeStreams: 2 },
  hasPlayers: true,
  leaderboardTitle: 'Общий зачёт игр чата',
  podium: [{ position: 1, displayName: '<img src=x onerror=alert(1)>', login: 'alice', initial: 'A', score: 7, scoreLabel: 'очков', href: '/users/alice' }],
  players: [{ position: 1, displayName: '<img src=x onerror=alert(1)>', login: 'alice', initial: 'A', score: 7, scoreLabel: 'очков', href: '/users/alice' }],
};

const PROFILE = {
  available: true,
  found: true,
  login: 'alice',
  displayName: '<img src=x onerror=alert(1)>',
  initial: 'A',
  title: 'Эрудит чата',
  characterization: '100 правильных ответов в играх чата.',
  level: 2,
  experience: 100,
  twitchUrl: 'https://www.twitch.tv/alice',
  stats: { totalMessages: 42, streamsAttended: 5, maxMessagesPerStream: 12, quizAnswers: 100, chatRank: 3, gameRank: 1 },
  gameModes: [{ id: 'quiz', label: 'Викторина', icon: '❓', wins: 100, winsLabel: 'побед' }],
  achievements: [{ title: 'Первый сигнал', description: 'Написать первое сообщение.', icon: '✦', unlocked: true, progressLabel: 'Получено', progress: 1, target: 1 }],
  earnedAchievements: 1,
  achievementCount: 1,
  notes: ['В статистику сообщений попадает обычный текст чата.'],
};

function createApp({ ready = true, profile = PROFILE } = {}) {
  const calls = { getCommunity: [], getProfile: [] };
  const service = {
    getCommunity(filters) {
      calls.getCommunity.push(filters);
      return { ...COMMUNITY_PAGE, selectedBoard: filters?.board || 'games', selectedMode: filters?.mode || 'all' };
    },
    getProfile(login) {
      calls.getProfile.push(login);
      return profile;
    },
  };

  const app = express();
  app.engine('handlebars', handlebars({
    defaultLayout: false,
    helpers: {
      eq(left, right, options) {
        const matches = left === right;
        return options && typeof options.fn === 'function'
          ? (matches ? options.fn(this) : options.inverse(this))
          : matches;
      },
    },
  }));
  app.set('views', path.resolve(__dirname, '../src/views'));
  app.set('view engine', 'handlebars');
  app.use('/', createCommunityRouter({ service, isReady: () => ready, navigation: () => [] }));

  const server = app.listen(0, '127.0.0.1');
  return {
    app,
    calls,
    server,
    baseUrl: new Promise((resolve) => server.once('listening', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    })),
  };
}

const servers = new Set();
async function request(url, options) {
  const instance = createApp(options);
  servers.add(instance.server);
  const baseUrl = await instance.baseUrl;
  const response = await fetch(`${baseUrl}${url}`, { redirect: 'manual' });
  return { response, instance, body: await response.text() };
}

after(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

test('community accepts supported board and game mode filters', async () => {
  const { response, instance } = await request('/community?board=games&mode=quiz');
  assert.equal(response.status, 200);
  assert.deepEqual(instance.calls.getCommunity, [{ board: 'games', mode: 'quiz' }]);

  const chat = await request('/community?board=chat&mode=quiz');
  assert.equal(chat.response.status, 200);
  assert.deepEqual(chat.instance.calls.getCommunity, [{ board: 'chat', mode: 'all' }]);
});

test('community search normalizes and redirects valid Twitch logins', async () => {
  const { response, instance } = await request('/community?user=%40AlIcE_123');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/users/alice_123');
  assert.deepEqual(instance.calls.getProfile, []);
});

test('community rejects malformed filters and duplicate or array query values', async () => {
  for (const url of [
    '/community?board=unknown',
    '/community?mode=unknown',
    '/community?board=games&board=chat',
    '/community?mode=all&mode=quiz',
    '/community?user=alice&user=bob',
    '/community?user=%3Cscript%3E',
  ]) {
    const { response } = await request(url);
    assert.equal(response.status, 400, url);
  }

  const apiArray = await request('/api/community/leaderboard?board=games&board=chat');
  assert.equal(apiArray.response.status, 400);
  assert.deepEqual(JSON.parse(apiArray.body), { error: 'Invalid leaderboard or game mode' });
});

test('community page returns a service unavailable response when storage is offline', async () => {
  const { response, instance } = await request('/community', { ready: false });
  assert.equal(response.status, 503);
  assert.deepEqual(instance.calls.getCommunity, []);
});

test('user profiles normalize logins, return not found, and render escaped content', async () => {
  const success = await request('/users/%40AlIcE');
  assert.equal(success.response.status, 200);
  assert.deepEqual(success.instance.calls.getProfile, ['alice']);
  assert.match(success.body, /&lt;img src&#x3D;x onerror&#x3D;alert\(1\)&gt;/);
  assert.doesNotMatch(success.body, /<img src=x onerror=alert\(1\)>/);
  assert.match(success.body, /100 правильных ответов в играх чата\./);

  const notFound = await request('/users/does_not_exist', { profile: null });
  assert.equal(notFound.response.status, 404);
  assert.match(notFound.body, /Пока не знаем этого участника/);

  const invalid = await request('/users/%40bad%2Elogin');
  assert.equal(invalid.response.status, 404);
  assert.deepEqual(invalid.instance.calls.getProfile, []);
});

test('profile page reports unavailable storage without querying the profile service', async () => {
  const { response, instance } = await request('/users/alice', { ready: false });
  assert.equal(response.status, 503);
  assert.deepEqual(instance.calls.getProfile, []);
});

test('leaderboard API validates filters, handles unavailable storage, and returns public data', async () => {
  const success = await request('/api/community/leaderboard?board=games&mode=quiz');
  assert.equal(success.response.status, 200);
  assert.deepEqual(success.instance.calls.getCommunity, [{ board: 'games', mode: 'quiz' }]);
  const leaderboard = JSON.parse(success.body);
  assert.equal(leaderboard.selectedMode, 'quiz');
  assert.equal(leaderboard.players[0].login, 'alice');
  assert.doesNotMatch(JSON.stringify(leaderboard), /userId|accessToken|password/i);

  const invalid = await request('/api/community/leaderboard?mode[]=quiz');
  assert.equal(invalid.response.status, 400);

  const unavailable = await request('/api/community/leaderboard', { ready: false });
  assert.equal(unavailable.response.status, 503);
  assert.deepEqual(JSON.parse(unavailable.body), { error: 'Community data is temporarily unavailable' });
});

test('profile API normalizes logins, returns public profile fields, and handles 404/503', async () => {
  const success = await request('/api/community/users/%40AlIcE');
  assert.equal(success.response.status, 200);
  assert.deepEqual(success.instance.calls.getProfile, ['alice']);
  const profile = JSON.parse(success.body);
  assert.equal(profile.login, 'alice');
  assert.equal(profile.stats.quizAnswers, 100);
  assert.ok(Array.isArray(profile.achievements));
  assert.doesNotMatch(JSON.stringify(profile), /userId|accessToken|password/i);

  const invalid = await request('/api/community/users/%40bad%2Elogin');
  assert.equal(invalid.response.status, 404);
  assert.deepEqual(JSON.parse(invalid.body), { error: 'User not found' });

  const unavailable = await request('/api/community/users/alice', { ready: false });
  assert.equal(unavailable.response.status, 503);
  assert.deepEqual(JSON.parse(unavailable.body), { error: 'Community data is temporarily unavailable' });
});
