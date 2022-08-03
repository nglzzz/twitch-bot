const axios = require('axios');
const config = require('../config');
const arrayHelper = require('../helpers/arrayHelper');

const getChannelViewers = async () => {
  const response = await axios.get(`https://tmi.twitch.tv/group/user/${config.CHANNEL}/chatters`);
  const { chatters } = response.data;
  let viewers = [
    ...chatters.vips,
    ...chatters.moderators,
    ...chatters.staff,
    ...chatters.viewers
  ];

  return arrayHelper.removeBotsFromList(viewers);
}

module.exports = getChannelViewers;
