const copyPastList = require('../utils/copypasts');
const arrayHelper = require('../helpers/arrayHelper');

async function onCopyPastCommand(channel, tags, message) {
  return arrayHelper.getRandomArrayElement(copyPastList);
}

module.exports = onCopyPastCommand;
