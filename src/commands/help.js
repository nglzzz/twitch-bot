const tmiClient = require('../app/tmi');

async function onHelpCommand(channel, tags) {
    return `Бот имеет следующие команды: ${tmiClient.getCommandList().join(', ')}`;
}

module.exports = onHelpCommand;
