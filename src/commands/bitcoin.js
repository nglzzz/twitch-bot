const axios = require('axios');

async function onBitcoinCommand(channel, tags, message) {
  try {
    const response = await axios.get('https://api.coindesk.com/v1/bpi/currentprice/BTC.json');
    return 'Курс биткоина: $' + response.data.bpi.USD.rate;
  } catch (error) {
    return 'Не удалось получить курс биткоина';
  }
}

module.exports = onBitcoinCommand;
