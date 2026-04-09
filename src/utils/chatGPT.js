const config = require('../config');
const ChatGPTClient = require('./ChatGPT/AbstractChatGPT');

module.exports = ChatGPTClient.getInstance(config.CHAT_GPT_MODEL);
