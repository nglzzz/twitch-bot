const messageHelper = require('../helpers/messageHelper');
const ChatGPT = require('../utils/chatGPT');


async function onChatCommand(channel, tags, message) {
  let text = messageHelper.getSubjectFromMessage(message).trim();
  const chatter = tags['display-name'] ?? tags.username;

  if (text.length === 0) {
    return 'Невозможно ответить на пустое сообщение';
  }

  const answer = await ChatGPT.addMessage(chatter, text);

  if (typeof answer !== 'undefined') {
    return `@${chatter}, ${answer}`;
  }

  return 'Не удалось получить данные с OpenAI';
}

module.exports = onChatCommand;
