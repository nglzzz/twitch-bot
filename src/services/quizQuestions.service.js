'use strict';

const { normalizeAnswer, getMode } = require('../games/quizModes');
const DEFAULT_BATCH_SIZE = 20;
const GENERATION_COOLDOWN_MS = 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 50;

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function isWordAnswer(value, minimum = 1, maximum = 40) {
  return typeof value === 'string'
    && value.length <= maximum
    && new RegExp(`^\\p{Script=Cyrillic}{${minimum},${maximum}}$`, 'u').test(value);
}

function containsAnswer(clue, answers) {
  const normalizedClue = normalizeAnswer(clue);
  return answers.some((answer) => {
    const normalized = normalizeAnswer(answer);
    if (!normalized) return false;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(normalizedClue);
  });
}

function normalizeEmojiQuestion(value) {
  if (typeof value !== 'string') return null;
  const question = value.normalize('NFC').trim();
  if (!question || question.length > 220 || /https?:\/\/|www\.|!\S/u.test(question) || hasControlCharacters(question)) {
    return null;
  }

  const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
  const glyphs = [...segmenter.segment(question)].map((segment) => segment.segment)
    .filter((glyph) => !/^\s+$/u.test(glyph));
  if (glyphs.length < 2 || glyphs.length > 8) return null;

  const isAllowed = /^[\s\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0e\ufe0f\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]$/u;
  if (![...question].every((character) => isAllowed.test(character))) return null;

  const pictographs = [...question].filter((character) => /\p{Extended_Pictographic}/u.test(character)).length;
  const flags = [...question].filter((character) => /\p{Regional_Indicator}/u.test(character)).length;
  if (pictographs < 2 && flags < 4) return null;

  return question;
}

function normalizeTitleAnswer(value) {
  if (typeof value !== 'string') return null;
  const answer = value.normalize('NFC').trim();
  if (!answer || answer.length > 100 || hasControlCharacters(answer) || !/[\p{L}\p{N}]/u.test(answer)) return null;
  if (!/^[\p{Script=Cyrillic}\p{Script=Latin}\p{N}\s'’\-‐‑‒–—:,.&+!?()]+$/u.test(answer)) return null;
  if (/https?:\/\/|www\.|!\S/u.test(answer)) return null;
  return answer;
}

function parseEnvelope(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_RESPONSE_BYTES) return null;

  let source = content.trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced) source = fenced[1].trim();

  try {
    const decoded = JSON.parse(source);
    return decoded && typeof decoded === 'object' && Array.isArray(decoded.questions)
      ? decoded.questions.slice(0, MAX_BATCH_SIZE)
      : null;
  } catch (_) {
    return null;
  }
}

function parseGeneratedQuestions(content, mode = 'quiz') {
  const { id: modeId } = getMode(mode);
  const items = parseEnvelope(content);
  if (!items) return [];

  const seenClues = new Set();
  const seenAnswers = new Set();
  const questions = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    if (modeId === 'anagram') {
      const answer = typeof item.answer === 'string' ? item.answer.normalize('NFC').trim() : '';
      if (!isWordAnswer(answer, 4, 20)) continue;
      if (new Set([...answer.toLocaleLowerCase('ru-RU')]).size < 2) continue;

      const answerKey = normalizeAnswer(answer);
      if (seenAnswers.has(answerKey)) continue;
      seenAnswers.add(answerKey);
      questions.push({ clue: `anagram:${answerKey}`, answers: [answer] });
      continue;
    }

    const clue = modeId === 'quiz'
      ? (typeof item.question === 'string' ? item.question.normalize('NFC').trim() : '')
      : normalizeEmojiQuestion(item.question);
    if (!clue || clue.length > 220 || hasControlCharacters(clue)) continue;
    if (modeId === 'quiz' && (!/\p{Script=Cyrillic}/u.test(clue) || /[\r\n]/u.test(clue) || /https?:\/\/|www\.|!\S/u.test(clue))) continue;

    const normalizeAnswerValue = modeId === 'quiz' ? (answer) => {
      const result = typeof answer === 'string' ? answer.normalize('NFC').trim() : '';
      return isWordAnswer(result, 1, 40) ? result : null;
    } : normalizeTitleAnswer;

    const answer = normalizeAnswerValue(item.answer);
    if (!answer) continue;

    const rawAliases = item.aliases === undefined ? [] : item.aliases;
    const maxAliases = modeId === 'quiz' ? 5 : 8;
    if (!Array.isArray(rawAliases) || rawAliases.length > maxAliases) continue;

    const aliases = [answer];
    let invalidAlias = false;
    for (const rawAlias of rawAliases) {
      const alias = normalizeAnswerValue(rawAlias);
      if (!alias) {
        invalidAlias = true;
        break;
      }
      if (!aliases.some((existing) => normalizeAnswer(existing) === normalizeAnswer(alias))) aliases.push(alias);
    }
    if (invalidAlias) continue;

    const normalizedClue = modeId === 'quiz' ? normalizeAnswer(clue) : clue;
    if (seenClues.has(normalizedClue)) continue;
    if (modeId === 'quiz' && containsAnswer(clue, aliases)) continue;
    if (aliases.some((alias) => seenAnswers.has(normalizeAnswer(alias)))) continue;

    seenClues.add(normalizedClue);
    aliases.forEach((alias) => seenAnswers.add(normalizeAnswer(alias)));
    questions.push({ clue, answers: aliases });
  }

  return questions;
}

