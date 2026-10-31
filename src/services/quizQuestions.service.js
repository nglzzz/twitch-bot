'use strict';

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 50;
const MAX_QUESTION_LENGTH = 220;
const MAX_ALIAS_COUNT = 5;
const DEFAULT_BATCH_SIZE = 20;
const GENERATION_COOLDOWN_MS = 60 * 1000;

function normalize(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е');
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function isValidAnswer(value) {
  return typeof value === 'string'
    && value.length <= 40
    && /^\p{Script=Cyrillic}+(?:-\p{Script=Cyrillic}+)*$/u.test(value);
}

function containsAnswer(clue, answers) {
  const normalizedClue = normalize(clue);
  return answers.some((answer) => {
    const normalizedAnswer = normalize(answer);
    const escaped = normalizedAnswer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'u').test(normalizedClue);
  });
}

function normalizeQuestion(item, seenClues, seenAnswers) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const clue = typeof item.question === 'string' ? item.question.normalize('NFC').trim() : '';
  if (!clue || clue.length > MAX_QUESTION_LENGTH || !/\p{Script=Cyrillic}/u.test(clue) || hasControlCharacters(clue)) return null;
  if (/[\r\n]/u.test(clue) || /https?:\/\/|www\.|!\S/u.test(clue)) return null;

  const answer = typeof item.answer === 'string' ? item.answer.normalize('NFC').trim() : '';
  if (!isValidAnswer(answer)) return null;

  const rawAliases = item.aliases === undefined ? [] : item.aliases;
  if (!Array.isArray(rawAliases) || rawAliases.length > MAX_ALIAS_COUNT) return null;
  const aliases = [answer];
  for (const rawAlias of rawAliases) {
    if (typeof rawAlias !== 'string') return null;
    const alias = rawAlias.normalize('NFC').trim();
    if (!isValidAnswer(alias)) return null;
    if (!aliases.some((existing) => normalize(existing) === normalize(alias))) aliases.push(alias);
  }

  const clueKey = normalize(clue);
  if (seenClues.has(clueKey)) return null;
  if (containsAnswer(clue, aliases)) return null;
  if (aliases.some((itemAlias) => seenAnswers.has(normalize(itemAlias)))) return null;

  seenClues.add(clueKey);
  aliases.forEach((itemAlias) => seenAnswers.add(normalize(itemAlias)));
  return { clue, answers: aliases };
}

function parseGeneratedQuestions(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_RESPONSE_BYTES) {
    return [];
  }

  let source = content.trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced) source = fenced[1].trim();

  let decoded;
  try {
    decoded = JSON.parse(source);
  } catch (_) {
    return [];
  }

  if (!decoded || typeof decoded !== 'object' || !Array.isArray(decoded.questions)) return [];

  const seenClues = new Set();
  const seenAnswers = new Set();
  return decoded.questions
    .slice(0, MAX_BATCH_SIZE)
    .map((item) => normalizeQuestion(item, seenClues, seenAnswers))
    .filter(Boolean);
}

function buildPrompt(recentAnswers, fallbackWords) {
  const knownAnswers = [...new Set([
    ...recentAnswers,
    ...fallbackWords.flatMap((word) => word.answers || [word.word]),
  ].map(normalize).filter(Boolean))].slice(0, 500);

  return [
    'Составь пачку коротких русскоязычных вопросов для викторины в Twitch-чате.',
    'Каждый вопрос должен иметь один однозначный ответ из одного русского слова; допустимые синонимы перечисли в aliases.',
    'Используй проверяемые устойчивые факты о природе, географии, истории, науке, быте и культуре. Не используй спорные, недавние или зависящие от мнения факты.',
    'Не включай ответ или его формы в текст вопроса. Вопросы не должны быть загадками с разными разумными ответами.',
    'Верни только JSON вида {"questions":[{"question":"...","answer":"...","aliases":[]}]}. Создай до 20 вопросов.',
    'Не добавляй Markdown, пояснения, нумерацию, ссылки или команды для чата.',
    `Не используй эти уже заданные ответы и ответы из стартовой подборки: ${knownAnswers.join(', ') || '(пока нет)'}`,
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
      content: 'Ты составляешь только точные вопросы для викторины. Следуй JSON-схеме и ограничениям пользовательского сообщения.',
    },
    { role: 'user', content: prompt },
  ], { maxTokens: 4096, timeoutMs: 15_000 });
}

