const arrayHelper = require('../helpers/arrayHelper');
const getChannelViewers = require('../twitchApi/viewers');
const { getLatestChatters } = require('../chat/chatters');
const messageHelper = require('../helpers/messageHelper');

async function onCourtCommand(channel, tags, message) {
  const viewers = await getChannelViewers();
  const chatter = tags['display-name'] ?? tags.username;

  let subject = messageHelper.getSubjectFromMessage(message);

  if (subject.length === 0) {
    const candidates = [
      ...new Set([
        ...arrayHelper.removeBotsFromList(viewers),
        ...arrayHelper.removeBotsFromList(getLatestChatters()),
      ]),
    ].filter((nickname) => nickname.toLowerCase() !== chatter.toLowerCase());

    subject = candidates.length > 0
      ? arrayHelper.getRandomArrayElement(candidates)
      : chatter;
  }

  const crimes = [
    'в нелегальном хранении 48 баянов',
    'в контрабанде кринжа в особо крупных масштабах',
    'в злоупотреблении фразой "ща последняя катка"',
    'в организации подпольного цеха по производству мемов из 2013-го',
    'в попытке подкупить суд чата шаурмой',
    'в токсичном хихиканье без лицензии',
    'в злостном спаме аурой главного героя',
    'в сокрытии последней вкусной пельмешки от общества',
    'в умышленном раскачивании лодки вайба',
    'в подделке искреннего "лол кек" при свидетелях',
  ];

  const punishments = [
    '40 минутами просмотра рекламы без кнопки "Пропустить"',
    'принудительной пересдачей экзамена по мемологии',
    'общественными работами в отделе сортировки баянов',
    'неделей доедания холодных пельменей без соуса',
    '12 часами прослушивания жевания в микрофон',
    'конфискацией тапок и хождением по LEGO',
    'пожизненным объяснением, что он "не токсик, а эмоциональный"',
    'арестом на складе просроченных анекдотов',
    'исправительными работами на заводе по надуванию ЧСВ',
    'тремя кругами позора под оркестровую версию Windows XP',
  ];

  const endings = [
    'Обжалованию не подлежит.',
    'Чат орёт, приставы уже в пути.',
    'Протокол составлен на салфетке и заверен пельменем.',
    'Молоток судьи заменён тапком, заседание окончено.',
    'Секретарь суда рыдает, но полностью согласен.',
  ];

  return `@${chatter} созывает суд: @${subject} признан виновным ${arrayHelper.getRandomArrayElement(crimes)} и приговаривается к ${arrayHelper.getRandomArrayElement(punishments)}. ${arrayHelper.getRandomArrayElement(endings)}`;
}

module.exports = onCourtCommand;
