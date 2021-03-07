const tmi = require('tmi.js');
const config = require('../config');

const client = new tmi.Client({
  options: { debug: config.DEBUG || true, messagesLogLevel: 'info' },
  connection: {
    reconnect: true,
    secure: true
  },
  identity: {
    username: config.BOT_NAME,
    password: config.OAUTH_TOKEN
  },
  channels: [ config.CHANNEL ]
});

client.connect().catch(console.error);

const commandsList = [];

client.on('redeem', (channel, username, rewardType, tags) => {
  console.log(rewardType);
  switch(rewardType) {
    // Message that appears "highlighted" in the chat.
    case 'highlighted-message': break;
    // Message that skips the subscriber-only mode
    case 'skip-subs-mode-message': break;
    // Custom reward ID
    case '27c8e486-a386-40cc-9a4b-dbb5cf01e439': break;
  }
});

client.registerCommand = (commandName, commandHandler, alias) => {
  commandsList.push(commandName);

  client.on('message', (channel, tags, message, self) => {
    if (self) return;

    const isCommandNameEqual = message.toLowerCase().indexOf(commandName) === 0;
    const isAliasCommandEqual = typeof alias !== 'undefined' && message.toLowerCase().indexOf(alias) === 0;

    if (isCommandNameEqual || isAliasCommandEqual) {
      commandHandler(channel, tags, message).then(handlerResult => {
        if (Array.isArray(handlerResult)) {
          let delay = 0;
          handlerResult.forEach(message => {
            setTimeout(() => client.say(channel, message), delay);
            delay += 1500;
          });
        } else {
          client.say(channel, handlerResult);
        }
      });
    }
  })
};

client.getCommandList = () => {
  return commandsList;
}

/**
 *
 * @type {tmi.Client}
 * @function registerCommand
 * @function getCommandList
 */
module.exports = client;
