const client = require('../app/tmi');
const { MAX_LATEST_CHATTERS } = require('../const/enums');

const chatters = [];
const latestChatters = [];

// Save chatters to global array
client.on('message', (channel, tags, message, self) => {
  latestChatters.filter((chatter) => chatter !== tags.username);
  latestChatters.push(tags.username);
  if (latestChatters.length > MAX_LATEST_CHATTERS) {
    latestChatters.shift();
  }

  if (chatters.indexOf(tags.username) !== -1) {
    return;
  }

  chatters.push(tags.username);
});

const getChatters = () => chatters;
const getLatestChatters = () => latestChatters;

module.exports = {
  getChatters: getChatters,
  getLatestChatters: getLatestChatters,
};
