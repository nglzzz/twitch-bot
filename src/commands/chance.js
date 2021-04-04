const numberHelper = require('../helpers/numberHelper');
const messageHelper = require('../helpers/messageHelper');

async function onChanceCommand(channel, tags, message) {
  const subject = messageHelper.getSubjectFromMessage(message);

  if (subject.length === 0) {
    return 'Я обязательно расскажу шанс чего либо. Но я должен знать чего. Используй !шанс <событие>';
  }

  const chancePercentage = numberHelper.randomInteger(0, 100);

  return `Шанс "${subject}" составляет ${chancePercentage}%`;
}

module.exports = onChanceCommand;
