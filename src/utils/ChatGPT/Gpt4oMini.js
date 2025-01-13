const AbstractChatGPT = require('./AbstractChatGPT');
const Gpt35Turbo = require('./Gpt35Turbo');

class Gpt4oMini extends AbstractChatGPT
{
  modelName = 'gpt-4o-mini';

  getBackupModel() {
    return Gpt35Turbo.getInstance();
  }
}

module.exports = Gpt4oMini;
