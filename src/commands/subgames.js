const subGameRepo = require('../repositories/subGame.repo');

async function onSubGamesCommand(channel, tags) {
    const subGames = subGameRepo.findOpen();

    return 'Заказанные игры на сабдей: ' + subGames.map(subGame => subGame.user + ': ' + subGame.game).join(', ');
}

module.exports = onSubGamesCommand;
