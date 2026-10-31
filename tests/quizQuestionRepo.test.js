'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, beforeEach, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-quiz-question-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const quizQuestionRepo = require('../src/repositories/quizQuestion.repo');

beforeEach(() => {
  db.exec('DELETE FROM quiz_question_use; DELETE FROM quiz_question');
});

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('question seeds deduplicate normalized clues, canonical answers, and answer aliases', () => {
  assert.equal(quizQuestionRepo.saveQuestions([
    { clue: 'Кто зимой украшен игрушками?', answers: ['ЁЛКА', 'елка', 'Ёлка'] },
    { clue: '  кто зимой украшен игрушками? ', answers: ['сосна'] },
    { clue: 'Как называется столица Франции?', answers: ['париж'] },
    { clue: 'В каком городе находится Эйфелева башня?', answers: ['Париж'] },
    { clue: 'Другое описание летнего хвойного дерева.', answers: ['сосна', 'ёлка'] },
  ], 'builtin'), 2);

  const questions = quizQuestionRepo.findUnused('stream-a', 10);
  assert.equal(questions.length, 2);
  assert.deepEqual(questions.find((question) => question.clue.startsWith('Кто')).answers, ['ЁЛКА']);
});

test('AI questions are selected before built-in fallback questions', () => {
  quizQuestionRepo.saveQuestions([
    { clue: 'Встроенный вопрос о приборе.', answers: ['компас'] },
    { clue: 'Сгенерированный вопрос о предмете.', answers: ['телескоп'] },
  ], 'builtin');
  quizQuestionRepo.saveQuestions([
    { clue: 'Новый вопрос о животном.', answers: ['бобр'] },
  ]);

  const questions = quizQuestionRepo.findUnused('stream-a', 3);
  assert.equal(questions[0].source, 'ai');
  assert.equal(questions.filter((question) => question.source === 'builtin').length, 2);
  assert.deepEqual(questions[0].answers, ['бобр']);
});

test('used questions stay excluded for that stream, but are available on the next one', () => {
  quizQuestionRepo.saveQuestions([
    { clue: 'Вопрос о первом предмете.', answers: ['фонарик', 'фонарь'] },
    { clue: 'Вопрос о втором предмете.', answers: ['рюкзак'] },
  ], 'builtin');
  const initial = quizQuestionRepo.findUnused('stream-a', 10);

  assert.equal(quizQuestionRepo.markUsed('stream-a', [initial[0], initial[0]]), 1);
  assert.equal(quizQuestionRepo.markUsed('stream-a', [initial[0]]), 0);
  assert.equal(quizQuestionRepo.findUnused('stream-a', 10).length, 1);
  assert.equal(quizQuestionRepo.findUnused('stream-b', 10).length, 2);
  assert.deepEqual(quizQuestionRepo.getRecentAnswers('stream-a'), initial[0].answers);
});

test('marking an invalid question ID rolls back the entire usage batch', () => {
  quizQuestionRepo.saveQuestions([
    { clue: 'Вопрос о радуге.', answers: ['радуга'] },
  ], 'builtin');
  const question = quizQuestionRepo.findUnused('stream-a', 1)[0];

  assert.throws(() => quizQuestionRepo.markUsed('stream-a', [question, { id: 'missing-id' }]));
  assert.equal(quizQuestionRepo.findUnused('stream-a', 1).length, 1);
});

test('rejects unknown sources and caps untrusted question batches', () => {
  assert.throws(() => quizQuestionRepo.saveQuestions([], 'other'), /source/i);
  const questions = Array.from({ length: 101 }, (_, index) => ({
    clue: `Вопрос номер ${index}.`,
    answers: [`ответ-${index}`],
  }));

  assert.equal(quizQuestionRepo.saveQuestions(questions), 100);
});
