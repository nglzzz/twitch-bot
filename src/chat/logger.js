const { isDbReady } = require('../app/db');
const Chat = require('../app/chat');
const chatLogRepo = require('../repositories/chatLog.repo');
const { linkMessageToStream } = require('../services/streamTracker.service');

Chat.getClient().on('message', async (channel, tags, message, self) => {
  if (self || !tags?.username || !message || message.startsWith('!') || !isDbReady()) {
    return;
  }

  const user = tags.username.toLowerCase();
  const displayName = tags['display-name'] ?? tags.username;

  let streamSessionId = null;
  try {
    streamSessionId = await linkMessageToStream();
  } catch (_) {
    // Ignore — message will be saved without stream link
  }

  try {
    chatLogRepo.insert({ user, displayName, message, streamSessionId });
  } catch (error) {
    console.log('Could not save chat log entry:', error.message);
  }
});
