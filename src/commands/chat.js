const config = require('../config');
const messageHelper = require('../helpers/messageHelper');
const axios = require('axios');
const API_URL = 'https://api.openai.com/v1/completions';

async function onChatCommand(channel, tags, message) {
  let text = messageHelper.getSubjectFromMessage(message).trim();
  const chatter = tags['display-name'] ?? tags.username;

  if (text.length === 0) {
    return 'Невозможно ответить на пустое сообщение';
  }

  const response = await axios({
    url: API_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`
    },
    data: {
      prompt: text,
      model: 'text-davinci-003',
      temperature: 0,
      max_tokens: 1000,
      top_p: 1,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
    }
  });

  const answer = response?.data?.choices[0]?.text;

  if (typeof answer !== 'undefined') {
    return `@${chatter}, ${answer}`;
  }

  return 'Не удалось получить данные с OpenAI';
}

module.exports = onChatCommand;
