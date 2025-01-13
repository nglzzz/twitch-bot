const axios = require('axios');
const config = require('../../config');
const AbstractChatGPT = require('./AbstractChatGPT');
const Gpt35TurboDefault = require('./GPT35Default');

class Gpt35Turbo extends AbstractChatGPT
{
  modelName = 'gpt-3.5-turbo-1106';

  getBackupModel() {
    return Gpt35TurboDefault.getInstance();
  }
}

module.exports = Gpt35Turbo;
