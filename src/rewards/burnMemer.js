const axios = require('axios');
const config = require('../config');

const MEMEALERTS_HOST = config.MEMEALERTS_HOST || 'memealerts.com';

async function onBurnMemerReward() {
  console.log('Fetching last meme');
  try {
    const response = await axios.post(
      'https://' + MEMEALERTS_HOST + '/api/event',
      {
        limit: 100,
        filters: [0, 1, 2, 3, 4, 5, 6, 7, 9]
      },
      {
        headers: {
          accept: '*/*',
          authorization: 'Bearer ' + config.MEMEALERTS_JWT,
          'content-type': 'application/json',
          origin: 'https://memealerts.com',
          referer: 'https://memealerts.com/dashboard'
        }
      }
    );

    const events = Array.isArray(response.data)
      ? response.data
      : (response.data.data || []);

    const lastMeme = events.find(
      e => e.kind === 'sticker-sent' && !e.isHidden
    );

    if (!lastMeme) {
      return 'Не нашёл последнего мемера 😔';
    }

    return `🔥🔥🔥 Последний мем прислал: ${lastMeme.userAlias}. Мем: ${lastMeme.stickerName}`;
  } catch (error) {
    console.error('Ошибка при получении последнего мемера:', error.message);
    return 'Ошибка при поиске мемера 😔';
  }
}

module.exports = onBurnMemerReward;
