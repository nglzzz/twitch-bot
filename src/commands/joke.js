const axios = require('axios');
const arrayHelper = require('../helpers/arrayHelper');
const ChatGPT = require('../utils/chatGPT');

// Цепочка источников: anekdot.ru -> baneks.ru -> LLM -> локальные.
// Старый castlots.org больше не работает (301 на https -> 404).
const ANEKDOT_RU_URL = 'https://www.anekdot.ru/random/anekdot/';
const BANEKS_URL = 'https://baneks.ru/random';
const MAX_JOKE_LENGTH = 470; // лимит Twitch — 500 символов

const FALLBACK_JOKES = [
  'Лупа и Пупа устроились на работу. Проработали целый месяц, трудились не покладая рук и не жалея живота своего. В конце месяца Лупа и Пупа пошли получать зарплату. В бухгалтерии все как обычно перепутали. И, в итоге, Лупа получил за Пупу, а Пупа за ЛУПУ!',
  '— Доктор, я буду жить? — А смысл?',
  'Штирлиц долго смотрел в одну точку. Потом в другую. «Двоеточие», — догадался Штирлиц.',
  'Идёт медведь по лесу, видит — машина горит. Сел в неё и сгорел.',
];

async function onJokeCommand(channel, tags) {
  return await getJoke();
}

async function getJoke() {
  try {
    return await getJokeFromAnekdotRu();
  } catch (error) {
    console.error('[Joke] anekdot.ru failed:', error.message);
  }

  try {
    return await getJokeFromBaneks();
  } catch (error) {
    console.error('[Joke] baneks.ru failed:', error.message);
  }

  try {
    const llmJoke = await getJokeFromChatGPT();
    if (llmJoke) {
      return llmJoke;
    }
  } catch (error) {
    console.error('[Joke] ChatGPT failed:', error.message);
  }

  return getRandomFallbackJoke();
}

async function getJokeFromAnekdotRu() {
  let lastError;

  // сайт иногда рвёт TLS-соединение, одного повтора обычно хватает
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await axios({
        method: 'GET',
        url: ANEKDOT_RU_URL,
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const jokes = extractJokesFromAnekdotRuHtml(response.data);

      if (jokes.length === 0) {
        throw new Error('no usable jokes on page');
      }

      return arrayHelper.getRandomArrayElement(jokes);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

// На странице random/anekdot лежит ~15 анекдотов в блоках
// <div class="topicbox"><div class="text">текст</div></div>
function extractJokesFromAnekdotRuHtml(html) {
  return String(html)
    .split('class="topicbox')
    .slice(1) // до первого topicbox — шапка страницы
    .map((block) => {
      const textMatch = block.match(/<div class="text">([\s\S]*?)<\/div>/);

      if (!textMatch) {
        return undefined;
      }

      return decodeHtmlEntities(
        textMatch[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim()
      );
    })
    .filter(isValidJoke);
}

async function getJokeFromBaneks() {
  const response = await axios({
    method: 'GET',
    url: BANEKS_URL,
    timeout: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const joke = extractJokeFromBaneksHtml(response.data);

  if (!isValidJoke(joke)) {
    throw new Error(`no usable joke (${typeof joke === 'string' ? `length ${joke.length}` : 'not found'})`);
  }

  return joke;
}

function extractJokeFromBaneksHtml(html) {
  const articleMatch = String(html).match(/<article>([\s\S]*?)<\/article>/i);

  if (!articleMatch) {
    return undefined;
  }

  return decodeHtmlEntities(
    articleMatch[1]
      .replace(/<h2>[\s\S]*?<\/h2>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim()
  );
}

function isValidJoke(joke) {
  return typeof joke === 'string'
    && joke.length >= 10
    && joke.length <= MAX_JOKE_LENGTH
    // на сайтах иногда вставляют рекламу в начало текста
    && !/спонсор|реклам/i.test(joke.slice(0, 80));
}

const HTML_ENTITIES = {
  '&mdash;': '—',
  '&laquo;': '«',
  '&raquo;': '»',
  '&hellip;': '…',
  '&nbsp;': ' ',
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
  '&#39;': "'",
  '&amp;': '&',
};

function decodeHtmlEntities(text) {
  let result = text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.split(entity).join(char);
  }

  return result;
}

async function getJokeFromChatGPT() {
  const answer = await ChatGPT.addMessage(
    'anekdot-command',
    'Расскажи смешной короткий анекдот на русском языке, до 300 символов. Ответь только текстом анекдота, без вступлений и пояснений.'
  );

  if (typeof answer !== 'string' || answer.trim().length === 0) {
    return undefined;
  }

  const joke = answer.trim();

  // модели иногда отвечают не на том языке
  if (!/[а-яё]/i.test(joke)) {
    return undefined;
  }

  return joke.slice(0, MAX_JOKE_LENGTH);
}

function getRandomFallbackJoke() {
  return FALLBACK_JOKES[Math.floor(Math.random() * FALLBACK_JOKES.length)];
}

module.exports = onJokeCommand;
