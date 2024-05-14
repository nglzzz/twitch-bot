const tmi = require('tmi.js');
const config = require('../config');

class Chat {
  static _instance;
  _client;
  _commandsList = {};

  constructor() {
    this._client = new tmi.Client({
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

    this._client.connect().catch(console.error);
  }

  static getInstance() {
    if (this._instance) {
      return this._instance;
    }

    this._instance = new Chat();
    return this._instance;
  }

  registerReward(handleRewardId, rewardHandler) {
    this._client.on('message', (channel, tags, message, self) => {
      if (self) return;

      const rewardType = tags['msg-id'] || tags['custom-reward-id'] || null;

      if (!rewardType) return;

      if (rewardType === handleRewardId) {
        rewardHandler(channel, tags, message).then(resultMessage => this.handleMessageResult(resultMessage, channel));
      }
    });
  }

  registerCommand(commandName, commandHandler, alias) {
    this._commandsList[commandName] = commandHandler;
    if (alias) {
      this._commandsList[alias] = commandHandler;
    }

    // handle commands
    this._client.on('message', (channel, tags, message, self) => {
      // allow to use chatGPT command as @botName
      if (message.includes(`@${config.BOT_NAME}`)) {
        message = '!chat ' + message.replace(`@${config.BOT_NAME}`, '');
      }

      if (self || !message.startsWith('!')) return;

      const messageCommand = message.toLowerCase().split(' ').shift();

      if ([commandName, alias].includes(messageCommand)) {
        tags.streamer = tags?.badges?.broadcaster === '1';
        commandHandler(channel, tags, message).then(resultMessage => this.handleMessageResult(resultMessage, channel));
      }
    })
  };

  handleMessageResult(resultMessage, channel) {
    if (Array.isArray(resultMessage)) {
        let delay = 0;
        resultMessage.forEach(message => {
          setTimeout(() => this._client.say(channel, message), delay);
          delay += 1500;
        });
    } else {
      this._client.say(channel, resultMessage);
    }
  }

  getClient() {
    return this._client;
  }

  getCommandList() {
    return this._commandsList;
  }
}

const client = Chat.getInstance();

/**
 *
 * @type {Chat}
 * @function registerCommand
 * @function registerReward
 * @function getCommandList
 */
module.exports = client;
