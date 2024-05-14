const axios = require('axios');
const config = require('../../config');
const AbstractChatGPT = require('./AbstractChatGPT');
const Pawan = require('./Pawan');

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
          model: 'gpt-4-turbo',
          messages: this._context[user],
          user: user,
          max_tokens: 512,
        }
      });

      let answer = response?.data?.choices[0]?.message?.content;
      return this.handleAnswerOrResend(answer, user, message, from, defaultMessage, Pawan.getInstance());
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
      return this.resendByBackupModel(user, message, from, defaultMessage, Pawan.getInstance());
    }
  }
}

module.exports = Gpt40Turbo;
