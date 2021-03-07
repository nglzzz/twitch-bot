const tmiClient = require('../app/tmi');
const axios = require('axios');

async function onJokeCommand(channel, tags) {
  return await getJokeFromCastLoads();
}

async function getJokeFromCastLoads() {
    const response = await axios({
      method: 'POST',
      url: 'https://castlots.org/generator-anekdotov-online/generate.php',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    const isJsonData = typeof response.data === 'object';
    const isJokeExists = typeof response.data.va !== 'undefined';

    if (isJsonData && isJokeExists) {
      return response.data.va;
    }

    return getJokeFromAnekdotRu();
}

const getJokeFromAnekdotRu = () => {
  console.log('anekdot.ru');

  return 'something wrong';
}

module.exports = onJokeCommand;
