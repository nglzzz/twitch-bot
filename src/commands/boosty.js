async function onBoostyCommand(channel, tags) {
  const chatter = tags['display-name'] ?? tags.username;

  return `Брат, @${chatter}, подпишись на бусти https://boosty.to/nglzzz ;)`;
}

module.exports = onBoostyCommand;
