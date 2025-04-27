const Chat = require('../app/chat');
const { MAX_LATEST_CHATTERS } = require('../const/enums');

const chatters = [];
const latestChatters = [];
const latestMessages = {};

// Save chatters to global array
Chat.getClient().on('message', (channel, tags, message, self) => {
  // if (latestChatters.includes(tags.username)) {
  //   return;
  // }

  latestChatters.filter((chatter) => chatter !== tags.username);
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

  latestMessages[tags.username] = {
    id: tags.id,
    text: messageText
  };
}

function deleteLatestMessage(username) {
  delete latestMessages[username];
}

const getChatters = () => chatters;
const getLatestChatters = () => latestChatters;
const getLatestMessages = () => latestMessages;

module.exports = {
  getChatters: getChatters,
  getLatestChatters: getLatestChatters,
  getLatestMessages: getLatestMessages,
  deleteLatestMessage,
};
