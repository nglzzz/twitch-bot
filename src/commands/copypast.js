const config = require('../config');
const copyPastList = require('../utils/copypasts');
const arrayHelper = require('../helpers/arrayHelper');

async function onCopyPastCommand(channel, tags, message) {
  return arrayHelper.getRandomArrayElement(copyPastList)
    .replace('*streamername*', config.CHANNEL)
    .replace('*botname*', config.BOT_NAME);
}

module.exports = onCopyPastCommand;
