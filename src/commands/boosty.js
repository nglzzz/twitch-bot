async function onBoostyCommand(channel, tags) {
  return `Брат, @${chatter}, подпишись на бусти ${arrayHelper.getRandomArrayElement(list)} ;)`;
}

module.exports = onBoostyCommand;
