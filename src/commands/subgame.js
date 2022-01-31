const subGameModel = require('../models/subGame.model');
const messageHelper = require('../helpers/messageHelper');

async function onSubGameCommand(channel, tags, message) {
  const isSubscriber = tags.subscriber;

  if (!isSubscriber) {
    return 'Отказано. Только подписчики канала могут заказывать игры на сабдей.';
  }

  const subject = messageHelper.getSubjectFromMessage(message);
  const user = tags.username;

  if (subject.length === 0) {
    return getCurrentUserGame(user);
  }

  let subGame = await subGameModel.findOne({
    user: user,
    closedDate: null
  });

  if (null === subGame) {
    subGame = new subGameModel({
      game: subject,
      user: user,
    });
  } else {
    subGame.game = subject;
    subGame.updatedAt = new Date();
  }

  subGame.save();

  return `@${user}, заказ принят. Игра: "${subject}"`;
}

async function getCurrentUserGame(username) {
  const subGame = await subGameModel.findOne({
    user: username,
    closedDate: null
  });

  if (!subGame) {
    return `@${username}, у тебя нет заказанных игр. Готов заказать?`;
  }

  return `@${username}, ты заказал: ${subGame.game}`;
}

module.exports = onSubGameCommand;
