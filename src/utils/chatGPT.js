const axios = require('axios');
const config = require('../config');
const API_URL = 'https://api.openai.com/v1/completions';

async function sendRequestToChatGpt(text) {
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
    return answer;
  }

  return 'Не удалось получить данные с OpenAI';
}

module.exports = sendRequestToChatGpt;
