const tmiClient = require('../app/tmi');
const arrayHelder = require('../helpers/arrayHelper');

const chatters = [];

tmiClient.on('message', (channel, tags, message, self) => {
  if (self) return;

  if (arrayHelder.getBotList().indexOf(tags.username) === -1) {
    chatters.push(tags.username);
  }
});

const getChatters = () => chatters;

module.exports = getChatters;
