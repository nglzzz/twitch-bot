const subGameRepo = require('../repositories/subGame.repo');
const messageHelper = require('../helpers/messageHelper');

async function onSubGameCommand(channel, tags, message) {
  const isSubscriber = tags.subscriber;

  if (!isSubscriber) {
    return 'Отказано. Только подписчики канала могут заказывать игры на сабдей.';
  }

  const subject = messageHelper.getSubjectFromMessage(message);
  const user = tags.username;
  const chatter = tags['display-name'] ?? tags.username;

  if (subject.length === 0) {
    return getCurrentUserGame(user);
  }

  const subGame = subGameRepo.findOneOpenByUser(user);

  if (!subGame) {
    subGameRepo.create({ game: subject, user });
  } else {
    subGameRepo.update(subGame._id, { game: subject });
  }

  return `@${chatter}, заказ принят. Игра: "${subject}"`;
}

async function getCurrentUserGame(username) {
  const subGame = subGameRepo.findOneOpenByUser(username);

  if (!subGame) {
    return `@${username}, у тебя нет заказанных игр. Готов заказать?`;
  }

  return `@${username}, ты заказал: ${subGame.game}`;
}

module.exports = onSubGameCommand;
