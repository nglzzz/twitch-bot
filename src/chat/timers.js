const tmiClient = require('../app/tmi');
const copyPastList = require('../utils/copypasts');
const arrayHelper = require('../helpers/arrayHelper');
const config = require('../config');

const copyPastTimer = setInterval(() => {
  const randomMessage = arrayHelper.getRandomArrayElement(copyPastList);
  tmiClient.say(config.CHANNEL, randomMessage);
}, 1000 * 60 * 20);
