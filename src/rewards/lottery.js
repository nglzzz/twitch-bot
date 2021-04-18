const numberHelper = require('../helpers/numberHelper');
const messageHelper = require('../helpers/messageHelper');

async function onLotteryCommand(channel, tags, message) {
  const valueForWin = 69;
  const userCustomValue = message;

  const result = [
    `/me @${tags.username} участвует в лотерее с числом "${userCustomValue}", но надеется на "${valueForWin}". Бот генерирует рандомное число...`,
  ];

  const generatedValue = numberHelper.randomInteger(1, 100);

  if (generatedValue === valueForWin) {
    result.push(`/me @${tags.username} невероятно везёт! Он выигрывает в лотерее! Выпавшее число ${generatedValue}`);
  } else {
    if (generatedValue == userCustomValue) {
      result.push(`/me @${tags.username} угадал число! Это заслуживает уважения и денежного поощрения! Выпавшее число ${generatedValue}`);
    } else {
      result.push(`/me К сожалению, выпало число  ${generatedValue}. Повезёт в другой раз!`);
    }
  }

  return result;
}

module.exports = onLotteryCommand;
