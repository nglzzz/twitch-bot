const Chat = require('../app/chat');

async function onHelpCommand(channel, tags) {
    return `Бот имеет следующие команды: ${Object.keys(Chat.getCommandList()).join(', ')}`;
}

module.exports = onHelpCommand;
