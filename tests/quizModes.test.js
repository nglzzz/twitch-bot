'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  buildRoundClue,
  buildRoundHint,
  getMode,
  normalizeAnswer,
  resolveMode,
  shuffleAnagram,
} = require('../src/games/quizModes');
const fallbacks = require('../src/games/quizFallbacks');

test('resolves the supported mode names and Russian command aliases', () => {
  assert.equal(resolveMode('quiz'), 'quiz');
  assert.equal(resolveMode('анаграмма'), 'anagram');
  assert.equal(resolveMode('АНАГРАММЫ'), 'anagram');
  assert.equal(resolveMode('играэмодзи'), 'game');
  assert.equal(resolveMode('фильм'), 'movie');
  assert.equal(resolveMode('unknown'), null);
  assert.equal(resolveMode('constructor'), null);
  assert.equal(resolveMode('__proto__'), null);
  assert.throws(() => getMode('unknown'), RangeError);
  assert.equal(getMode('movie').label, 'Угадай фильм по эмодзи');
});

test('normalizes case, ё, punctuation, hyphens, and repeated spaces while preserving digits', () => {
  assert.equal(normalizeAnswer('  ЗВЁЗДНЫЕ—   ВОЙНЫ! '), 'звездные войны');
  assert.equal(normalizeAnswer(" Spider-Man 2 "), 'spider man 2');
});

test('anagram shuffle always changes the original order and preserves letters', () => {
  for (const word of ['микроскоп', 'радуга', 'ананас', 'пингвин']) {
    const mixed = shuffleAnagram(word, () => 0);
    assert.notEqual(mixed, word);
    assert.deepEqual(Array.from(mixed).sort(), Array.from(word).sort());
  }

  assert.match(buildRoundClue('anagram', { answers: ['слово'] }), /^Анаграмма: /);
  assert.doesNotMatch(buildRoundClue('anagram', { answers: ['слово'] }), /слово/i);
});

test('round hints reveal an initial and length or word count without revealing title', () => {
  assert.match(buildRoundHint('quiz', 'Юпитер'), /6 букв.*«Ю»/);
  assert.match(buildRoundHint('anagram', 'ананас'), /6 букв.*«А»/);
  const movieHint = buildRoundHint('movie', 'Король лев');
  assert.match(movieHint, /2 слова.*«К»/);
  assert.doesNotMatch(movieHint, /король лев/i);
  assert.match(buildRoundHint('game', 'Minecraft'), /1 слово.*«M»/);
});

test('fallback pools have enough distinct anagrams and emoji rounds for both themes', () => {
  assert.ok(fallbacks.anagram.length >= 20);
  assert.ok(fallbacks.game.length >= 20);
  assert.ok(fallbacks.movie.length >= 20);

  for (const mode of ['game', 'movie']) {
    const clues = new Set();
    const answers = new Set();
    for (const entry of fallbacks[mode]) {
      assert.match(entry.clue, /\p{Extended_Pictographic}/u);
      assert.ok(Array.from(entry.clue).filter((char) => /\p{Extended_Pictographic}/u.test(char)).length >= 2);
      assert.ok(Array.isArray(entry.answers) && entry.answers.length >= 2);
      assert.ok(!clues.has(entry.clue), `duplicate ${mode} clue: ${entry.clue}`);
      clues.add(entry.clue);
      const answerKey = normalizeAnswer(entry.answers[0]);
      assert.ok(!answers.has(answerKey), `duplicate ${mode} answer: ${answerKey}`);
      answers.add(answerKey);
      assert.ok(!entry.clue.toLocaleLowerCase('ru-RU').includes(answerKey));
    }
  }
});

