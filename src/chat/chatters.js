const client = require('../app/tmi');
const { MAX_LATEST_CHATTERS } = require('../const/enums');
const chatLogModel = require('../models/chatLog.model');

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

// Save ALL chatters to database (temporary solution for investigate why some users are ignored by the bot).
client.on('message', (channel, tags, message, self) => {
  const chatLog = new chatLogModel({
    user: tags['display-name'] ?? tags.username,
    message: message,
  });
  try {
    chatLog.save();
  } catch (err) {
    console.log(err);
  }
});

const getChatters = () => chatters;
const getLatestChatters = () => latestChatters;

module.exports = {
  getChatters: getChatters,
  getLatestChatters: getLatestChatters,
};
