const messageHelper = require('../helpers/messageHelper');

// Ссылка на профиль зрителя на сайте (сообщения, достижения, вклад). «!профиль @ник» — чужой профиль.
function siteUrl() {
  return require('../services/music').getPublicBase() || 'https://nglzzz.xyz';
}

async function onProfileCommand(channel, tags, message) {
  const chatter = tags['display-name'] ?? tags.username;
  const asked = messageHelper.getSubjectFromMessage(String(message || '')).split(/\s+/)[0].toLowerCase();
  const login = /^[a-z0-9_]{1,25}$/.test(asked) ? asked : String(tags.username || '').toLowerCase();
  if (!login) return '';
  const url = `${siteUrl()}/users/${login}`;
  return login === String(tags.username || '').toLowerCase()
    ? `@${chatter}, твой профиль и достижения: ${url}`
    : `@${chatter}, профиль ${login}: ${url}`;
}

module.exports = onProfileCommand;
