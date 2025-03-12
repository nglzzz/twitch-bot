const axios = require('axios');

async function onBitcoinCommand(channel, tags, message) {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    return 'Курс биткоина: $' + response.data.bitcoin.usd;
  } catch (error) {
    return 'Не удалось получить курс биткоина';
  }
}

module.exports = onBitcoinCommand;
