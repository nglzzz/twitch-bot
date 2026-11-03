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

test('all game modes use separate persisted pools and award shared points', async () => {
  const stream = { id: 'multimode-stream', started_at: '2026-10-31T08:00:00Z' };
  const fallbackSets = {
    quiz: [],
    anagram: [{ clue: 'Анаграмма: планета', answers: ['планета'] }],
    game: [{ clue: '👨‍🔬 🔫 👽', answers: ['Халф Лайф 2', 'Half-Life 2'] }],
    movie: [{ clue: '🚢 🧊 💔', answers: ['Титаник', 'Titanic'] }],
  };
  const messages = [];
  const player = { 'user-id': 'multimode-player', username: 'player', badges: {} };
  const makeProvider = () => createQuizQuestionProvider({
    repository, fallbackSets, generate: async () => '{}',
  });
  const engine = createQuizEngine({
    questionProvider: makeProvider(), repository: scoreRepository,
    getStream: async () => stream, send: (message) => messages.push(message), roundCount: 1,
  });

  for (const [mode, answer] of [['anagram', 'планета'], ['game', 'HALF-LIFE   2'], ['movie', 'Titanic!']]) {
    const before = messages.length;
    assert.equal(await engine.start(player, mode), true);
    const clue = engine.getState().clue;
    assert.ok(clue);
    if (mode === 'anagram') {
      assert.ok(!messages.slice(before).some((message) => message.toLowerCase().includes('планета')));
      assert.deepEqual(clue.replace(/^Анаграмма:\s*/, '').toLowerCase().split(/\s+/).sort(), Array.from('планета').sort());
    } else {
      assert.equal(clue, fallbackSets[mode][0].clue);
    }
    assert.equal(engine.guess(player, answer), true);
    assert.equal(engine.getState(), null);
    assert.equal(repository.findUnused(stream.id, 10, mode).length, 0);
  }

  assert.equal(scoreRepository.getScore('multimode-player'), 3);
  assert.equal(scoreRepository.hasStarted(stream.id), true);
  const recreatedEngine = createQuizEngine({
    questionProvider: makeProvider(), repository: scoreRepository,
    getStream: async () => stream, send: (message) => messages.push(message), roundCount: 1,
  });
  assert.equal(await recreatedEngine.start(player, 'movie'), false, 'used movie stays unavailable after provider recreation');
  await recreatedEngine.tick();
  assert.equal(recreatedEngine.getState(), null, 'manual modes suppress the automatic quiz');
});
