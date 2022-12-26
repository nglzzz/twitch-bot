const axios = require('axios');
const API_URL = 'http://castlots.org/generator-anekdotov-online/generate.php';

async function onJokeCommand(channel, tags) {
  return await getJokeFromCastLoads();
}

async function getJokeFromCastLoads() {
    const response = await axios({
      method: 'POST',
      url: API_URL,
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    const joke = response?.data?.va;

    if (typeof joke !== 'undefined') {
      return joke;
    }

    return getJokeFromAnekdotRu();
}

const getJokeFromAnekdotRu = () => {
  console.log('anekdot.ru');

  return 'Лупа и Пупа устроились на работу. Проработали целый месяц, трудились не покладая рук и не жалея живота своего. В конце месяца Лупа и Пупа пошли получать зарплату. В бухгалтерии все как обычно перепутали. И, в итоге, Лупа получил за Пупу, а Пупа за ЛУПУ!';
}

module.exports = onJokeCommand;
