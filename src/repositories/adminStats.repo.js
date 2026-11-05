'use strict';

// Агрегаты для главной страницы админки. Учитываются только реальные донаты
// (is_test = 0): тестовые и запланированные не должны попадать в статистику.

const { stmt } = require('./base');

const DAY_MS = 24 * 60 * 60 * 1000;

function donationTotalsByCurrency({ since = null } = {}) {
  const rows = stmt(`SELECT currency, COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s
      FROM donation
      WHERE is_test = 0 AND amount > 0 AND status <> 'failed' AND created_at >= ?
      GROUP BY currency ORDER BY s DESC`).all(since ?? 0);
  return rows.map((row) => ({ currency: row.currency || 'RUB', count: Number(row.c) || 0, amount: Number(row.s) || 0 }));
}

function recentRealDonations({ limit = 8 } = {}) {
  return stmt(`SELECT id, donor_name, amount, currency, message, source, created_at
      FROM donation
      WHERE is_test = 0 AND amount > 0 AND status <> 'failed'
      ORDER BY created_at DESC LIMIT ?`).all(limit)
    .map((row) => ({
      id: row.id,
      donorName: row.source === 'usdt-trc20' ? 'USDT поддержка' : row.donor_name,
      amount: Number(row.amount) || 0,
      currency: row.currency || 'RUB',
      message: row.message || '',
      createdAt: Number(row.created_at),
    }));
}

function topDonors({ since = 0, limit = 5 } = {}) {
  return stmt(`SELECT donor_name, currency, COUNT(*) AS c, SUM(amount) AS s
      FROM donation
      WHERE is_test = 0 AND amount > 0 AND status <> 'failed' AND source <> 'usdt-trc20' AND created_at >= ?
      GROUP BY donor_name, currency ORDER BY s DESC LIMIT ?`).all(since, limit)
    .map((row) => ({ donorName: row.donor_name, currency: row.currency || 'RUB', count: Number(row.c) || 0, amount: Number(row.s) || 0 }));
}

function chatActivity({ since, until = null }) {
  const row = until === null
    ? stmt('SELECT COUNT(*) AS c, COUNT(DISTINCT lower(user)) AS u FROM chat_log WHERE created_at >= ?').get(since)
    : stmt('SELECT COUNT(*) AS c, COUNT(DISTINCT lower(user)) AS u FROM chat_log WHERE created_at >= ? AND created_at < ?').get(since, until);
  return { messages: Number(row.c) || 0, chatters: Number(row.u) || 0 };
}

/**
 * Сообщения чата по дням. offsetMs — смещение часового пояса от UTC,
 * чтобы границы суток совпадали с локальными.
 */
function dailyMessages({ since, offsetMs = 0 }) {
  return stmt(`SELECT CAST((created_at + ?) / ${DAY_MS} AS INTEGER) AS day, COUNT(*) AS c
      FROM chat_log WHERE created_at >= ? GROUP BY day ORDER BY day`).all(offsetMs, since)
    .map((row) => ({ day: Number(row.day), count: Number(row.c) || 0 }));
}

function topChatters({ since, limit = 5 }) {
  return stmt(`SELECT lower(user) AS login, MAX(display_name) AS display_name, COUNT(*) AS c
      FROM chat_log WHERE created_at >= ?
      GROUP BY lower(user) ORDER BY c DESC LIMIT ?`).all(since, limit)
    .map((row) => ({ login: row.login, displayName: row.display_name || row.login, messages: Number(row.c) || 0 }));
}

function streamSummary({ since }) {
  const live = stmt("SELECT * FROM stream_session WHERE status = 'live' ORDER BY started_at DESC LIMIT 1").get() || null;
  const latest = stmt('SELECT * FROM stream_session ORDER BY started_at DESC LIMIT 1').get() || null;
  const period = stmt(`SELECT COUNT(*) AS c, COALESCE(MAX(max_viewers), 0) AS peak,
      COALESCE(ROUND(AVG(NULLIF(avg_viewers, 0))), 0) AS avg,
      COALESCE(SUM(CASE WHEN ended_at IS NOT NULL AND started_at IS NOT NULL THEN ended_at - started_at ELSE 0 END), 0) AS duration
      FROM stream_session WHERE started_at >= ?`).get(since);
  return {
    live,
    latest,
    count: Number(period.c) || 0,
    peakViewers: Number(period.peak) || 0,
    avgViewers: Number(period.avg) || 0,
    durationMs: Number(period.duration) || 0,
  };
}

function communitySummary({ since }) {
  const row = stmt(`SELECT
      (SELECT COUNT(*) FROM community_user) AS total,
      (SELECT COUNT(*) FROM community_user WHERE first_seen_at >= ?) AS fresh`).get(since);
  return { total: Number(row.total) || 0, newUsers: Number(row.fresh) || 0 };
}

module.exports = {
  DAY_MS,
  donationTotalsByCurrency,
  recentRealDonations,
  topDonors,
  chatActivity,
  dailyMessages,
  topChatters,
  streamSummary,
  communitySummary,
};
