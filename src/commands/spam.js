const messageHelper = require('../helpers/messageHelper');

async function onSpamCommand(channel, tags, message) {
  if (!tags.mod && !tags.streamer) {
    return '';
  }

  return Array(5).fill(messageHelper.getSubjectFromMessage(message));
}

module.exports = onSpamCommand;
