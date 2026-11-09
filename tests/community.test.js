'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');
const handlebars = require('express-handlebars');
const { createCommunityRouter } = require('../src/webserver/community.routes');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-community-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const communityRepo = require('../src/repositories/community.repo');
const communityService = require('../src/services/community.service');
const quizRepo = require('../src/repositories/quiz.repo');
const chatLogRepo = require('../src/repositories/chatLog.repo');
const ACHIEVEMENTS = require('../src/data/achievements');
const TEST_BASE_TIME = Date.now();

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('real community service renders linked leaderboards and all profile achievements over HTTP', async () => {
  communityRepo.recordChat({ userId: 'http-viewer-id', username: 'http_viewer', displayName: 'HTTP Viewer', message: 'Private message body', messageId: 'http-message' });
  quizRepo.addPoint({ userId: 'http-viewer-id', username: 'http_viewer', displayName: 'HTTP Viewer', mode: 'movie' });
  const app = express();
  app.engine('handlebars', handlebars({ defaultLayout: 'main', helpers: {
    eq(left, right, options) { return left === right ? options.fn(this) : options.inverse(this); },
    or(...args) { return args.slice(0, -1).some(Boolean); },
  } }));
  app.set('view engine', 'handlebars');
  app.set('views', path.resolve(__dirname, '../src/views'));
  app.use(createCommunityRouter({ service: communityService, isReady: db.isDbReady, navigation: () => [{ label: 'Сообщество', href: '/community', isActive: true }] }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const leaderboard = await fetch(`${base}/community?board=games&mode=movie`);
    assert.equal(leaderboard.status, 200);
    const leaderboardHtml = await leaderboard.text();
    assert.match(leaderboardHtml, /href="\/users\/http_viewer"/);
    assert.match(leaderboardHtml, /HTTP Viewer/);
    const profile = await fetch(`${base}/users/http_viewer`);
    assert.equal(profile.status, 200);
    const profileHtml = await profile.text();
    assert.match(profileHtml, /Маленькие поводы для гордости/);
    assert.equal((profileHtml.match(/<li class="community-achievement /g) || []).length, 51);
    assert.match(profileHtml, /Private message body/);
    assert.doesNotMatch(profileHtml, /http-viewer-id/);
    const api = await fetch(`${base}/api/community/users/http_viewer`);
    const body = await api.json();
    assert.equal(body.stats.quizAnswers, 1);
    assert.equal(body.gameModes.find((mode) => mode.id === 'movie').wins, 1);
    assert.equal(body.history.messages[0].text, "Private message body");
    assert.doesNotMatch(JSON.stringify(body), /http-viewer-id/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.prepare("DELETE FROM chat_log WHERE user_id = 'http-viewer-id'").run();
    db.prepare("DELETE FROM quiz_score WHERE user_id = 'http-viewer-id'").run();
    db.prepare("DELETE FROM community_user WHERE user_id = 'http-viewer-id'").run();
  }
});

function createStream(id) {
  db.prepare(`INSERT INTO stream_session (id, status, created_at, updated_at)
    VALUES (?, 'ended', ?, ?)` ).run(id, Date.now(), Date.now());
}

function chat({ id, streamSessionId = 'stream-a', userId = 'twitch-1', username = 'sample_user', message = 'Привет', index = 1 }) {
  return communityRepo.recordChat({
    userId,
    username,
    displayName: 'Sample User',
    message,
    messageId: id,
    streamSessionId,
    createdAt: TEST_BASE_TIME + index,
  });
}

test('community events are deduplicated, aggregated, and stable across username changes', () => {
  assert.equal(db.isDbReady(), true);
  createStream('stream-a');
  createStream('stream-b');

  assert.deepEqual(chat({ id: 'message-1' }), { inserted: true, userId: 'twitch-1' });
  assert.deepEqual(chat({ id: 'message-1' }), { inserted: false, userId: 'twitch-1' });
  for (let index = 2; index <= 100; index += 1) {
    chat({ id: `message-${index}`, index });
  }
  chat({ id: 'offline-message', streamSessionId: null, index: 101 });
  chat({ id: 'message-102', streamSessionId: 'stream-b', index: 102 });

  communityRepo.recordFollow({ userId: 'twitch-1', username: 'sample_user', displayName: 'Sample User', followedAt: 1_700_000_000_200 });
  communityRepo.recordFollow({ userId: 'twitch-1', username: 'sample_user', displayName: 'Sample User', followedAt: 1_700_000_000_250 });
  quizRepo.addPoint({ userId: 'twitch-1', username: 'sample_user', displayName: 'Sample User', createdAt: TEST_BASE_TIME + 102 });
  communityRepo.recordQuizWin({ userId: 'twitch-1', username: 'sample_user', displayName: 'Sample User', mode: 'anagram', streamId: 'stream-a', createdAt: TEST_BASE_TIME + 102 });

  const profile = communityService.getProfile('sample_user');
  assert.equal(profile.stats.totalMessages, 102);
  assert.equal(profile.stats.streamsAttended, 2);
  assert.equal(profile.stats.maxMessagesPerStream, 100);
  assert.equal(profile.stats.quizAnswers, 1);
  assert.equal(profile.followedAt, 1_700_000_000_200);
  assert.equal(profile.achievements.find((item) => item.id === 'messages_100').unlocked, true);
  assert.equal(profile.achievements.find((item) => item.id === 'stream_messages_100').unlocked, true);
  assert.equal(profile.achievements.find((item) => item.id === 'quiz_1').unlocked, true);
  assert.equal(profile.achievements.find((item) => item.id === 'follow').unlocked, true);
  assert.equal(Object.hasOwn(profile, 'userId'), false);

  chat({ id: 'rename-message', username: 'renamed_user', index: 103 });
  communityRepo.recordFollow({
    userId: 'twitch-1', username: 'sample_user', displayName: 'Stale Name', followedAt: 1_600_000_000_000,
  });
  assert.equal(communityService.getProfile('sample_user').login, 'renamed_user');
  const renamedProfile = communityService.getProfile('renamed_user');
  assert.equal(renamedProfile.stats.totalMessages, 103);
  assert.equal(renamedProfile.displayName, 'Sample User');

  const games = communityService.getCommunity({ board: 'games', mode: 'all' });
  const anagrams = communityService.getCommunity({ board: 'games', mode: 'anagram' });
  const chatters = communityService.getCommunity({ board: 'chat' });
  assert.equal(games.players[0].score, 1);
  assert.equal(anagrams.players[0].score, 1);
  assert.equal(anagrams.players[0].login, 'renamed_user');
  assert.equal(chatters.players[0].score, 103);
  assert.equal(chatters.podium.length, 1);
});

test('quiz-only profiles and legacy chat-only profiles can be opened by login', () => {
  quizRepo.addPoint({ userId: 'quiz-only-id', username: 'quiz_only', displayName: 'Quiz Only' });
  quizRepo.addPoint({ userId: 'quiz-only-id', username: 'quiz_only', displayName: 'Quiz Only' });

  const quizOnlyProfile = communityService.getProfile('quiz_only');
  assert.equal(quizOnlyProfile.stats.quizAnswers, 2);
  assert.equal(quizOnlyProfile.stats.totalMessages, 0);

  chatLogRepo.insert({ user: 'old_chatter', displayName: 'Old Chatter', message: 'Сообщение до привязки ID' });
  const legacyProfile = communityService.getProfile('old_chatter');
  assert.equal(legacyProfile.stats.totalMessages, 1);
  assert.equal(legacyProfile.stats.chatRank, 2);
  assert.ok(legacyProfile.notes.some((note) => /Twitch ID/.test(note)));
});

test('historical quiz players with legacy chat rows have the same chat rank as the leaderboard', () => {
  db.prepare(`INSERT INTO quiz_score (user_id, username, display_name, points, updated_at)
    VALUES ('historical-player-id', 'historical_player', 'Historical Player', 10, 123)`).run();
  chatLogRepo.insert({ user: 'historical_player', displayName: 'Historical Player', message: 'До обновления' });
  const profile = communityService.getProfile('historical_player');
  const row = communityService.getCommunity({ board: 'chat' }).players.find((player) => player.login === 'historical_player');
  assert.equal(profile.stats.totalMessages, 1);
  assert.equal(profile.stats.chatRank, row.position);
});

test('reused Twitch login follows the latest identity without merging stable histories', () => {
  createStream('reuse-stream');
  const legacyAt = Date.now();
  chatLogRepo.insert({ user: 'reused_login', displayName: 'Old Name', message: 'Старое сообщение' });
  quizRepo.addPoint({ userId: 'previous-owner', username: 'reused_login', displayName: 'Previous Owner' });
  communityRepo.recordChat({
    userId: 'previous-owner', username: 'reused_login', displayName: 'Previous Owner',
    message: 'История старого аккаунта', streamSessionId: 'reuse-stream', messageId: 'previous-owner-message', createdAt: legacyAt - 1000,
  });

  quizRepo.addPoint({ userId: 'aaa-player', username: 'aaa_login', displayName: 'AAA Player' });
  const currentSeenAt = Date.now() + 60_000;
  quizRepo.addPoint({
    userId: 'current-owner', username: 'reused_login', displayName: 'Current Owner', createdAt: currentSeenAt,
  });
  communityRepo.recordChat({
    userId: 'current-owner', username: 'reused_login', displayName: 'Current Owner',
    message: 'Новое сообщение', streamSessionId: 'reuse-stream', messageId: 'current-owner-message', createdAt: currentSeenAt,
  });

  const profile = communityService.getProfile('reused_login');
  assert.equal(profile.displayName, 'Current Owner');
  assert.equal(profile.stats.totalMessages, 2);

  const chatLeaderboard = communityService.getCommunity({ board: 'chat' });
  const currentChatter = chatLeaderboard.players.filter((player) => player.login === 'reused_login');
  assert.equal(currentChatter.length, 1);
  assert.equal(currentChatter[0].displayName, 'Current Owner');

  const gameLeaderboard = communityService.getCommunity({ board: 'games' });
  const currentPlayer = gameLeaderboard.players.filter((player) => player.login === 'reused_login');
  assert.equal(currentPlayer.length, 1);
  assert.equal(currentPlayer[0].displayName, 'Current Owner');
  assert.equal(profile.stats.gameRank, currentPlayer[0].position);

  communityRepo.recordFollow({
    userId: 'previous-owner', username: 'reused_login', displayName: 'Previous Owner',
    followedAt: legacyAt - 2000,
  });
  communityRepo.recordFollow({
    userId: 'previous-owner', username: 'reused_login', displayName: 'Previous Owner',
    followedAt: legacyAt - 2000,
  });
  assert.equal(communityService.getProfile('reused_login').displayName, 'Current Owner');
  assert.equal(communityService.getCommunity({ board: 'chat' }).players.find((player) => player.login === 'reused_login').displayName, 'Current Owner');
});

test('quiz score and per-mode result commit together', () => {
  const originalRecordQuizWin = communityRepo.recordQuizWin;
  try {
    communityRepo.recordQuizWin = () => { throw new Error('Mode event could not be stored'); };
    assert.throws(() => quizRepo.addPoint({
      userId: 'rollback-user', username: 'rollback_user', displayName: 'Rollback User', mode: 'movie',
    }), /Mode event could not be stored/);
    assert.equal(quizRepo.getScore('rollback-user'), 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM community_user WHERE user_id = ?').get('rollback-user').count, 0);
  } finally {
    communityRepo.recordQuizWin = originalRecordQuizWin;
  }

  assert.equal(quizRepo.addPoint({
    userId: 'rollback-user', username: 'rollback_user', displayName: 'Rollback User', mode: 'movie', streamId: 'film-stream',
  }), 1);
  assert.equal(communityService.getCommunity({ board: 'games', mode: 'movie' }).players[0].score, 1);
});

test('schema upgrade preserves old chat rows and safely adds identity columns once', () => {
  const { STATEMENTS, upgradeSchema } = require('../src/app/schema');
  const legacyDb = new Database(':memory:');
  try {
    for (const statement of STATEMENTS) {
      const oldStatement = statement
        .replace('    user_id TEXT,\n    message_id TEXT,\n', '')
        .replace("    mode TEXT NOT NULL DEFAULT 'quiz',\n", '');
      legacyDb.exec(oldStatement);
    }
    legacyDb.prepare(`INSERT INTO chat_log (id, user, display_name, message, created_at, updated_at)
      VALUES ('legacy-row', 'old_user', 'Old User', 'Привет', 100, 100)`).run();

    upgradeSchema(legacyDb);
    upgradeSchema(legacyDb);

    const row = legacyDb.prepare('SELECT id, user, message, user_id, message_id FROM chat_log').get();
    assert.deepEqual(row, {
      id: 'legacy-row', user: 'old_user', message: 'Привет', user_id: null, message_id: null,
    });
    assert.ok(legacyDb.prepare('PRAGMA table_info(quiz_question)').all().some((column) => column.name === 'mode'));

    const insert = legacyDb.prepare(`INSERT INTO chat_log
      (id, user, user_id, message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
    insert.run('message-a', 'new_user', 'twitch-a', 'twitch-message-id', 200, 200);
    assert.throws(() => insert.run('message-b', 'new_user', 'twitch-a', 'twitch-message-id', 201, 201), /UNIQUE constraint failed/);
  } finally {
    legacyDb.close();
  }
});

test('all 51 achievement thresholds unlock at the boundary and stay locked below it', () => {
  function metricsFor(achievement, current) {
    const stats = {
      totalMessages: 0,
      maxMessagesPerStream: 0,
      streamsAttended: 0,
      followedAt: null,
      quizAnswers: 0,
    };
    const modes = {};
    switch (achievement.metric) {
      case 'messages': stats.totalMessages = current; break;
      case 'streamMessages': stats.maxMessagesPerStream = current; break;
      case 'streams': stats.streamsAttended = current; break;
      case 'follow': stats.followedAt = current ? 1 : null; break;
      case 'followDays':
        stats.followStatus = true;
        stats.currentFollowedAt = Date.now() - current * 86400000;
        stats.followCheckedAt = Date.now();
        break;
      case 'twitchPaidSubscription': stats.twitchPaidSubscription = current > 0; break;
      case 'boostyPaidSubscription': stats.boostyPaidSubscription = current > 0; break;
      case 'quizAnswers': stats.quizAnswers = current; break;
      case 'pointsSpent': stats.pointsSpent = current; break;
      case 'memesSent': stats.memesSent = current; break;
      case 'donationsCount': stats.donationsCount = current; break;
      case 'musicFree': case 'musicPaid': case 'videoFree': case 'videoPaid':
      case 'donationsDonationAlerts': case 'donationsStreamElements': case 'donationsDonatePay': case 'donationsDonatex':
        stats[achievement.metric] = current; break;
      case 'quizModeWins': modes.quiz = current; break;
      case 'anagramWins': modes.anagram = current; break;
      case 'gameWins': modes.game = current; break;
      case 'movieWins': modes.movie = current; break;
      default: throw new Error(`Unhandled achievement metric: ${achievement.metric}`);
    }
    return { stats, modes };
  }

  assert.equal(ACHIEVEMENTS.length, 51);
  for (const achievement of ACHIEVEMENTS) {
    const belowTarget = metricsFor(achievement, achievement.target - 1);
    const locked = communityService.makeAchievements(belowTarget.stats, belowTarget.modes)
      .find((entry) => entry.id === achievement.id);
    assert.equal(locked.unlocked, false, `${achievement.id} should be locked below its target`);

    const atTarget = metricsFor(achievement, achievement.target);
    const earned = communityService.makeAchievements(atTarget.stats, atTarget.modes)
      .find((entry) => entry.id === achievement.id);
    assert.equal(earned.unlocked, true, `${achievement.id} should unlock at its target`);
    assert.equal(earned.progress, achievement.target);
    assert.equal(earned.percent, 100);
  }
});

test('community leaderboards, counts, and profile ranks exclude known bots', () => {
  const baselineCounts = {
    games: communityRepo.countPlayers('games'),
    movies: communityRepo.countPlayers('mode', 'movie'),
    chat: communityRepo.countPlayers('chat'),
  };

  quizRepo.addPoint({ userId: 'ranking-human-id', username: 'ranking_human', displayName: 'Ranking Human', mode: 'movie' });
  quizRepo.addPoint({ userId: 'ranking-human-id', username: 'ranking_human', displayName: 'Ranking Human', mode: 'movie' });
  for (let index = 0; index < 120; index += 1) {
    chatLogRepo.insert({ user: 'ranking_human', displayName: 'Ranking Human', message: 'Привет' });
  }

  for (let index = 0; index < 3; index += 1) {
    quizRepo.addPoint({ userId: 'ranking-nightbot-id', username: 'Nightbot', displayName: 'Nightbot', mode: 'movie' });
  }
  for (let index = 0; index < 160; index += 1) {
    chatLogRepo.insert({ user: 'Nightbot', displayName: 'Nightbot', message: 'Сообщение бота' });
  }
  chatLogRepo.insert({ user: 'StreamElements', displayName: 'StreamElements', message: 'Старое сообщение бота без Twitch ID' });

  const games = communityRepo.getLeaderboard({ board: 'games' });
  const movies = communityRepo.getLeaderboard({ board: 'mode', mode: 'movie' });
  const chatters = communityRepo.getLeaderboard({ board: 'chat' });
  const humanGame = games.find((player) => player.login === 'ranking_human');
  const humanMovie = movies.find((player) => player.login === 'ranking_human');
  const humanChatter = chatters.find((player) => player.login === 'ranking_human');

  assert.ok(humanGame);
  assert.ok(humanMovie);
  assert.ok(humanChatter);
  const humanRanks = communityRepo.getProfileRanks({ userId: 'ranking-human-id', username: 'ranking_human' });
  assert.equal(humanGame.position, humanRanks.gameRank);
  assert.equal(humanChatter.position, humanRanks.chatRank);
  assert.equal(games.some((player) => ['nightbot', 'streamelements'].includes(player.login)), false);
  assert.equal(movies.some((player) => ['nightbot', 'streamelements'].includes(player.login)), false);
  assert.equal(chatters.some((player) => ['nightbot', 'streamelements'].includes(player.login)), false);
  assert.equal(communityRepo.countPlayers('games'), baselineCounts.games + 1);
  assert.equal(communityRepo.countPlayers('mode', 'movie'), baselineCounts.movies + 1);
  assert.equal(communityRepo.countPlayers('chat'), baselineCounts.chat + 1);
  assert.deepEqual(communityRepo.getProfileRanks({ userId: 'ranking-nightbot-id', username: 'nightbot' }), {
    chatRank: null,
    gameRank: null,
  });
});
