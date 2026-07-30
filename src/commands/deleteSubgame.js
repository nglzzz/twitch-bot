const subGameRepo = require('../repositories/subGame.repo');
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

    const subGames = subGameRepo.findOpenByUsers(users);

    const games = subGames.map(subGame => subGame.game);

    if (!games.length) {
        return 'Не найдено заказанных игр для выбранных пользователей.';
    }

    subGames.forEach((item) => {
        subGameRepo.removeById(item._id);
    });

    return `Игры для выбранных пользователей (${users.join(', ')}) удалены`;
}

async function removeMyGame(user) {
    const subGame = subGameRepo.findOneOpenByUser(user);

    if (!subGame) {
        return `@${user}, у тебя нет заказанных игр.`;
    }

    const game = subGame.game;

    subGameRepo.removeById(subGame._id);

    return `@${user}, игра "${game}" была успешно удалена.`;
}

module.exports = onSubGamesCommand;
