const axios = require('axios');
const config = require('../../config');
const AbstractChatGPT = require('./AbstractChatGPT');
const TextDavinci = require('./TextDavinci');

class Pawan extends AbstractChatGPT
{
  async addMessage(user, message, from, defaultMessage) {
    const url = 'https://api.pawan.krd/v1/chat/completions';
    this.updateContext(user, 'user', message, from);

    try {
      const response = await axios({
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.PAWAN_API_KEY}`
        },
        data: {
          model: 'pai-001',
          messages: this._context[user],
          user: user,
          max_tokens: 512,
        }
      });

      let answer = response?.data?.choices[0]?.message?.content;

      return this.filterResult(answer);
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
      return this.resendByBackupModel(user, message, from, defaultMessage, TextDavinci.getInstance());
    }
  }
}

module.exports = Pawan;
