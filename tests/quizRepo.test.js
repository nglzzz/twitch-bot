'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-quiz-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const quizRepo = require('../src/repositories/quiz.repo');

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('quiz stream start marker is idempotent and independent per stream', () => {
  assert.equal(quizRepo.hasStarted('stream-a'), false);
  assert.equal(quizRepo.markStarted('stream-a', 1234), true);
  assert.equal(quizRepo.hasStarted('stream-a'), true);
  quizRepo.markStarted('stream-a', 9999);
  assert.equal(db.prepare('SELECT started_at FROM quiz_stream WHERE stream_id = ?').get('stream-a').started_at, 1234);
  assert.equal(quizRepo.hasStarted('stream-b'), false);
});

test('quiz scores increment by stable user id and leaderboard is ranked', () => {
  assert.equal(quizRepo.getScore('user-1'), 0);
  assert.equal(quizRepo.addPoint({ userId: 'user-1', username: 'First', displayName: 'Первый' }), 1);
  assert.equal(quizRepo.addPoint({ userId: 'user-1', username: 'first', displayName: 'Первый' }), 2);
  assert.equal(quizRepo.addPoint({ userId: 'user-2', username: 'second', displayName: 'Второй' }), 1);
  assert.equal(quizRepo.getScore('user-1'), 2);
  assert.deepEqual(quizRepo.getTop(), [
    { username: 'Первый', points: 2 },
    { username: 'Второй', points: 1 },
  ]);
  assert.deepEqual(quizRepo.getLeaderboard(1), [
    { position: 1, login: 'first', displayName: 'Первый', points: 2 },
  ]);
});

