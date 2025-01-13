const AbstractChatGPT = require('./AbstractChatGPT');
const Gpt40Turbo = require('./Gpt40Turbo');

class Gpt4o extends AbstractChatGPT
{
  modelName = 'gpt-4o';

  getBackupModel() {
    return Gpt40Turbo.getInstance();
  }
}

module.exports = Gpt4o;
