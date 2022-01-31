const subGameModel = require('../models/subGame.model');
const messageHelper = require('../helpers/messageHelper');

async function onSubGamesCommand(channel, tags, message) {
    const isStreamer = tags.streamer;

    if (!isStreamer) {
        return removeMyGame(tags.username);
    }

    const subject = messageHelper.getSubjectFromMessage(message);

    if (subject.length === 0) {
        return removeMyGame(tags.username);
    }

    const users = subject.split(',').map(s => s.replace('@', '').trim());

    const subGames = await subGameModel.find({
      user: {
        "$in": users
      },
      closedDate: null
    });

    const games = subGames.map(subGame => subGame.game);

    if (!games.length) {
        return 'Не найдено заказанных игр для выбранных пользователей.';
    }

    subGames.forEach(function(item) {
        item.remove();
    });

    return `Игры для выбранных пользователей (${users.join(', ')}) удалены`;
}

async function removeMyGame(user) {
    const subGame = await subGameModel.findOne({
      user: user,
      closedDate: null
    });

    if (null === subGame) {
        return `@${user}, у тебя нет заказанных игр.`;
    }

    const game = subGame.game;

    subGame.remove();

    return `@${user}, игра "${game}" была успешно удалена.`;
}

module.exports = onSubGamesCommand;
