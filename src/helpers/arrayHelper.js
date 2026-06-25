const getRandomArrayElement = (array) => {
  if (array.length === 1) {
    return array[0];
  }

  return array[Math.floor(Math.random() * array.length)];
}

const removeItemsFromArray = (array, items) => {
  return array.filter((item) => {
    return items.indexOf(item) === -1;
  });
}

const getBotList = () => {
  return [
    'moobot',
    'nglzzzbot',
    'restreambot',
    'streamelements',
    'mirrobot',
    'nightbot',
    'wizebot',
    'jeetbot',
    'twirapp',
    'boombai_bot',
    'ratecommunity',
  ];
}

const removeBotsFromList = (list) => {
  const bots = getBotList().map(b => b.toLowerCase());
  return list.filter((item) => !bots.includes(item.toLowerCase()));
}

module.exports = {
  getRandomArrayElement: getRandomArrayElement,
  removeItemsFromArray: removeItemsFromArray,
  getBotList: getBotList,
  removeBotsFromList: removeBotsFromList,
}
