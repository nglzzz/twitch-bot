'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createQuizQuestionProvider,
  parseGeneratedQuestions,
} = require('../src/services/quizQuestions.service');

function generatedQuestion(index) {
  const answers = [
    'компас', 'термометр', 'микроскоп', 'телескоп', 'будильник',
    'зеркало', 'микрофон', 'фонарик', 'рюкзак', 'скрепка',
    'линейка', 'ластик', 'конверт', 'радуга', 'вулкан',
    'айсберг', 'кактус', 'бобр', 'дятел', 'хамелеон',
  ];
  return {
    question: `Вопрос о достопримечательности номер ${index}?`,
    answer: answers[index],
  };
}

function createRepository() {
  const rows = new Map();
  const usedByStream = new Map();
  let nextId = 1;

  function answerKey(answers) {
    return String(answers[0] || '').toLowerCase().replace(/ё/g, 'е');
  }

  return {
    rows,
    saveQuestions(questions, source) {
      let inserted = 0;
      for (const question of questions) {
        const key = answerKey(question.answers);
        if ([...rows.values()].some((row) => row.answerKey === key)) continue;
        const id = `question-${nextId++}`;
        rows.set(id, { id, ...question, source, answerKey: key });
        inserted += 1;
      }
      return inserted;
    },
    findUnused(streamId, limit) {
      const used = usedByStream.get(streamId) || new Set();
      return [...rows.values()]
        .filter((row) => !used.has(row.id))
        .sort((left, right) => (left.source === right.source ? 0 : left.source === 'ai' ? -1 : 1))
        .slice(0, limit);
    },
    markUsed(streamId, questions) {
      let used = usedByStream.get(streamId);
      if (!used) {
        used = new Set();
        usedByStream.set(streamId, used);
      }
      questions.forEach((question) => used.add(question.id));
    },
    getRecentAnswers(streamId) {
      const used = usedByStream.get(streamId) || new Set();
      return [...used].map((id) => rows.get(id)?.answerKey).filter(Boolean);
    },
  };
}

const fallbackWords = [
  { clue: 'Цветок с желтыми лепестками', answers: ['одуванчик'] },
  { clue: 'Птица, которая не летает и живет в Антарктиде', answers: ['пингвин'] },
];

test('parses a JSON object or a fenced JSON object and normalizes aliases', () => {
  const content = '```json\n{"questions":[{"question":"Столица Франции?","answer":"Париж","aliases":["париж"]}]}\n```';
  assert.deepEqual(parseGeneratedQuestions(content), [
    { clue: 'Столица Франции?', answers: ['Париж'] },
  ]);
});

test('rejects malformed, oversized, answer-revealing, unsafe and duplicate questions', () => {
  assert.deepEqual(parseGeneratedQuestions('{not-json'), []);
  assert.deepEqual(parseGeneratedQuestions('x'.repeat(65 * 1024)), []);

  const parsed = parseGeneratedQuestions(JSON.stringify({ questions: [
    { question: 'Как называется Париж?', answer: 'Париж' },
    { question: 'Найди ответ: https://example.com', answer: 'ссылка' },
    { question: 'Команда !delete', answer: 'команда' },
    { question: 'Что находится во Франции?', answer: 'Париж' },
    { question: 'Город света?', answer: 'Париж' },
    { question: 'Крупнейшая планета Солнечной системы?', answer: 'Юпитер' },
  ] }));

  assert.deepEqual(parsed, [
    { clue: 'Что находится во Франции?', answers: ['Париж'] },
    { clue: 'Крупнейшая планета Солнечной системы?', answers: ['Юпитер'] },
  ]);
});

test('loads AI questions into a persistent pool, uses them first and does not repeat them in one stream', async () => {
  const repository = createRepository();
  let generationCount = 0;
  let prompt = '';
  let time = Date.now();
  const provider = createQuizQuestionProvider({
    repository,
    fallbackWords,
    batchSize: 20,
    now: () => time,
    cooldownMs: 60_000,
    generate: async (value) => {
      generationCount += 1;
      prompt = value;
      return JSON.stringify({ questions: Array.from({ length: 20 }, (_, index) => generatedQuestion(index)) });
    },
  });

  const firstGame = await provider.getQuestions({ streamId: 'stream-1', count: 10 });
  assert.equal(generationCount, 1);
  assert.equal(firstGame.length, 10);
  assert.ok(firstGame.every((question) => question.source === 'ai'));
  assert.match(prompt, /не используй эти уже заданные ответы/i);
  assert.ok(repository.rows.size >= 22, 'bundled questions remain as fallback');

  provider.markUsed('stream-1', firstGame);
  time += 60_000;
  const nextGame = await provider.getQuestions({ streamId: 'stream-1', count: 10 });
  assert.equal(nextGame.length, 10);
  assert.equal(new Set([...firstGame, ...nextGame].map((question) => question.id)).size, 20);
  assert.equal(generationCount, 2, 'a fresh batch is fetched once the current AI pool gets low');
});

test('falls back to bundled questions when AI generation is unavailable', async () => {
  const repository = createRepository();
  let generationCount = 0;
  const provider = createQuizQuestionProvider({
    repository,
    fallbackWords,
    generate: async () => {
      generationCount += 1;
      throw new Error('AI is unavailable');
    },
  });

  const questions = await provider.getQuestions({ streamId: 'stream-2', count: 10 });

  assert.equal(generationCount, 1);
  assert.equal(questions.length, fallbackWords.length);
  assert.ok(questions.every((question) => question.source === 'builtin'));
});

test('never reuses exhausted questions within a stream but the pool can be used on another stream', async () => {
  const repository = createRepository();
  const provider = createQuizQuestionProvider({
    repository,
    fallbackWords,
    generate: async () => '{broken json',
    cooldownMs: 60_000,
  });

  const first = await provider.getQuestions({ streamId: 'stream-3', count: 5 });
  assert.equal(first.length, fallbackWords.length);
  provider.markUsed('stream-3', first);
  assert.deepEqual(await provider.getQuestions({ streamId: 'stream-3', count: 5 }), []);

  const otherStream = await provider.getQuestions({ streamId: 'stream-4', count: 5 });
  assert.equal(otherStream.length, fallbackWords.length);
});

test('serializes concurrent reservations for the same stream and shares one generation request', async () => {
  const repository = createRepository();
  let generationCount = 0;
  let releaseGeneration;
  const generationGate = new Promise((resolve) => { releaseGeneration = resolve; });
  const provider = createQuizQuestionProvider({
    repository,
    fallbackWords,
    batchSize: 20,
    generate: async () => {
      generationCount += 1;
      await generationGate;
      return JSON.stringify({ questions: Array.from({ length: 20 }, (_, index) => generatedQuestion(index)) });
    },
  });

  const firstPending = provider.getQuestions({ streamId: 'stream-race', count: 10 });
  const secondPending = provider.getQuestions({ streamId: 'stream-race', count: 10 });
  releaseGeneration();
  const [first, second] = await Promise.all([firstPending, secondPending]);

  assert.equal(generationCount, 1);
  assert.equal(first.length, 10);
  assert.equal(second.length, 10);
  assert.equal(new Set([...first, ...second].map((question) => question.id)).size, 20);
});
