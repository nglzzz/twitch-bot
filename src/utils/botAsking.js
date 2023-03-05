const numberHelper = require('../helpers/numberHelper');
const sendRequestToChatGpt = require('../utils/chatGPT');
const arrayHelper = require('../helpers/arrayHelper');
const config = require('../config');

async function doRandomAsk(subject) {
  const askList = [
    'Спроси @subject о любви',
    'Задай вопрос для @subject о любви',
    'Спроси @subject о свободе',
    'Спроси @subject о счастье',
    'Попроси @subject рассказать смешную историю',
    'Попроси @subject рассказать анекдот',
    'Спроси @subject о twitch и начни фразу с "У меня к тебе вопрос про твич"',
    'Спроси @subject о происхождении его имени',
    'Пожелай удачи @subject',
    'Пожелай чего-нибудь приятного для @subject',
    'Скажи @subject что-нибудь милое',
    'Расскажи для @subject историю',
    'Расскажи для @subject историю о любви',
    'Расскажи для @subject историю о предательстве',
    'Расскажи для @subject историю о дружбе',
    'Спроси @subject о дружбе',
    'Спроси @subject о сексе',
    'Спроси @subject о здоровье',
    'Спроси @subject о хобби',
    'Спроси @subject о любимом деле',
    'Спроси @subject о политике',
    'Спроси @subject о погоде',
    'Спроси @subject о празднике',
    'Спроси @subject о философии',
    'Спроси @subject о книгах',
    'Сделай комплимент для @subject',
    'Похвали @subject',
    'Поздравь @subject с праздником',
    'Напиши сообщение для @subject содержащие слова твич, меддисон, стример, ты',
    'Напиши сообщение для @subject содержащие слова россия, жизнь, звезда',
    'Напиши сообщение для @subject содержащие слова деньги, водка, пиво',
    'Напиши сообщение для @subject содержащие слова девушки, мужчины, скуфы',
    'Напиши сообщение для @subject содержащие слова велик, комп, колонки, ночь, поздно, верно',
    'Опиши тремя словами @subject и начни фразу со слов "ты похож на"',
    'Спроси @subject о его любимых играх',
    'Спроси @subject что он предпочитает компьютер или игровую приставку',
    'Спроси @subject о любимых позах в постеле',
    'Спроси @subject о бдсм',
    'Расскажи анекдот про @subject и человеком со случайным именем',
    'Расскажи анекдот про @subject и ' + config.BOT_NAME + '. Начни со слов: я придумал анекдот про нас',
    'Поблагодари @subject за то что пишет в чате',
    'Поблагодари @subject за то что общается с тобой',
    'Спроси @subject где он был 8 лет',
    'Спроси @subject про 8 лет',
  ];

  const symbols = numberHelper.randomInteger(15, 50);
  const ask = arrayHelper.getRandomArrayElement(askList).replace('@subject', subject) + ' минимум на ' + symbols + ' символов';

  const answer = await sendRequestToChatGpt(ask);

  return `@${subject} ${answer}`;
}

module.exports = doRandomAsk;
