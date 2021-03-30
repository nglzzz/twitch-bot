const arrayHelper = require('../helpers/arrayHelper');

async function onNicknameCommand(channel, tags) {
  const first = [
    'super',
    'krutoy',
    'amazing',
    'tupoy',
    'hot',
    'fast',
    'slow',
    'forever',
    'sasniy',
    'odinokiy',
    'russkiy',
    'last',
    'blue',
    'goluboy',
    'dolgiy',
    'cum',
    'devel',
    'popka',
    'malenkiy',
    'Zero',
    'analniy',
    'navalniy',
    'Sad',
    'Yobani',
    'YoBa',
    'Russish',
  ];
  const second = [
    '_nagibator',
    'Krasava',
    'Harry',
    'Skorostrel',
    'KachOk',
    'Tormoz',
    'Zopoglist',
    'Botan',
    'Perec',
    'Pussy',
    'Pup0k',
    'Chlen',
    '4iter',
    '_Gnom',
    'Maddyson',
    'OmNomNom',
    'Drindulet',
    '_doldon_',
    'chUdOch0k',
    'govnuKkk',
    'deBIk',
    'Cum',
    'Shooter',
    '_leprikon__',
    'Anal',
    'Rubin',
    'Gamer',
    'Gepatid',
    'Ever',
    'Delux',
    'Yoba',
    'Boy',
    'Girl',
    'Baby',
    'Slaver',
  ];
  const last = [
    '007',
    '2010',
    '2008',
    '',
    '',
    '',
    '',
    'YA',
    '228',
  ];

  return 'Новый никнейм для @' + tags.username + ' ' +
    arrayHelper.getRandomArrayElement(first) +
    arrayHelper.getRandomArrayElement(second) +
    arrayHelper.getRandomArrayElement(last);
}

module.exports = onNicknameCommand;
