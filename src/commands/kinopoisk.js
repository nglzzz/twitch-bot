async function onKinopoiskCommand(channel, tags) {
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter}, Профиль на кинопоиске - https://www.kinopoisk.ru/user/18637910/`;
}

module.exports = onKinopoiskCommand;
