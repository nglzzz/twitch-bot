const ChatGpt = require('../utils/chatGPT');
const arrayHelper = require('../helpers/arrayHelper');
const config = require('../config');
const {randomInteger} = require('../helpers/numberHelper');

async function doRandomAsk(subject, message) {
  let question = randomInteger(0, 50) < 15 ? getPreparedAsk(subject) : getAskFromMessage(subject, message);
  question = question.replace(subject + ' ' + subject, subject); // fix double subject

  ChatGpt.updateContext(subject, 'user', question);
  const answer = await ChatGpt.addMessage(subject, question, config.BOT_NAME);

  return `@${subject} ${answer}`;
}

function getPreparedAsk(subject) {
  const askList = [
    'Задай вопрос для @subject о любви',
    'Задай вопрос для @subject о свободе',
    'Задай вопрос для @subject о счастье',
    '@subject в чате. Попроси его рассказать тебе смешную историю',
    'Попроси чтобы тебе рассказали анекдот',
    'Задай вопрос о twitch и начни фразу с "У меня к тебе вопрос про твич"',
    'Мой никнейм @subject. Задай вопрос об его происхождении',
    'Пожелай удачи без слов "конечно"',
    'Пожелай чего-нибудь приятного для @subject без слов "конечно"',
    'Скажи что-нибудь милое для меня без слов "конечно"',
    'Расскажи интересную историю без слов "конечно"',
    'Расскажи историю о любви',
    'Расскажи историю о предательстве',
    'Расскажи историю о дружбе',
    'Задай вопрос о дружбе',
    'Задай вопрос о здоровье',
    'Задай вопрос о хобби',
    'Задай вопрос о любимом деле',
    'Задай вопрос о политике',
    'Задай вопрос о погоде',
    'Задай вопрос о празднике',
    'Задай вопрос о философии',
    'Задай вопрос о книгах',
    'Сделай комплимент для @subject без слов "конечно"',
    'Похвали @subject без слов "конечно"',
    'Поздравь @subject с праздником без слов "конечно"',
    'Напиши сообщение для @subject содержащие слова твич, меддисон, стример, ты',
    'Напиши сообщение для @subject содержащие слова россия, жизнь, звезда',
    'Напиши сообщение для @subject содержащие слова деньги, работа, усталость',
    'Напиши сообщение для @subject содержащие слова девушки, мужчины',
    'Напиши сообщение для @subject содержащие слова велик, комп, колонки, ночь, поздно, верно',
    'Опиши тремя словами @subject и начни фразу со слов "ты похож на"',
    'Задай вопрос для @subject о его любимых играх',
    'Задай вопрос для @subject что он предпочитает компьютер или игровую приставку',
    'Задай вопрос для @subject о любимых позах в постеле',
    'Расскажи анекдот про @subject и человеком со случайным именем',
    'Расскажи анекдот про @subject и ' + config.BOT_NAME + '. Начни со слов: я придумал анекдот про нас',
    'Поблагодари @subject за то что пишет в чате',
    'Поблагодари @subject за то что общается с тобой',
    'Задай вопрос для @subject где он был 8 лет',
    'Задай мне вопрос о сексе',
    'Задай мне вопрос о моих предпочтениях в сексе',
    'Задай мне вопрос какие мне девушки нравятся',
    'Задай мне вопрос о любимых позах в постеле',
    'Попроси @subject поддержать канал донатом',
  ];

  return arrayHelper
    .getRandomArrayElement(askList)
    .replaceAll('@subject', subject);
}

function getAskFromMessage(subject, message) {
  return `Придумай ответ в шутливой форме на сообщение от ${subject} "${message}".`;
}

module.exports = doRandomAsk;
