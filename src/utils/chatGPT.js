const axios = require('axios');
const config = require('../config');
const MAX_CONTEXT_SIZE = 12;

class ChatGptFactory
{
  static create(model) {
    switch (model) {
      case 'gpt-3.5-turbo':
        return GptTurbo.getInstance();
      default:
        return TextDavinci.getInstance();
    }
  }
}

class ChatGPT
{
  static _instance;
  _context = {};
  defaultBehavior = 'Ты дружелюбный бот на твиче стримера ' + config.CHANNEL;

  static getInstance() {
    if (this._instance) {
      return this._instance;
    }

    this._instance = new this;
    return this._instance;
  }

  async addMessage(user, message, from) {}

  updateContext(user, role, message, from) {
    if (typeof this._context[user] === 'undefined') {
      this._context[user] = [
        {
          role: 'system',
          content: this.defaultBehavior,
        },
      ];
    }

    this._context[user].push({
      role: typeof from !== 'undefined' && from === config.BOT_NAME ? 'assistant' : role,
      content: message,
    });

    // reload context
    if (this._context[user].length >= MAX_CONTEXT_SIZE) {
      const first = this._context[user].shift();
      const last = this._context[user].pop;
      this._context[user] = [first, last];
    }
  }
}

class GptTurbo extends ChatGPT
{
    async addMessage(user, message, from) {
      this.updateContext(user, 'user', message, from);

      const response = await axios({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`
        },
        data: {
          model: 'gpt-3.5-turbo',
          messages: this._context[user],
        }
      });

      const answer = response?.data?.choices[0]?.message?.content;

      if (typeof answer !== 'undefined') {
        this.updateContext(user, 'assistant', answer);

        return answer;
      }

      return 'Не удалось получить данные с OpenAI';
    }
}

class TextDavinci extends ChatGPT
{
  async addMessage(user, message, from) {
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
      url: 'https://api.openai.com/v1/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`
      },
      data: {
        prompt: previousMessage + "\r" + message,
        model: 'text-davinci-003',
        temperature: 0,
        max_tokens: 1000,
        top_p: 1,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
      },
    });

    const answer = response?.data?.choices[0]?.text;

    if (typeof answer !== 'undefined') {
      this.updateContext(user, 'assistant', answer);

      return answer;
    }

    return 'Не удалось получить данные с OpenAI';
  }
}

/**
 * @type ChatGPT
 */
module.exports = ChatGptFactory.create(config.CHAT_GPT_MODEL);
