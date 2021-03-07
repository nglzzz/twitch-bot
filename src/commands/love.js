const arrayHelper = require('../helpers/arrayHelper');
const numberHelper = require('../helpers/numberHelper');

async function obLoveCommand(channel, tags, message) {
  const subject = getSubjectFromMessage(message).replace('@', '');
  const chatter = tags['display-name'];

  if (subject.length === 0) {
    return 'Звёзды подскажут ваш уровень любви. Просто отправьте сообщение "!любовь [цель]"' +
      ' (например "!любовь @nglzzz" или "!любовь тортик")';
  }

  if (subject === chatter) {
    return 'Люби себя молча, нарцис';
  }

  const list = [
    `@${subject} любит тебя всем сердцем <3`,
    `@${subject} любит тебя как друга :|`,
    `@${subject} без ума от тебя <3`,
    `@${subject} не любит тебя BibleThump`,
    `@${subject} ненавидит тебя`,
    `@${subject} возможно любит тебя, возможно нет`,
    `${numberHelper.randomInteger(0, 100)}% - это уровень любви между тобой и @${subject}`,
    `${numberHelper.randomInteger(0, 100)}% - это уровень любви между тобой и @${subject}`,
    `${numberHelper.randomInteger(0, 100)}% - это уровень любви между тобой и @${subject}`,
    `${numberHelper.randomInteger(0, 100)}% - это уровень любви между тобой и @${subject}`,
    `${numberHelper.randomInteger(0, 100)}% - это уровень любви между тобой и @${subject}`,
    `${numberHelper.randomInteger(0, 100)}% - это уровень любви между тобой и @${subject}`,
  ];

  return arrayHelper.getRandomArrayElement(list);
}

const getSubjectFromMessage = (message) => {
  let words = message.split(' ');
  words.shift(); // remove first word because it's command name
  words.filter(item => item !== ' '); // remove all spaces

  return words.join(' ');
}

module.exports = obLoveCommand;
