const axios = require('axios');
const config = require('../../config');
const AbstractChatGPT = require('./AbstractChatGPT');
const TextDavinci = require('./TextDavinci');

class Gpt40Turbo extends AbstractChatGPT
{
  async addMessage(user, message, from, defaultMessage) {
    const url = 'https://api.proxyapi.ru/openai/v1/chat/completions'; // for openai: https://api.openai.com/v1/chat/completions
    this.updateContext(user, 'user', message, from);

    try {
      const response = await axios({
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`
        },
        data: {
          model: 'gpt-4-1106-preview',
          messages: this._context[user],
          user: user,
          max_tokens: 512,
        }
      });

      let answer = response?.data?.choices[0]?.message?.content;
      answer = this.filterResult(answer);

      if (typeof answer !== 'undefined') {
        const hasBannedWords = [
          'я не могу',
          'я не буду',
          'извините, но',
          'к сожалению, я',
          'если у тебя есть какие-то другие вопросы',
          'я не имею возможности',
          'но не стану',
        ].some(v => answer.toLowerCase().includes(v));

        if (!answer.length || hasBannedWords) {
          console.log('Change ChatGPT algorithm');

          // against censor
          this.resetContext(user);
          return this.resendByBackupModel(user, message, from, defaultMessage || answer);
        }
        this.updateContext(user, 'assistant', answer);

        return answer;
      }

      return this.resendByBackupModel(user, message, from, defaultMessage);
    } catch (e) {
      if (e.response) {
        console.error(e.response.data);
        console.error(e.response.status);
        console.error(e.response.headers);
      } else {
        console.error(e);
      }

      // backup option
      this.resetContext(user);
      return this.resendByBackupModel(user, message, from, defaultMessage);
    }
  }

  resendByBackupModel(user, message, from, defaultAnswer) {
    return TextDavinci.getInstance().addMessage(user, message, from, defaultAnswer);
  }
}

module.exports = Gpt40Turbo;
