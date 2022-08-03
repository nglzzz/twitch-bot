async function onRouletteCommand(channel, tags) {
  let isAlive = Math.random() >= 0.5;
  const chatter = tags['display-name'] ?? tags.username;

  // broadcaster can't be banned
  if (typeof tags.badges.broadcaster !== 'undefined' && tags.badges.broadcaster) {
    isAlive = true;
  }

  const result = [
    `/me @${chatter} прикладывает револьвер к голове и взводит курок...`,
  ];

  if (isAlive) {
    result.push(`/me @${chatter} нажимает на курок. И... Выживает!`);
  } else {
    result.push(`/me @${chatter} нажимает на курок. И... Погибает!`);
    result.push(`/timeout @${chatter} 30s`);
  }

  return result;
}

module.exports = onRouletteCommand;
