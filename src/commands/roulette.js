async function onRouletteCommand(channel, tags) {
  let isAlive = Math.random() >= 0.5;

  // broadcaster can't be banned
  if (typeof tags.badges.broadcaster !== 'undefined' && tags.badges.broadcaster) {
    isAlive = true;
  }

  const result = [
    `/me @${tags.username} прикладывает револьвер к голове и взводит курок...`,
  ];

  if (isAlive) {
    result.push(`/me @${tags.username} нажимает на курок. И... Выживает!`);
  } else {
    result.push(`/me @${tags.username} нажимает на курок. И... Погибает!`);
    result.push(`/timeout @${tags.username} 30s`);
  }

  return result;
}

module.exports = onRouletteCommand;
