'use strict';

const { formatDuration } = require('../music/musicFormat');

const PROVIDER_LABELS = { youtube: 'YouTube', tiktok: 'TikTok', twitch: 'Twitch', vimeo: 'Vimeo', streamable: 'Streamable' };
const KIND_LABELS = { video: 'Видео', short: 'Shorts', tiktok: 'TikTok', clip: 'Клип', vod: 'Запись' };

/** Полная длина от точки старта; null — длительность пока неизвестна (TikTok до запуска). */
function fullDuration(request) {
  const duration = Number(request?.durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, duration - (Number(request.startSec) || 0));
}

/** Сколько секунд будет играть заявка (null — до конца ролика, длина неизвестна). */
function effectiveDuration(request) {
  if (!request) return null;
  const full = fullDuration(request);
  const limit = Number(request.playLimitSec);
  if (Number.isFinite(limit) && limit > 0) return full === null ? limit : Math.min(full, limit);
  return full;
}

const CURRENCY_SIGNS = { RUB: '₽', USD: '$', EUR: '€', UAH: '₴', KZT: '₸', BYN: 'Br' };

function moneyLabel(amount, currency) {
  const code = String(currency || 'RUB').toUpperCase();
  const value = Math.round(Number(amount) * 100) / 100;
  return `${value.toLocaleString('ru-RU')} ${CURRENCY_SIGNS[code] || code}`;
}

function coRequesters(request) {
  return (Array.isArray(request?.coRequesters) ? request.coRequesters : []).map((item) => item.display || item.login).filter(Boolean);
}

/** Данные заявки для страниц и плеера. Суммы донатов — только в админском варианте. */
function publicRequest(request) {
  if (!request) return null;
  const startSec = Number(request.startSec) || 0;
  const playSec = effectiveDuration(request);
  const full = fullDuration(request);
  return {
    id: request._id,
    provider: request.provider,
    providerLabel: PROVIDER_LABELS[request.provider] || request.provider,
    kind: request.kind,
    kindLabel: KIND_LABELS[request.kind] || 'Видео',
    externalId: request.externalId,
    title: request.title,
    author: request.author || '',
    url: request.url || '',
    thumbnail: request.thumbnail || '',
    durationSec: Number(request.durationSec) || null,
    startSec,
    endSec: playSec ? startSec + playSec : null,
    playSec,
    playLabel: playSec ? formatDuration(playSec) : '',
    isLimited: Boolean(request.playLimitSec) && (full === null || playSec < full),
    isVertical: Boolean(request.isVertical),
    requestedBy: request.requestedByDisplay || request.requestedBy,
    requestedByLogin: request.requestedBy,
    coRequesters: coRequesters(request),
    source: request.source,
    isPaid: Boolean(request.isPaid),
    // Суммы донатов и так видны на стриме в алертах.
    amountLabel: request.isPaid && request.amount ? moneyLabel(request.amount, request.currency) : '',
    createdAt: request.createdAt,
  };
}

function adminRequest(request) {
  if (!request) return null;
  return {
    ...publicRequest(request),
    amount: request.amount,
    currency: request.currency,
    amountRub: request.amountRub,
    viewCount: request.viewCount ?? null,
    status: request.status,
    statusReason: request.statusReason || '',
    votesSkip: request.votesSkip ?? null,
    votesKeep: request.votesKeep ?? null,
    startedAt: request.startedAt,
    finishedAt: request.finishedAt,
  };
}

module.exports = { PROVIDER_LABELS, KIND_LABELS, formatDuration, fullDuration, effectiveDuration, publicRequest, adminRequest };
