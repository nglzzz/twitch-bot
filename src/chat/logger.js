const db = require('../app/db');
const Chat = require('../app/chat');
const chatLogModel = require('../models/chatLog.model');
const { linkMessageToStream } = require('../services/streamTracker.service');

function isDbReady() {
  return db?.connection?.readyState === 1;
}

Chat.getClient().on('message', async (channel, tags, message, self) => {
  if (self || !tags?.username || !message || message.startsWith('!') || !isDbReady()) {
    return;
  }

  const chatLog = new chatLogModel({
    user: tags.username.toLowerCase(),
    displayName: tags['display-name'] ?? tags.username,
    message,
  });

  try {
    await linkMessageToStream(chatLog);
  } catch (_) {
    // Ignore — message will be saved without stream link
  }

  chatLog.save().catch((error) => {
    console.log('Could not save chat log entry:', error.message);
  });
});
