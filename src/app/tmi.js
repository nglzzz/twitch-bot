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

client.registerReward = (handleRewardId, rewardHandler) => {
  client.on('message', (channel, tags, message, self) => {
    if (self) return;

    const rewardType = tags['msg-id'] || tags['custom-reward-id'] || null;

    if (!rewardType) return;

    if (rewardType === handleRewardId) {
      rewardHandler(channel, tags, message).then(handlerResult => {
        if (Array.isArray(handlerResult)) {
          let delay = 0;
          handlerResult.forEach(message => {
            setTimeout(() => client.say(channel, message), delay);
            delay += 1500;
          });
        } else {
          client.say(channel, handlerResult);
        }
      })
    }
  });
};

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
 * @function registerReward
 * @function getCommandList
 */
module.exports = client;