function getFallbackSets(options) {
  const fallbackSets = options.fallbackSets || require('../games/quizFallbacks');
  if (!options.fallbackWords) return fallbackSets;
  return { ...fallbackSets, quiz: options.fallbackWords };
}

function fallbackQuestion(question, modeId) {
  if (!question || typeof question !== 'object' || typeof question.clue !== 'string' || !question.clue.trim()) return null;
  const answers = Array.isArray(question.answers) ? question.answers : [];
  if (!answers.length) return null;

  if (modeId === 'anagram') {
    const answer = String(answers[0]).normalize('NFC').trim();
    if (!isWordAnswer(answer, 4, 20) || new Set([...answer.toLocaleLowerCase('ru-RU')]).size < 2) return null;
    return { clue: `anagram:${normalizeAnswer(answer)}`, answers: [answer] };
  }

  if (modeId === 'quiz') {
    const safeAnswers = answers.map((answer) => String(answer).normalize('NFC').trim())
      .filter((answer) => isWordAnswer(answer, 1, 40));
    return safeAnswers.length ? { clue: question.clue.normalize('NFC').trim(), answers: safeAnswers } : null;
  }

  const clue = normalizeEmojiQuestion(question.clue);
  const safeAnswers = answers.map(normalizeTitleAnswer).filter(Boolean);
  return clue && safeAnswers.length ? { clue, answers: safeAnswers } : null;
}

function collectKnownAnswers(modeId, recentAnswers, fallbackQuestions) {
  if (modeId === 'anagram') return [...recentAnswers, ...fallbackQuestions.flatMap((entry) => entry.answers || [])];
  return [...recentAnswers, ...fallbackQuestions.flatMap((entry) => entry.answers || [])];
}

function buildPrompt(mode, recentAnswers, fallbackQuestions) {
  const { id, label } = getMode(mode);
  const knownAnswers = [...new Set(collectKnownAnswers(id, recentAnswers, fallbackQuestions)
    .map(normalizeAnswer).filter(Boolean))].slice(0, 500);
  const exclusions = `Не используй эти уже показанные ответы и ответы из стартовой подборки: ${knownAnswers.join(', ') || '(пока нет)'}`;

  if (id === 'anagram') {
    return [
      'Составь пачку русских существительных для игры в анаграммы в Twitch-чате.',
      'Верни только JSON вида {"questions":[{"answer":"..."}]}, без question и aliases.',
      'Каждый ответ — общеупотребительное слово на кириллице длиной 4–20 букв. Не добавляй определения и пояснения.',
      'Создай до 20 разных слов.',
      exclusions,
    ].join('\n');
  }

  if (id === 'game' || id === 'movie') {
    const subject = id === 'game' ? 'известных видеоигр' : 'известных полнометражных фильмов';
    return [
      `Составь JSON-пачку заданий для русскоязычной игры в угадывание ${subject} по эмодзи.`,
      'Верни только JSON вида {"questions":[{"question":"🎮 🧱 ⛏️","answer":"Майнкрафт","aliases":["Minecraft"]}]}.',
      'question содержит только 2–8 эмодзи и пробелы, без букв, слов, цифр или ссылок.',
      'Используй реально существующие узнаваемые названия, без выдуманных синонимов. Добавь официальное русское название и английское оригинальное название в aliases, если оба известны.',
      'Не создавай неоднозначные загадки; эмодзи должны давать характерную ассоциацию.',
      'Создай до 20 разных заданий.',
      exclusions,
    ].join('\n');
  }

  return [
    `Составь пачку коротких русскоязычных вопросов для режима ${label} в Twitch-чате.`,
    'Каждый вопрос должен иметь один однозначный ответ из одного русского слова; допустимые синонимы перечисли в aliases.',
    'Используй проверяемые устойчивые факты о природе, географии, истории, науке, быте и культуре. Не используй спорные, недавние или зависящие от мнения факты.',
    'Не включай ответ или его формы в текст вопроса. Вопросы не должны быть загадками с разными разумными ответами.',
    'Верни только JSON вида {"questions":[{"question":"...","answer":"...","aliases":[]}]}. Создай до 20 вопросов.',
    'Не добавляй Markdown, пояснения, нумерацию, ссылки или команды для чата.',
    exclusions,
  ].join('\n');
}

