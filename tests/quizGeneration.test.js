'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-generation-'));
process.env.SQLITE_PATH = path.join(directory, 'test.sqlite');
const db = require('../src/app/db');
const repository = require('../src/repositories/quizQuestion.repo');
const scoreRepository = require('../src/repositories/quiz.repo');
const { createQuizQuestionProvider } = require('../src/services/quizQuestions.service');
const { createQuizEngine } = require('../src/services/quizEngine');

after(() => {
  if (db.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('generated batches survive provider restart and feed scored rounds without repeated answers', async () => {
  let time = Date.parse('2026-10-31T12:00:00Z');
  const targets = ['париж', 'лондон', 'берлин', 'мадрид', 'рим', 'минск', 'москва', 'прага', 'вена', 'токио',
    'осло', 'хельсинки', 'стокгольм', 'лиссабон', 'амстердам', 'варшава', 'пекин', 'дели', 'каир', 'канберра'];
  let requests = 0;
  const provider = createQuizQuestionProvider({
    repository,
    fallbackWords: [],
    now: () => time,
    generate: async () => {
      requests += 1;
      return JSON.stringify({ questions: targets.map((answer, index) => ({
        question: `Какой город зашифрован в задании номер ${index + 1}?`, answer,
      })) });
    },
  });
  const stream = { id: 'integration-stream', started_at: new Date(time).toISOString() };
  const messages = [];
  const player = { 'user-id': 'player-id', username: 'player', badges: {} };
  const answers = [];

  async function play(questionProvider) {
    const engine = createQuizEngine({
      questionProvider, repository: scoreRepository, getStream: async () => stream,
      now: () => time, send: (message) => messages.push(message),
    });
    await engine.start(player);
    for (let round = 0; round < 10; round += 1) {
      const answer = engine.getState().answer;
      answers.push(answer);
      assert.equal(engine.guess(player, answer.toUpperCase()), true);
      if (round < 9) {
        time += 5000;
        await engine.tick();
      }
    }
    assert.equal(engine.getState(), null);
  }

  await play(provider);
  assert.equal(requests, 1);
  const restoredProvider = createQuizQuestionProvider({
    repository, fallbackWords: [], now: () => time,
    generate: async () => { throw new Error('API offline after restart'); },
  });
  await play(restoredProvider);

  assert.equal(new Set(answers).size, 20);
  assert.equal(scoreRepository.getScore('player-id'), 20);
  assert.equal(repository.findUnused(stream.id, 100).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM quiz_question_use').get().count, 20);
  assert.ok(messages.some((message) => message.includes('Викторина завершена')));
});
