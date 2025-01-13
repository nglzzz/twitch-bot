const AbstractChatGPT = require('./AbstractChatGPT');
const Pawan = require('./Pawan');

class Gpt40Turbo extends AbstractChatGPT
{
  modelName = 'gpt-4-turbo';

  getBackupModel() {
    return Pawan.getInstance();
  }
}

module.exports = Gpt40Turbo;