function fallbackQuestion(word) {
  if (!word || typeof word !== 'object') return null;
  const answers = Array.isArray(word.answers) ? word.answers : [word.word];
  if (typeof word.clue !== 'string' || !word.clue.trim()) return null;
  const filteredAnswers = [...new Set(answers
    .filter((answer) => typeof answer === 'string' && answer.trim())
    .map((answer) => answer.normalize('NFC').trim()))];
  if (!filteredAnswers.length) return null;
  return { clue: word.clue.normalize('NFC').trim(), answers: filteredAnswers };
}

function createQuizQuestionProvider(options = {}) {
  const repository = options.repository || require('../repositories/quizQuestion.repo');
  const generate = options.generate || defaultGenerate;
  const now = options.now || Date.now;
  const fallbackWords = options.fallbackWords || require('../data/quizWords');
  const cooldownMs = options.cooldownMs === undefined ? GENERATION_COOLDOWN_MS : options.cooldownMs;
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, options.batchSize || DEFAULT_BATCH_SIZE));

  let fallbackSeeded = false;
  let lastGenerationAttemptAt = null;
  let generationRequest = null;
  const streamQueues = new Map();

  function getStreamKey(streamId) {
    const key = String(streamId || '').trim();
    if (key) return key;
    return `offline:${new Date(now()).toISOString().slice(0, 10)}`;
  }

  function ensureFallbackSeeded() {
    if (fallbackSeeded) return;
    const fallback = fallbackWords.map(fallbackQuestion).filter(Boolean);
    if (fallback.length) repository.saveQuestions(fallback, 'builtin');
    fallbackSeeded = true;
  }

  async function generateBatch(streamKey) {
    if (generationRequest) return generationRequest;
    if (lastGenerationAttemptAt !== null && now() - lastGenerationAttemptAt < cooldownMs) return;

    lastGenerationAttemptAt = now();
    generationRequest = (async () => {
      const recentAnswers = repository.getRecentAnswers(streamKey, 500);
      const content = await generate(buildPrompt(recentAnswers, fallbackWords));
      const questions = parseGeneratedQuestions(content);
      if (!questions.length) {
        console.warn('[QuizQuestions] Model returned no valid questions.');
        return;
      }
      repository.saveQuestions(questions, 'ai');
    })();

    try {
      await generationRequest;
    } catch (error) {
      console.warn('[QuizQuestions] Could not generate a question batch:', error && error.code || 'request_failed');
    } finally {
      generationRequest = null;
    }
  }

  async function getQuestionsForStream(streamKey, count) {
    ensureFallbackSeeded();

    const targetCount = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(Number(count) || 10)));
    let available = repository.findUnused(streamKey, Math.max(batchSize, targetCount * 2));
    const availableAiQuestions = available.filter((question) => question.source === 'ai').length;

    if (availableAiQuestions < targetCount * 2) {
      await generateBatch(streamKey);
      available = repository.findUnused(streamKey, Math.max(batchSize, targetCount * 2));
    }

    const selected = available.slice(0, targetCount);
    repository.markUsed(streamKey, selected);
    return selected.map(({ clue, answers, id, source }) => ({ clue, answers, id, source }));
  }

  async function getQuestions({ streamId, count = 10 } = {}) {
    const streamKey = getStreamKey(streamId);
    const previous = streamQueues.get(streamKey) || Promise.resolve();
    const result = previous.catch(() => {}).then(() => getQuestionsForStream(streamKey, count));
    streamQueues.set(streamKey, result);
    try {
      return await result;
    } finally {
      if (streamQueues.get(streamKey) === result) streamQueues.delete(streamKey);
    }
  }

  function markUsed(streamId, questions) {
    return repository.markUsed(getStreamKey(streamId), questions || []);
  }

  return { getQuestions, markUsed };
}

module.exports = {
  createQuizQuestionProvider,
  parseGeneratedQuestions,
};
