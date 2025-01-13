const axios = require('axios');
const config = require('../../config');
const AbstractChatGPT = require('./AbstractChatGPT');

class TextDavinci extends AbstractChatGPT
{
  modelName = 'text-davinci-003';

  async addMessage(user, message, from, defaultMessage) {
    const url = 'https://api.openai.com/v1/completions';
    let previousMessage;
    if (typeof this._context[user] !== 'undefined') {
      const previousMessageItem = this._context[user];
      previousMessage = previousMessageItem[previousMessageItem.length - 1].content;
    } else {
      previousMessage = '';
    }
    this.updateContext(user, 'user', message, from);

    console.log(previousMessage + "\r" + message);

    const response = await axios({
      url: url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`
      },
      data: {
        prompt: (previousMessage + "\r" + message).trim(),
        model: 'text-davinci-003',
        temperature: 0,
        max_tokens: 512,
        top_p: 1,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
        user: user,
      },
    }).catch(e => {
      if (e.response) {
        console.error(e.response.data);
        console.error(e.response.status);
        console.error(e.response.headers);
      } else {
        console.error(e);
      }
    });

    let answer = response?.data?.choices[0]?.text;

    if (!answer) {
      return defaultMessage || 'Ошибка получения ответа.';
    }

    answer = this.filterResult(answer);

    if (typeof answer !== 'undefined' && answer.length > 0) {
      this.updateContext(user, 'assistant', answer);

      return answer;
    }

    return 'Нет ответа на данный вопрос';
  }
}

module.exports = TextDavinci;
