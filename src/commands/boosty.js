async function onBoostyCommand(channel, tags) {
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter}, бусти - https://boosty.to/nglzzz ;)`;
}

module.exports = onBoostyCommand;
