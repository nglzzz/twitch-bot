const numberHelper = require('../helpers/numberHelper');
const messageHelper = require('../helpers/messageHelper');

async function onLotteryCommand(channel, tags, message) {
  const valueForWin = 69;
  const userCustomValue = message;
  const username = tags.username;

  const result = [
    `/me @${username} участвует в лотерее с числом "${userCustomValue}", но надеется на "${valueForWin}". Бот генерирует рандомное число...`,
  ];

  const generatedValue = numberHelper.randomInteger(1, 100);

  if (generatedValue === valueForWin) {
    result.push(`/me @${username} невероятно везёт! Он выигрывает в лотерее! Выпавшее число ${generatedValue}`);
  } else {
    if (generatedValue == userCustomValue) {
      result.push(`/me @${username} угадал число! Это заслуживает уважения и денежного поощрения! Выпавшее число ${generatedValue}`);
    } else {
      result.push(`/me @${username}, к сожалению, выпало число  ${generatedValue}. Повезёт в другой раз!`);
    }
  }

  return result;
}

module.exports = onLotteryCommand;
