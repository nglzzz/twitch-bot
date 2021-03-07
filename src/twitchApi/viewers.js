const axios = require('axios');
const arrayHelper = require('../helpers/arrayHelper');

const getChannelViewers = async () => {
  const response = await axios.get(`https://tmi.twitch.tv/group/user/${process.env.CHANNEL}/chatters`);
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
