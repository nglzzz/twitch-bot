const config = require('../config');
const Gpt35Turbo = require('./ChatGPT/Gpt35Turbo');
const Gpt35TurboDefault = require('./ChatGPT/GPT35Default');
const Gpt40Turbo = require('./ChatGPT/Gpt40Turbo');
const TextDavinci = require('./ChatGPT/TextDavinci');
const Pawan = require('./ChatGPT/Pawan');
const Gpt4o = require('./ChatGPT/Gpt4o');
const Gpt4oMini = require('./ChatGPT/Gpt4oMini');

/**
 * В случае если установлена модель gpt-4o-min-turbo-1106 то запускается gpt-3.5-turbo-1106
 * В случае если установлена модель gpt-3.5-turbo-1106 то запускается Gpt35Turbo
 * Если Gpt35Turbo вернёт ошибку, то произойдёт попытка запроса с помощью Gpt35TurboDefault (gpt-3.5-turbo)
 * Если Gpt35TurboDefault вернёт ошибку, то произойдёт попытка запроса с помощью Gpt4o (gpt-4o).
 * Если Gpt4o вернёт ошибку, то произойдёт попытка запроса с помощью Gpt40Turbo (gpt-4-turbo)
 * Если Gpt40Turbo вернёт ошибку, то произойдёт попытка запроса с помощью Pawan
 * Если Pawan вернёт ошибку, то произойдёт попытка запроса с помощью TextDavinci
 */
class ChatGptFactory
{
  static create(model) {
    switch (model) {
      case 'gpt-4o':
        return Gpt4o.getInstance();
      case 'gpt-4o-mini':
        return Gpt4oMini.getInstance();
      case 'gpt-3.5':
      case 'gpt-3.5-turbo-1106':
        return Gpt35Turbo.getInstance();
      case 'gpt-3.5-turbo':
        return Gpt35TurboDefault.getInstance();
      case 'gpt-4.0-turbo':
        return Gpt40Turbo.getInstance();
      case 'pawan':
        return Pawan.getInstance();
      case 'text-davinci':
      case 'text-davinci-003':
        return TextDavinci.getInstance();
      default:
        return Gpt35TurboDefault.getInstance();
    }
  }
}

/**
 * @type AbstractChatGPT
 */
module.exports = ChatGptFactory.create(config.CHAT_GPT_MODEL);
