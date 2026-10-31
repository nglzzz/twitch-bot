'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Handlebars = require('handlebars');
const { test, after } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-quiz-leaderboard-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'quiz-leaderboard.sqlite');

const db = require('../src/app/db');
const quizRepo = require('../src/repositories/quiz.repo');

const stubbedModules = {
  chatters: require.resolve('../src/chat/chatters'),
  channelInfo: require.resolve('../src/twitchApi/channelInfo'),
  token: require.resolve('../src/services/token.service'),
  emotes: require.resolve('../src/services/emoteCatalog.service'),
};
const originalModules = new Map();
for (const filename of Object.values(stubbedModules)) {
  originalModules.set(filename, require.cache[filename]);
  delete require.cache[filename];
}

require.cache[stubbedModules.chatters] = {
  id: stubbedModules.chatters,
  filename: stubbedModules.chatters,
  loaded: true,
  exports: { getLatestChatters: () => [], getRecentMessages: () => [] },
};
require.cache[stubbedModules.channelInfo] = {
  id: stubbedModules.channelInfo,
  filename: stubbedModules.channelInfo,
  loaded: true,
  exports: { getChannelInfo: async () => [] },
};
require.cache[stubbedModules.token] = {
  id: stubbedModules.token,
  filename: stubbedModules.token,
  loaded: true,
  exports: { getTwitchAccessToken: async () => null },
};
require.cache[stubbedModules.emotes] = {
  id: stubbedModules.emotes,
  filename: stubbedModules.emotes,
  loaded: true,
  exports: { loadCatalog: async () => [], getCachedCatalog: () => [] },
};

const siteService = require('../src/services/streamerSite.service');
const statsTemplate = fs.readFileSync(
  path.join(__dirname, '../src/views/pages/stats.handlebars'),
  'utf8'
);

Handlebars.registerHelper('eq', function eq(left, right, options) {
  if (options && typeof options.fn === 'function') {
    return left === right ? options.fn(this) : options.inverse(this);
  }
  return left === right;
});
Handlebars.registerHelper('ne', function ne(left, right, options) {
  if (options && typeof options.fn === 'function') {
    return left !== right ? options.fn(this) : options.inverse(this);
  }
  return left !== right;
});
Handlebars.registerHelper('lt', function lt(left, right, options) {
  if (options && typeof options.fn === 'function') {
    return left < right ? options.fn(this) : options.inverse(this);
  }
  return left < right;
});
Handlebars.registerHelper('or', (...args) => args.slice(0, -1).some(Boolean));
Handlebars.registerHelper('toString', (value) => String(value == null ? '' : value));

after(() => {
  if (db.open) db.close();
  for (const [filename, original] of originalModules.entries()) {
    if (original) require.cache[filename] = original;
    else delete require.cache[filename];
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('quiz scores appear in the stats API, page data, and escaped ranked template', async (t) => {
  assert.equal(db.isDbReady(), true);
  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });

  try {
    await t.test('populated leaderboard is ranked and escaped in the rendered stats page', async () => {
      quizRepo.addPoint({ userId: 'user-z', username: 'zeta', displayName: '<img src=x onerror=alert(1)>' });
      quizRepo.addPoint({ userId: 'user-a', username: 'alpha', displayName: 'Alpha' });
      quizRepo.addPoint({ userId: 'user-z', username: 'zeta', displayName: '<img src=x onerror=alert(1)>' });
      quizRepo.addPoint({ userId: 'user-b', username: 'beta', displayName: 'Beta' });
      quizRepo.addPoint({ userId: 'user-b', username: 'beta', displayName: 'Beta' });
      quizRepo.addPoint({ userId: 'user-b', username: 'beta', displayName: 'Beta' });
      quizRepo.addPoint({ userId: 'user-z', username: 'zeta', displayName: '<img src=x onerror=alert(1)>' });

      const apiData = await siteService.getStatsApiData('localhost', {});
      assert.equal(apiData.quizLeaderboard.hasPlayers, true);
      assert.deepEqual(apiData.quizLeaderboard.players.map(({ position, displayName, points }) => ({
        position,
        displayName,
        points,
      })), [
        { position: 1, displayName: 'Beta', points: 3 },
        { position: 2, displayName: '<img src=x onerror=alert(1)>', points: 3 },
        { position: 3, displayName: 'Alpha', points: 1 },
      ]);

      const pageData = await siteService.buildStatsPageData('localhost', {});
      assert.deepEqual(pageData.quizLeaderboard.players.map((player) => player.position), [1, 2, 3]);
      const html = Handlebars.compile(statsTemplate)(pageData);
      assert.match(html, /Лидерборд викторины/);
      assert.match(html, /#1/);
      assert.match(html, /#2/);
      assert.match(html, /#3/);
      assert.match(html, /&lt;img src&#x3D;x onerror&#x3D;alert\(1\)&gt;/);
      assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);

      // A renamed Twitch account keeps its accumulated total because identity is keyed by user ID.
      quizRepo.addPoint({ userId: 'user-z', username: 'zeta_new', displayName: 'Zeta New' });
      assert.equal(quizRepo.getScore('user-z'), 4);
      assert.equal(quizRepo.getLeaderboard(20).find((player) => player.login === 'zeta_new').displayName, 'Zeta New');
    });

    await t.test('empty score table returns an empty state in the API and rendered page', async () => {
      db.exec('DELETE FROM quiz_score');

      const apiData = await siteService.getStatsApiData('localhost', {});
      assert.deepEqual(apiData.quizLeaderboard, { players: [], hasPlayers: false });

      const pageData = await siteService.buildStatsPageData('localhost', {});
      assert.deepEqual(pageData.quizLeaderboard, { players: [], hasPlayers: false });
      const html = Handlebars.compile(statsTemplate)(pageData);
      assert.match(html, /Пока никто не набрал очки/);
      assert.doesNotMatch(html, /leaderboard-item__position">#1/);
    });
  } finally {
    global.setInterval = originalSetInterval;
  }
});
