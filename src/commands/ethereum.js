const axios = require('axios');

async function onEthereumCommand(channel, tags, message) {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    return 'Курс эфириума: $' + response.data.ethereum.usd;
  } catch (error) {
    return 'Не удалось получить курс эфириума';
  }
}

module.exports = onEthereumCommand;
