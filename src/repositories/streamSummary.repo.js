'use strict';

const { stmt } = require('./base');

/** Самые активные в чате с момента since (epoch-ms). */
function topChattersSince(since, limit = 20) {
  return stmt(
    `SELECT user, MAX(display_name) AS display_name, COUNT(*) AS messages
     FROM chat_log WHERE created_at >= ?
     GROUP BY user ORDER BY messages DESC, MAX(created_at) DESC LIMIT ?`
  ).all(since, limit).map((row) => ({ login: row.user, name: row.display_name || row.user, messages: row.messages }));
}

function chatTotalsSince(since) {
  const row = stmt('SELECT COUNT(*) AS messages, COUNT(DISTINCT user) AS chatters FROM chat_log WHERE created_at >= ?').get(since);
  return { messages: row.messages || 0, chatters: row.chatters || 0 };
}

function followersSince(since, limit = 40) {
  return stmt(
    `SELECT username, display_name FROM community_user
     WHERE current_followed_at >= ? ORDER BY current_followed_at ASC LIMIT ?`
  ).all(since, limit).map((row) => ({ login: row.username, name: row.display_name || row.username }));
}

function subscribersSince(since, limit = 40) {
  return stmt(
    `SELECT u.username, u.display_name, s.provider FROM community_paid_subscription s
     JOIN community_user u ON u.user_id = s.user_id
     WHERE s.first_confirmed_at >= ? ORDER BY s.first_confirmed_at ASC LIMIT ?`
  ).all(since, limit).map((row) => ({ login: row.username, name: row.display_name || row.username, provider: row.provider }));
}

/** Только имена донатеров, без сумм. */
function donorsSince(since, limit = 40) {
  return stmt(
    `SELECT donor_name FROM donation
     WHERE is_test = 0 AND created_at >= ? AND TRIM(donor_name) <> ''
     GROUP BY LOWER(donor_name) ORDER BY MIN(created_at) ASC LIMIT ?`
  ).all(since, limit).map((row) => ({ name: row.donor_name }));
}

/**
 * Суммы донатов по донатеру и валюте с момента since — для «Доски почёта».
 * Без тестовых, запланированных и «якорных» USDT-записей (skipped).
 */
function donationTotalsSince(since) {
  return stmt(
    `SELECT MIN(donor_name) AS donor_name, UPPER(currency) AS currency, SUM(amount) AS amount, MAX(created_at) AS last_at
     FROM donation
     WHERE is_test = 0 AND source <> 'scheduled' AND status IN ('sent', 'failed', 'pending')
       AND created_at >= ? AND TRIM(donor_name) <> ''
     GROUP BY LOWER(TRIM(donor_name)), UPPER(currency)`
  ).all(since).map((row) => ({ name: row.donor_name.trim(), currency: row.currency, amount: row.amount, lastAt: row.last_at }));
}

module.exports = {
  donationTotalsSince,
  topChattersSince,
  chatTotalsSince,
  followersSince,
  subscribersSince,
  donorsSince,
};
