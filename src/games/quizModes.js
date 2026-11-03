'use strict';

const MODES = Object.freeze({
  quiz: {
    id: 'quiz',
    label: 'Викторина',
    instruction: 'Отвечайте одним словом.',
  },
  anagram: {
    id: 'anagram',
    label: 'Анаграммы',
    instruction: 'Соберите загаданное слово из перемешанных букв.',
  },
  game: {
    id: 'game',
    label: 'Угадай игру по эмодзи',
    instruction: 'Угадайте игру по эмодзи.',
  },
  movie: {
    id: 'movie',
    label: 'Угадай фильм по эмодзи',
    instruction: 'Угадайте фильм по эмодзи.',
  },
});

const MODE_ALIASES = Object.freeze({
  quiz: 'quiz',
  викторина: 'quiz',
  anagram: 'anagram',
  анаграмма: 'anagram',
  анаграммы: 'anagram',
  game: 'game',
  игры: 'game',
  игра: 'game',
  играэмодзи: 'game',
  movie: 'movie',
  фильм: 'movie',
  фильмы: 'movie',
  фильмэмодзи: 'movie',
});

function normalizeAnswer(value) {
  return String(value || '')
    .normalize('NFC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function resolveMode(value) {
  const normalized = String(value || '').normalize('NFC').trim().toLocaleLowerCase('ru-RU');
  return Object.prototype.hasOwnProperty.call(MODE_ALIASES, normalized) ? MODE_ALIASES[normalized] : null;
}

function getMode(mode) {
  const id = resolveMode(mode);
  if (!id) throw new RangeError(`Unknown quiz game mode: ${mode}`);
  return MODES[id];
}

function shuffleAnagram(answer, random = Math.random) {
  const letters = Array.from(String(answer || '').normalize('NFC').trim());
  if (letters.length < 2) return letters.join('');

  const original = letters.join('');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    for (let index = letters.length - 1; index > 0; index -= 1) {
      const sample = Number(random());
      const bounded = Number.isFinite(sample) ? Math.max(0, Math.min(sample, 0.999999999)) : 0;
      const swapIndex = Math.floor(bounded * (index + 1));
      [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
    }
    if (letters.join('') !== original) return letters.join('');
  }

  // A random generator can keep returning the original order. Rotate by one,
  // then swap distinct letters so repeated characters still form a new word.
  const originalLetters = Array.from(original);
  const rotated = originalLetters.slice(1).concat(originalLetters[0]);
  if (rotated.join('') !== original) return rotated.join('');
  const distinctIndex = originalLetters.findIndex((letter) => letter !== originalLetters[0]);
  if (distinctIndex !== -1) {
    [originalLetters[0], originalLetters[distinctIndex]] = [originalLetters[distinctIndex], originalLetters[0]];
  }
  return originalLetters.join('');
}

function buildRoundClue(mode, entry) {
  const { id } = getMode(mode);
  if (!entry || typeof entry !== 'object') return '';
  if (id === 'anagram') {
    const answer = Array.isArray(entry.answers) ? entry.answers[0] : entry.word;
    if (!answer) return '';
    const mixedLetters = Array.from(shuffleAnagram(answer)).join(' ').toLocaleUpperCase('ru-RU');
    return `Анаграмма: ${mixedLetters}`;
  }
  return String(entry.clue || 'Какое это название?');
}

function buildRoundHint(mode, answer) {
  const { id } = getMode(mode);
  const target = String(answer || '').normalize('NFC').trim();
  if (!target) return 'Подсказка: ответ состоит из одного слова.';

  const firstWord = target.split(/\s+/u)[0];
  const firstLetter = Array.from(firstWord)[0].toLocaleUpperCase('ru-RU');
  const wordCount = target.split(/\s+/u).length;
  if (id === 'game' || id === 'movie') {
    return `Подсказка: в названии ${wordCount} ${wordCount === 1 ? 'слово' : wordCount < 5 ? 'слова' : 'слов'}, начинается на «${firstLetter}».`;
  }

  const letterCount = Array.from(target).filter((letter) => /\p{L}/u.test(letter)).length;
  return `Подсказка: слово из ${letterCount} букв, начинается на «${firstLetter}».`;
}

module.exports = {
  getMode,
  resolveMode,
  normalizeAnswer,
  shuffleAnagram,
  buildRoundClue,
  buildRoundHint,
};
