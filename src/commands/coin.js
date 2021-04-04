const messageHelper = require('../helpers/messageHelper');

async function onCoinCommand(channel, tags, message) {
  const subject = messageHelper.getSubjectFromMessage(message).toLowerCase().replace('ё', 'е');

  const isTailOfCoin = Math.random() >= 0.5;
  const resultName = isTailOfCoin ? 'решка' : 'орёл';

  if (subject === 'решка' && isTailOfCoin || 'орел' === subject && !isTailOfCoin) {
    return `Великая рука правосудия подбрасывает монету. Мои поздравления, @${tags.username}, это ${resultName}! `;
  }

  return `Великая рука правосудия подбрасывает монету. Выпало: ${resultName}`;
}

module.exports = onCoinCommand;
