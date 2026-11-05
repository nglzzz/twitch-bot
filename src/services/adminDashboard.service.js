'use strict';

const config = require('../config');
const stats = require('../repositories/adminStats.repo');
const contributions = require('../repositories/communityContributions.repo');
const { toRub } = require('./exchangeRates.service');

const { DAY_MS } = stats;
const CHART_DAYS = 14;
const UNLINKED_LIMIT = 100;
const CURRENCY_SIGNS = { RUB: '₽', USD: '$', EUR: '€' };

function timezoneOffsetMs(date = new Date(), timeZone = config.TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((map, part) => ({ ...map, [part.type]: part.value }), {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatMoney(amount, currency) {
  const sign = CURRENCY_SIGNS[currency];
  return sign ? `${formatNumber(amount)} ${sign}` : `${formatNumber(amount)} ${currency}`;
}

function formatDate(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: config.TIMEZONE }).format(new Date(value));
}

function formatDuration(ms) {
  const totalMinutes = Math.round(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} мин`;
  return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`;
}

// Изменение относительно прошлого периода: null, если сравнивать не с чем.
function trend(current, previous) {
  if (!previous) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { label: 'без изменений', direction: 'flat' };
  return { label: `${percent > 0 ? '+' : '−'}${Math.abs(percent)}% к прошлой неделе`, direction: percent > 0 ? 'up' : 'down' };
}

// Итог всегда в рублях: другие валюты (USDT хранится как USD) пересчитываются
// по текущему курсу ЦБ. Без курса они показываются отдельно, без пересчёта.
const MAIN_CURRENCY = 'RUB';

function moneyTotals(rows, rates = null) {
  let totalRub = 0;
  const converted = [];
  const unconverted = [];
  for (const row of rows) {
    const rub = row.currency === MAIN_CURRENCY ? row.amount : toRub(row.amount, row.currency, rates);
    if (rub === null) {
      unconverted.push(formatMoney(row.amount, row.currency));
      continue;
    }
    totalRub += rub;
    if (row.currency !== MAIN_CURRENCY) converted.push(`${formatMoney(row.amount, row.currency)} ≈ ${formatMoney(Math.round(rub), MAIN_CURRENCY)}`);
  }
  const parts = [];
  if (converted.length) parts.push(`в т.ч. ${converted.join(', ')}`);
  if (unconverted.length) parts.push(`+ ${unconverted.join(' · ')} без пересчёта`);
  return {
    primary: formatMoney(Math.round(totalRub), MAIN_CURRENCY),
    extra: parts.join(' · '),
    count: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

function rateNote(rates) {
  if (!rates?.rates?.USD) return '';
  return `Курс ЦБ на ${formatDate(rates.date, { day: 'numeric', month: 'short' })}: 1 $ = ${formatNumber(rates.rates.USD)} ₽`;
}

function buildChatChart(now, offsetMs) {
  const todayIndex = Math.floor((now + offsetMs) / DAY_MS);
  const firstDay = todayIndex - CHART_DAYS + 1;
  const since = firstDay * DAY_MS - offsetMs;
  const byDay = new Map(stats.dailyMessages({ since, offsetMs }).map((row) => [row.day, row.count]));
  const days = Array.from({ length: CHART_DAYS }, (_, index) => {
    const day = firstDay + index;
    return { day, count: byDay.get(day) || 0 };
  });
  const max = Math.max(...days.map((item) => item.count), 1);
  return {
    max: formatNumber(max),
    total: formatNumber(days.reduce((sum, item) => sum + item.count, 0)),
    bars: days.map((item) => {
      const dayStart = item.day * DAY_MS - offsetMs;
      const label = formatDate(dayStart, { day: 'numeric', month: 'short' });
      return {
        height: item.count ? Math.max(4, Math.round((item.count / max) * 100)) : 0,
        countLabel: formatNumber(item.count),
        label,
        shortLabel: formatDate(dayStart, { day: 'numeric' }),
        weekday: formatDate(dayStart, { weekday: 'short' }),
        isToday: item.day === todayIndex,
        isEmpty: item.count === 0,
      };
    }),
  };
}

function buildStream(summary) {
  const session = summary.live || summary.latest;
  if (!session) return null;
  const isLive = Boolean(summary.live);
  const endedAt = session.ended_at || (isLive ? Date.now() : session.last_seen_at);
  return {
    isLive,
    title: session.title || 'Без названия',
    game: session.game_name || '',
    startedAtLabel: formatDate(session.started_at),
    durationLabel: session.started_at && endedAt ? formatDuration(endedAt - session.started_at) : '—',
    maxViewers: formatNumber(session.max_viewers),
    avgViewers: formatNumber(session.avg_viewers),
    messages: formatNumber(session.messages_count),
    chatters: formatNumber(session.unique_chatters),
  };
}

function buildDashboardData(now = Date.now(), { rates = null } = {}) {
  const offsetMs = timezoneOffsetMs(new Date(now));
  const weekAgo = now - 7 * DAY_MS;
  const twoWeeksAgo = now - 14 * DAY_MS;
  const monthAgo = now - 30 * DAY_MS;

  const chatWeek = stats.chatActivity({ since: weekAgo });
  const chatPrevWeek = stats.chatActivity({ since: twoWeeksAgo, until: weekAgo });
  const rubRates = rates?.rates || null;
  const donationsMonth = moneyTotals(stats.donationTotalsByCurrency({ since: monthAgo }), rubRates);
  const donationsAll = moneyTotals(stats.donationTotalsByCurrency(), rubRates);
  const streams = stats.streamSummary({ since: monthAgo });
  const community = stats.communitySummary({ since: weekAgo });
  const unlinked = contributions.listUnassigned({ limit: UNLINKED_LIMIT });
  const unlinkedMemes = unlinked.filter((item) => item.kind === 'meme').length;
  const unlinkedDonations = unlinked.filter((item) => item.kind === 'donation').length;

  return {
    metrics: {
      donationsMonth,
      donationsAll,
      rateNote: rateNote(rates),
      chatMessages: formatNumber(chatWeek.messages),
      chatMessagesTrend: trend(chatWeek.messages, chatPrevWeek.messages),
      chatters: formatNumber(chatWeek.chatters),
      chattersTrend: trend(chatWeek.chatters, chatPrevWeek.chatters),
      communityTotal: formatNumber(community.total),
      communityNew: formatNumber(community.newUsers),
    },
    streamsMonth: {
      count: formatNumber(streams.count),
      peakViewers: formatNumber(streams.peakViewers),
      avgViewers: formatNumber(streams.avgViewers),
      duration: formatDuration(streams.durationMs),
    },
    stream: buildStream(streams),
    chatChart: buildChatChart(now, offsetMs),
    attention: {
      total: unlinked.length,
      totalLabel: unlinked.length >= UNLINKED_LIMIT ? `${UNLINKED_LIMIT}+` : String(unlinked.length),
      memes: unlinkedMemes,
      donations: unlinkedDonations,
    },
    recentDonations: stats.recentRealDonations({ limit: 8 }).map((item) => ({
      ...item,
      amountLabel: formatMoney(item.amount, item.currency),
      createdAtLabel: formatDate(item.createdAt),
    })),
    topDonors: stats.topDonors({ since: monthAgo, limit: 5 }).map((item) => ({
      ...item,
      amountLabel: formatMoney(item.amount, item.currency),
    })),
    topChatters: stats.topChatters({ since: weekAgo, limit: 5 }).map((item) => ({
      ...item,
      messagesLabel: formatNumber(item.messages),
    })),
  };
}

module.exports = { buildDashboardData, timezoneOffsetMs, formatMoney };
