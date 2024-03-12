async function onMemeCommand(channel, tags) {
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter}, https://memealerts.com/nglzzz`;
}

module.exports = onMemeCommand;
