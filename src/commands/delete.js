const messageHelper = require('../helpers/messageHelper');
const { getLatestMessages, deleteLatestMessage } = require('../chat/chatters');
const deleteMessage = require('../twitchApi/deleteMessage');

async function onDeleteCommand(channel, tags, message) {
  let subject = messageHelper.getSubjectFromMessage(message);

  if (subject.length === 0) {
    subject = tags.username;
  }

  const latestMessages = getLatestMessages();

  if (!latestMessages || !latestMessages[subject]) {
    return;
  }

  try {
    console.log(latestMessages);
    await deleteMessage(latestMessages[subject].id);
    deleteLatestMessage(subject);
  } catch (error) {
    console.error('Ошибка при удалении сообщения:', error);
  }

  return '';
}

module.exports = onDeleteCommand;
