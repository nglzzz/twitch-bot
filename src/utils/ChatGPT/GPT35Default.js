const AbstractChatGPT = require('./AbstractChatGPT');
const Gpt4o = require('./Gpt4o');

class Gpt35TurboDefault extends AbstractChatGPT
{
  modelName = 'gpt-3.5-turbo';

  getBackupModel() {
    return Gpt4o.getInstance();
  }
}

module.exports = Gpt35TurboDefault;
