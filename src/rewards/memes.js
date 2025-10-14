const axios = require('axios');
const config = require('../config');
const MEMEALERTS_HOST = config.MEMEALERTS_HOST ? config.MEMEALERTS_HOST : 'memealerts.com';

async function onMemesReward(channel, tags, message) {
  const streamerId = '64483d657cd2a3c9dab584bb';
  let userName = tags['display-name'] ?? tags.username;

  message = message.trim();
  if (message.length > 2) {
    userName = message; // никнейм в сообщении
  }

  let supporter = await getSupporter(userName);
  if (!supporter) {
    supporter = await getSupporter(tags.username);
  }

  if (!supporter) {
    return 'По такому никнейму не найден пользователь в memealerts.';
  }

  try {
    const result = await axios.post(
      'https://'+ MEMEALERTS_HOST +'/api/user/give-bonus',
      {
        userId: supporter.supporterId,
        streamerId: streamerId,
        value: 50
      },
      {
        headers: {
          'sec-ch-ua-platform': 'Linux',
          'authorization': 'Bearer ' + config.MEMEALERTS_JWT,
          'Referer': 'https://memealerts.com/supporters/64483d657cd2a3c9dab584bb',
          'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
          'sec-ch-ua-mobile': '?0',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'DNT': '1',
          'content-type': 'application/json'
        }
      }
    );

    return 'Мемы начислены для ' + userName;
  } catch (error) {
    console.error('Ошибка при выполнении запроса начисления мемов:', error);
    return 'Ошибка начисления мемов';
  }
}

async function getSupporter(nickname) {
  try {
    console.log('Fetch supporters by nickname: ' + nickname)
    const response = await axios.post(
      'https://'+ MEMEALERTS_HOST +'/api/supporters',
      {
        limit: 20,
        skip: 0,
        query: nickname,
        filters: [0]
      },
      {
        headers: {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.9,ru;q=0.8,und;q=0.7,pl;q=0.6',
          'authorization': 'Bearer ' + config.MEMEALERTS_JWT,
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          'cookie': '__ddg1_=y4NG5Rat9n0W9i2Orh0d; __ddg9_=46.53.249.213; __ddg8_=XGqcNtz64foPStPN; __ddg10_=1760475917',
          'dnt': '1',
          'origin': 'https://memealerts.com',
          'pragma': 'no-cache',
          'priority': 'u=1, i',
          'referer': 'https://memealerts.com/supporters',
          'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Linux"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
        }
      }
    );

    const supportersData = response.data;
    console.log('Found the following supporters: ', supportersData);

    if (!supportersData.total) {
      console.warn('Supporter by nickname ' + nickname + ' not found');
      return null;
    }

    // Example
    // {
    //    "_id": "6448f74a7cd2a3c9dab681ea",
    //    "balance": 1022,
    //    "joined": 1726001279084,
    //    "purchased": 1035,
    //    "spent": 13,
    //    "lastSupport": 1760475754974,
    //    "newbieActionUsed": false,
    //    "welcomeBonusEarned": true,
    //    "isMutedByStreamer": false,
    //    "supporterName": "nglzzz",
    //    "supporterAvatar": "media/64483d657cd2a3c9dab584bb/51e369604b58dbdaf104eb77ea87fd3f.png",
    //    "supporterLink": "nglzzz",
    //    "supporterId": "64483d657cd2a3c9dab584bb",
    //    "mutes": [],
    //    "mutedByStreamer": false
    // }

    if (supportersData.data[0].supporterName.toLowerCase() === nickname.toLowerCase()) {
      return supportersData.data[0];
    }

    return null;
  } catch (error) {
    console.error('Ошибка при выполнении запроса:', error);
    return null;
  }
}

module.exports = onMemesReward;
