const subGameModel = require('../models/subGame.model');

async function onSubGamesCommand(channel, tags) {
    const subGames = await subGameModel.find({
      closedDate: null
    });

    return 'Заказанные игры на сабдей: ' + subGames.map(subGame => subGame.user + ': ' + subGame.game).join(', ');
}

module.exports = onSubGamesCommand;