async function defaultGenerate(prompt) {
  const config = require('../config');
  const ChatGPTClient = require('../utils/ChatGPT/AbstractChatGPT');
  const model = config.QUIZ_AI_MODEL || config.CHAT_GPT_MODEL;
  const client = new ChatGPTClient(model);
  return client.generateJson([
    {
      role: 'system',
      content: 'Ты составляешь только точные и безопасные вопросы для игры. Следуй JSON-схеме и ограничениям пользовательского сообщения.',
    },
    { role: 'user', content: prompt },
  ], { maxTokens: 4096, timeoutMs: 15_000 });
}

function createQuizQuestionProvider(options = {}) {
  const repository = options.repository || require('../repositories/quizQuestion.repo');
  const generate = options.generate || defaultGenerate;
  const now = options.now || Date.now;
  const fallbackSets = getFallbackSets(options);
  const cooldownMs = options.cooldownMs === undefined ? GENERATION_COOLDOWN_MS : options.cooldownMs;
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, options.batchSize || DEFAULT_BATCH_SIZE));

  const fallbackSeeded = new Set();
  const lastGenerationAttemptAt = new Map();
  const generationRequests = new Map();
  const streamQueues = new Map();

  function getStreamKey(streamId) {
    const key = String(streamId || '').trim();
    if (key) return key;
    return `offline:${new Date(now()).toISOString().slice(0, 10)}`;
  }

  function ensureFallbackSeeded(modeId) {
    if (fallbackSeeded.has(modeId)) return;
    const fallback = (fallbackSets[modeId] || []).map((entry) => fallbackQuestion(entry, modeId)).filter(Boolean);
    if (fallback.length) repository.saveQuestions(fallback, 'builtin', modeId);
    fallbackSeeded.add(modeId);
  }

  async function generateBatch(streamKey, modeId, fallbackQuestions) {
    const lastAttempt = lastGenerationAttemptAt.get(modeId);
    if (generationRequests.has(modeId)) return generationRequests.get(modeId);
    if (lastAttempt !== undefined && now() - lastAttempt < cooldownMs) return;

    lastGenerationAttemptAt.set(modeId, now());
    const request = (async () => {
      const recentAnswers = repository.getRecentAnswers(streamKey, 500, modeId);
      const content = await generate(buildPrompt(modeId, recentAnswers, fallbackQuestions));
      const questions = parseGeneratedQuestions(content, modeId);
      if (!questions.length) {
        console.warn(`[QuizQuestions] Model returned no valid ${modeId} questions.`);
        return;
      }
      repository.saveQuestions(questions, 'ai', modeId);
    })();

    generationRequests.set(modeId, request);
    try {
      await request;
    } catch (error) {
      console.warn(`[QuizQuestions] Could not generate ${modeId} questions:`, error && error.code || 'request_failed');
    } finally {
      if (generationRequests.get(modeId) === request) generationRequests.delete(modeId);
    }
  }

  async function getQuestionsForStream(streamKey, count, modeId) {
    ensureFallbackSeeded(modeId);
    const fallbackQuestions = fallbackSets[modeId] || [];
    const targetCount = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(Number(count) || 10)));
    const limit = Math.max(batchSize, targetCount * 2);

    let available = repository.findUnused(streamKey, limit, modeId);
    const availableAiQuestions = available.filter((question) => question.source === 'ai').length;
    if (availableAiQuestions < targetCount * 2) {
      await generateBatch(streamKey, modeId, fallbackQuestions);
      available = repository.findUnused(streamKey, limit, modeId);
    }

    const selected = available.slice(0, targetCount);
    repository.markUsed(streamKey, selected, modeId);
    return selected.map(({ clue, answers, id, source }) => ({ clue, answers, id, source }));
  }

  async function getQuestions({ streamId, count = 10, mode = 'quiz' } = {}) {
    const modeId = getMode(mode).id;
    const streamKey = getStreamKey(streamId);
    const queueKey = `${streamKey}\u0000${modeId}`;
    const previous = streamQueues.get(queueKey) || Promise.resolve();
    const result = previous.catch(() => {}).then(() => getQuestionsForStream(streamKey, count, modeId));
    streamQueues.set(queueKey, result);
    try {
      return await result;
    } finally {
      if (streamQueues.get(queueKey) === result) streamQueues.delete(queueKey);
    }
  }

  function markUsed(streamId, questions, mode = 'quiz') {
    return repository.markUsed(getStreamKey(streamId), questions || [], getMode(mode).id);
  }

  return { getQuestions, markUsed };
}

module.exports = {
  createQuizQuestionProvider,
  parseGeneratedQuestions,
  buildPrompt,
  normalizeEmojiQuestion,
};
