const tmiClient = require('../app/tmi');
const arrayHelder = require('../helpers/arrayHelper');

const chatters = [];

tmiClient.on('message', (channel, tags, message, self) => {
  if (self) return;

  if (arrayHelder.getBotList().indexOf(tags.username) !== -1) {
    return;
  }

  if (chatters.indexOf(tags.username) !== -1) {
    return;
  }

  chatters.push(tags.username);
});

const getChatters = () => chatters;

module.exports = getChatters;
