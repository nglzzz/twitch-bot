const AbstractChatGPT = require('./AbstractChatGPT');
const Gpt4oMini = require('./Gpt4oMini');

class DeepSeek extends AbstractChatGPT
{
  modelName = 'deepseek-chat';

  getUrl() {
    return 'https://api.deepseek.com/chat/completions';
  }

  getBackupModel() {
    return Gpt4oMini.getInstance();
  }
}

module.exports = DeepSeek;
