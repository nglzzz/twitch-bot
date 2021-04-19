const getRandomArrayElement = (array) => {
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
  ];
}

const removeBotsFromList = (list) => {
  return removeItemsFromArray(list, getBotList());
}

module.exports = {
  getRandomArrayElement: getRandomArrayElement,
  removeItemsFromArray: removeItemsFromArray,
  getBotList: getBotList,
  removeBotsFromList: removeBotsFromList,
}
