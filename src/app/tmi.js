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

const chatMessageHandler = (handlerResult, channel) => {
  if (Array.isArray(handlerResult)) {
    let delay = 0;
    handlerResult.forEach(message => {
      setTimeout(() => client.say(channel, message), delay);
      delay += 1500;
    });
  } else {
    client.say(channel, handlerResult);
  }
};

client.registerReward = (handleRewardId, rewardHandler) => {
  client.on('message', (channel, tags, message, self) => {
    if (self) return;

    const rewardType = tags['msg-id'] || tags['custom-reward-id'] || null;

    if (!rewardType) return;

    if (rewardType === handleRewardId) {
      rewardHandler(channel, tags, message).then((handlerResult) => chatMessageHandler(handlerResult, channel));
    }
  });
};

client.registerCommand = (commandName, commandHandler, alias) => {
  commandsList.push(commandName);

  client.on('message', (channel, tags, message, self) => {
    if(self || !message.startsWith('!')) return;

    const messageCommand = message.toLowerCase().split(' ').shift();

    if ([commandName, alias].includes(messageCommand)) {
      tags.streamer = tags?.badges?.broadcaster === '1';
      commandHandler(channel, tags, message).then((handlerResult) => chatMessageHandler(handlerResult, channel));
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
