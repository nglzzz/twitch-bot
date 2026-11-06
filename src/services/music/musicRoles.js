'use strict';

const { ROLES } = require('./musicSettings.service');

function badges(tags) {
  return (tags && tags.badges) || {};
}

const checks = {
  broadcaster: (tags) => Boolean(badges(tags).broadcaster) || Boolean(tags?.streamer),
  lead_moderator: (tags) => Boolean(badges(tags).lead_moderator),
  moderator: (tags) => Boolean(tags?.mod) || Boolean(badges(tags).moderator),
  vip: (tags) => Boolean(tags?.vip) || Boolean(badges(tags).vip),
  subscriber: (tags) => Boolean(tags?.subscriber) || Boolean(badges(tags).subscriber) || Boolean(badges(tags).founder),
};

/** Самая высокая роль, которую можно определить по тегам IRC (без фоллоу). */
function roleFromTags(tags) {
  for (const role of ['broadcaster', 'lead_moderator', 'moderator', 'vip', 'subscriber']) {
    if (checks[role](tags)) return role;
  }
  return 'everyone';
}

function roleRank(role) {
  const index = ROLES.indexOf(role);
  return index < 0 ? 0 : index;
}

/**
 * Проверка «от роли»: роль пользователя не ниже minRole.
 * Фоллоу проверяется через Twitch API только если без него не хватает прав.
 */
async function hasRoleAtLeast(tags, minRole, isFollower) {
  const role = roleFromTags(tags);
  if (roleRank(role) >= roleRank(minRole)) return true;
  if (minRole === 'follower' && typeof isFollower === 'function') {
    try { return Boolean(await isFollower(tags)); } catch (_) { return false; }
  }
  return false;
}

/** Проверка по набору ролей: пользователь должен входить хотя бы в одну. Стример может всегда. */
async function matchesAnyRole(tags, roles, isFollower) {
  if (checks.broadcaster(tags)) return true;
  const list = Array.isArray(roles) ? roles : [];
  if (list.includes('everyone')) return true;
  for (const role of list) {
    if (role !== 'follower' && checks[role] && checks[role](tags)) return true;
  }
  if (list.includes('follower') && typeof isFollower === 'function') {
    try { return Boolean(await isFollower(tags)); } catch (_) { return false; }
  }
  return false;
}

module.exports = { roleFromTags, roleRank, hasRoleAtLeast, matchesAnyRole };
