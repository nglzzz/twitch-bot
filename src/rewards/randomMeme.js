const axios = require('axios');
const config = require('../config');

const MEMEALERTS_HOST = config.MEMEALERTS_HOST || 'memealerts.com';
const STREAMER_ID = '64483d657cd2a3c9dab584bb';

function getHeaders(referer) {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9,ru;q=0.8,und;q=0.7,pl;q=0.6',
    authorization: 'Bearer ' + config.MEMEALERTS_JWT,
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    dnt: '1',
    origin: 'https://memealerts.com',
    pragma: 'no-cache',
    priority: 'u=1, i',
    referer: referer || 'https://memealerts.com/stickers',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Linux"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
  };
}

/**
 * Fetch memes from a catalogue endpoint with pagination
 */
async function fetchCatalogue(url, body, referer) {
  const memes = [];
  const limit = 100;
  let skip = 0;

  try {
    while (true) {
      const response = await axios.post(url, { ...body, limit, skip }, {
        headers: getHeaders(referer)
      });

      const items = Array.isArray(response.data) ? response.data : (response.data.data || []);

      if (items.length === 0) break;

      memes.push(...items);

      if (items.length < limit) break;

      skip += limit;
    }
  } catch (error) {
    console.error('Error fetching catalogue from ' + url + ':', error.message);
    throw error;
  }

  return memes;
}

/**
 * Send a meme sticker via MemeAlerts API
 */
async function sendMeme(stickerId, isSoundOnly) {
  const response = await axios.post(
    'https://' + MEMEALERTS_HOST + '/api/sticker/send',
    {
      toChannel: STREAMER_ID,
      stickerId: stickerId,
      isSoundOnly: isSoundOnly,
      topic: 'Top',
      name: config.CHANNEL || 'nglzzz',
      isMemePartyActive: false,
      message: '',
      deviceType: 'desktop'
    },
    {
      headers: getHeaders('https://memealerts.com/' + (config.CHANNEL || 'nglzzz'))
    }
  );

  return response.data;
}

/**
 * Create a random meme reward handler
 * @param {boolean} isSoundOnly - if true, send as audio-only meme
 */
function createHandler(isSoundOnly) {
  const logPrefix = isSoundOnly ? '[RandomAudioMeme]' : '[RandomMeme]';
  const successPrefix = isSoundOnly ? '🔊 Случайный аудио-мем' : '🎲 Случайный мем';
  const errorMsg = isSoundOnly
    ? 'Ошибка при отправке случайного аудио-мема 😔'
    : 'Ошибка при отправке случайного мема 😔';

  return async function onRandomMemeReward() {
    try {
      // Fetch memes from both catalogues in parallel
      const [personalMemes, streamerMemes] = await Promise.all([
        fetchCatalogue(
          'https://' + MEMEALERTS_HOST + '/api/sticker/personal-area/catalogue',
          { limit: 100, skip: 0 },
          'https://memealerts.com/stickers'
        ),
        fetchCatalogue(
          'https://' + MEMEALERTS_HOST + '/api/sticker/streamer-area/catalogue',
          { limit: 100, skip: 0, categories: [], streamerId: STREAMER_ID, pageSize: 100 },
          'https://memealerts.com/' + (config.CHANNEL || 'nglzzz')
        )
      ]);

      console.log(`${logPrefix} Fetched ${personalMemes.length} personal memes, ${streamerMemes.length} streamer memes`);

      // Combine and deduplicate by id
      const seen = new Set();
      const allMemes = [];

      for (const meme of [...personalMemes, ...streamerMemes]) {
        if (!seen.has(meme.id)) {
          seen.add(meme.id);
          allMemes.push(meme);
        }
      }

      if (allMemes.length === 0) {
        throw new Error('Meme catalogue is empty');
      }

      // Pick a random meme
      const randomIndex = Math.floor(Math.random() * allMemes.length);
      const chosenMeme = allMemes[randomIndex];

      console.log(`${logPrefix} Selected meme: "${chosenMeme.name}" (${chosenMeme.id})`);

      // Send the meme
      const result = await sendMeme(chosenMeme.id, isSoundOnly);

      if (result && result.result === 0) {
        if (isSoundOnly) {
          return '';
        }
        return `${successPrefix}: ${chosenMeme.name}`;
      } else {
        throw new Error(`Unexpected MemeAlerts send result: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      console.error(`${logPrefix} Error:`, error.message);
      throw error;
    }
  };
}

module.exports = createHandler(false);
module.exports.createHandler = createHandler;
