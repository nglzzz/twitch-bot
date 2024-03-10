const messageHelper = require('../helpers/messageHelper');

async function onRatingCommand(channel, tags, message) {
  const subject = messageHelper.getSubjectFromMessage(message) || '';

  if (!tags.mod && !tags.streamer) {
    return '';
  }

  switch (subject.toLowerCase().trim()) {
    case '':
    case 'on':
    case 'start':
      global.ratingStart = true;
      global.ratingList = {};
      return 'Начался подсчёт рейтинга! Пишите свою оценку в чат от 1 до 10';
    case 'off':
    case 'stop':
      global.ratingStart = false;
      return 'Средний рейтинг составляет: ' + calcAvgRating();
    case 'list':
      let message = 'Рейтинг зрителей: ';
      for (let key in ratingList) {
        message += key + ': ' + ratingList[key] + ' ';
      }

      return message;
  }

  return '';
}

function calcAvgRating() {
  let sum = 0;
  let count = 0;
  for (let key in ratingList) {
    sum += ratingList[key];
    count++;
  }

  return (sum / count).toFixed(2);
}

module.exports = onRatingCommand;
