'use strict';

const crypto = require('crypto');
const { db, stmt } = require('./base');
const { normalizeAnswer } = require('../games/quizModes');

const MAX_BATCH_SIZE = 100;
const MAX_ANSWERS_PER_QUESTION = 8;
const MAX_STREAM_ID_LENGTH = 200;

const QUESTION_MODES = new Set(['quiz', 'anagram', 'game', 'movie']);

function normalizeMode(mode = 'quiz') {
  if (!QUESTION_MODES.has(mode)) {
    throw new TypeError('Question mode must be quiz, anagram, game, or movie');
  }
  return mode;
}

function normalizeClue(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е');
}

function normalizeQuestions(questions, source, mode) {
  if (!Array.isArray(questions)) {
    throw new TypeError('Questions must be an array');
  }
  if (source !== 'ai' && source !== 'builtin') {
    throw new TypeError('Question source must be ai or builtin');
  }
  mode = normalizeMode(mode);

  return questions.slice(0, MAX_BATCH_SIZE).flatMap((question) => {
    if (!question || typeof question !== 'object') return [];

    const clue = String(question.clue || '').normalize('NFC').trim().slice(0, 500);
    const rawAnswers = Array.isArray(question.answers) ? question.answers : [];
    const seenAnswers = new Set();
    const answers = rawAnswers
      .filter((answer) => typeof answer === 'string')
      .map((answer) => answer.normalize('NFC').trim().slice(0, 150))
      .filter((answer) => {
        const normalized = normalizeAnswer(answer);
        if (!normalized || seenAnswers.has(normalized)) return false;
        seenAnswers.add(normalized);
        return true;
      })
      .slice(0, MAX_ANSWERS_PER_QUESTION);

    if (!clue || answers.length === 0) return [];

    // Keep punctuation and emoji in clue identities. Title/word answer matching
    // intentionally normalizes punctuation, but emoji prompts often contain no
    // letters at all and would otherwise collapse to the same database key.
    const normalizedClue = normalizeClue(clue);
    const answerKeys = answers.map(normalizeAnswer);
    const answerKey = answerKeys[0];
    const id = crypto.createHash('sha256')
      .update(mode === 'quiz' ? normalizedClue : `${mode}:${normalizedClue}`)
      .digest('hex');
    return [{ id, clue, answers, answerKeys, answerKey: mode === 'quiz' ? answerKey : `${mode}:${answerKey}`, source, mode }];
  });
}

function saveQuestions(questions, source = 'ai', mode = 'quiz') {
  const normalizedQuestions = normalizeQuestions(questions, source, mode);
  if (normalizedQuestions.length === 0) return 0;

  const readExistingAnswers = stmt('SELECT answers FROM quiz_question WHERE mode = ?');
  const insert = stmt(`INSERT OR IGNORE INTO quiz_question
    (id, clue, answers, answer_key, source, mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const saveTransaction = db.transaction((items) => {
    let saved = 0;
    const now = Date.now();
    const existingAnswers = new Set(readExistingAnswers.all(items[0].mode)
      .flatMap((row) => parseAnswers(row.answers))
      .map(normalizeAnswer));
    for (const question of items) {
      if (question.answerKeys.some((answer) => existingAnswers.has(answer))) continue;

      const result = insert.run(
        question.id,
        question.clue,
        JSON.stringify(question.answers),
        question.answerKey,
        question.source,
        question.mode,
        now
      );
      saved += result.changes;
      if (result.changes) {
        question.answerKeys.forEach((answer) => existingAnswers.add(answer));
      }
    }
    return saved;
  });

  return saveTransaction(normalizedQuestions);
}

function findUnused(streamId, limit = 20, mode = 'quiz') {
  const normalizedStreamId = normalizeStreamId(streamId);
  mode = normalizeMode(mode);
  const safeLimit = normalizeLimit(limit, 100);
  const rows = stmt(`SELECT question.id, question.clue, question.answers, question.source
    FROM quiz_question AS question
    WHERE question.mode = ? AND NOT EXISTS (
      SELECT 1 FROM quiz_question_use AS used
      WHERE used.stream_id = ? AND used.question_id = question.id
    )
    ORDER BY CASE question.source WHEN 'ai' THEN 0 ELSE 1 END, RANDOM()
    LIMIT ?`).all(mode, normalizedStreamId, safeLimit);

  return rows.map((row) => ({
    id: row.id,
    clue: row.clue,
    answers: parseAnswers(row.answers),
    source: row.source,
  }));
}

function markUsed(streamId, questions) {
  const normalizedStreamId = normalizeStreamId(streamId);
  if (!Array.isArray(questions)) {
    throw new TypeError('Questions must be an array');
  }

  const ids = [...new Set(questions.map((question) => String(question && question.id || '').trim()).filter(Boolean))];
  if (!ids.length) return 0;

  const insert = stmt(`INSERT OR IGNORE INTO quiz_question_use (stream_id, question_id, used_at)
    VALUES (?, ?, ?)`);
  const markTransaction = db.transaction((questionIds) => {
    let marked = 0;
    const now = Date.now();
    for (const questionId of questionIds) {
      marked += insert.run(normalizedStreamId, questionId, now).changes;
    }
    return marked;
  });

  return markTransaction(ids);
}

function getRecentAnswers(streamId, limit = 100, mode = 'quiz') {
  const normalizedStreamId = normalizeStreamId(streamId);
  mode = normalizeMode(mode);
  const safeLimit = normalizeLimit(limit, 1000);
  const rows = stmt(`SELECT question.answers
    FROM quiz_question_use AS used
    JOIN quiz_question AS question ON question.id = used.question_id
    WHERE used.stream_id = ? AND question.mode = ?
    ORDER BY used.used_at DESC
    LIMIT ?`).all(normalizedStreamId, mode, safeLimit);

  return [...new Set(rows.flatMap((row) => parseAnswers(row.answers).map(normalizeAnswer).filter(Boolean)))];
}

function normalizeStreamId(streamId) {
  const value = String(streamId || '').trim();
  if (!value || value.length > MAX_STREAM_ID_LENGTH) {
    throw new TypeError('A valid stream ID is required');
  }
  return value;
}

function normalizeLimit(value, maximum) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, maximum);
}

function parseAnswers(value) {
  try {
    const answers = JSON.parse(value);
    return Array.isArray(answers) ? answers : [];
  } catch (_) {
    return [];
  }
}

module.exports = {
  normalizeAnswer,
  saveQuestions,
  findUnused,
  markUsed,
  getRecentAnswers,
  normalizeMode,
};
