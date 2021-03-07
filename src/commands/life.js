const arrayHelper = require('../helpers/arrayHelper');

async function onLifeCommand(channel, tags) {
  const firstName = [
    'Убийца',
    'Любитель',
    'Гроза',
    'Повелитель',
    'Создатель',
    'Адепт',
    'Вождь',
    'Владыка',
  ];
  const middleName = [
    'Консольных',
    'Больших',
    'Толстых',
    'Сладких',
    'Анальных',
    'Красных',
    'Наших',
    'Маленьких',
    'Стальных',
    'Диванных',
  ];
  const lastName = [
    'Школьников',
    'Сисек',
    'Жоп',
    'Тёлок',
    'Игр',
    'Драконов',
    'Распродаж',
    'Вагин',
    'Надежд',
    'Сердец',
    'Овец',
    'Доек',
    'Сил',
    'Стримов',
    'Членов',
  ];

  return `@${tags.username}
     ${arrayHelper.getRandomArrayElement(firstName)}
     ${arrayHelper.getRandomArrayElement(middleName)}
     ${arrayHelper.getRandomArrayElement(lastName)}`;
}

module.exports = onLifeCommand;
