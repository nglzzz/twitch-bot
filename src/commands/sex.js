const arrayHelper = require('../helpers/arrayHelper');
const getChannelViewers = require('../twitchApi/viewers');
const { getChatters } = require('../chat/chatters');
const messageHelper = require('../helpers/messageHelper');

async function onSexCommand(channel, tags, message) {
  const viewers = await getChannelViewers();

  let subject = messageHelper.getSubjectFromMessage(message);

  if (subject.length === 0) {
    subject = viewers.length > 0
      ? arrayHelper.getRandomArrayElement(viewers)
      : arrayHelper.getRandomArrayElement(getChatters());
  }

  const list = [
    `занимается нежным сексом с @${subject}`,
    `и @${subject} имеют секс по симпатии`,
    `занимается с @${subject} сексом`,
    `принуждает @${subject} к сексу`,
    `и @${subject} занимаюся сексом-пятиминутком`,
    `побыстрому кончает в @${subject} и уходит по своим делам`,
    `и @${subject} занимаются анальным сексом`,
    `и @${subject} занимаются грязным сексом`,
    `и @${subject} трахаются и записывают всё на камеру`,
    `и @${subject} занимаются виртуальным сексом`,
    `отдаёт свою сраку @${subject} на растерзание`,
    `хочет минет от @${subject}`,
    `делает минет для @${subject}`,
    `доминирует в сексе над @${subject}`,
  ];
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter} ${arrayHelper.getRandomArrayElement(list)}`;
}

module.exports = onSexCommand;
