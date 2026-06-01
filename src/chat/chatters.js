const Chat = require('../app/chat');
const { MAX_LATEST_CHATTERS } = require('../const/enums');

const chatters = [];
const latestChatters = [];
const latestMessages = {};
const recentMessages = [];
const MAX_RECENT_MESSAGES = 30;

// Save chatters to global array
Chat.getClient().on('message', (channel, tags, message, self) => {
  if (self || !tags?.username) {
    return;
  }

  const existingIndex = latestChatters.findIndex((chatter) => chatter === tags.username);
  if (existingIndex !== -1) {
    latestChatters.splice(existingIndex, 1);
  }

  latestChatters.push(tags.username);
  if (latestChatters.length > MAX_LATEST_CHATTERS) {
    latestChatters.shift();
  }
  storeMessage(channel, tags, message);

  if (chatters.indexOf(tags.username) !== -1) {
    return;
  }

  chatters.push(tags.username);
});

function storeMessage(channel, tags, messageText) {
  if (messageText.startsWith('!')) {
    return;
  }

  const username = tags.username;
  const displayName = tags['display-name'] ?? username;
  const messageData = {
    id: tags.id,
    user: username,
    displayName,
    text: messageText,
    createdAt: new Date().toISOString(),
  };

  latestMessages[username] = messageData;
  recentMessages.push(messageData);

  if (recentMessages.length > MAX_RECENT_MESSAGES) {
    recentMessages.shift();
  }
}

function deleteLatestMessage(username) {
  delete latestMessages[username];
}

const getChatters = () => chatters;
const getLatestChatters = () => latestChatters;
const getLatestMessages = () => latestMessages;
const getRecentMessages = () => recentMessages;

module.exports = {
  getChatters: getChatters,
  getLatestChatters: getLatestChatters,
  getLatestMessages: getLatestMessages,
  getRecentMessages,
  deleteLatestMessage,
};
