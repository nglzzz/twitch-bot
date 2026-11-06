'use strict';

function formatDuration(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Сколько секунд реально будет играть заявка. */
function effectiveDuration(request) {
  if (!request) return 0;
  const full = Math.max(0, (Number(request.durationSec) || 0) - (Number(request.startSec) || 0));
  const limit = Number(request.playLimitSec);
  return Number.isFinite(limit) && limit > 0 ? Math.min(full || limit, limit) : full;
}

/** Данные заявки для публичных страниц, оверлея и дока (без сумм доната). */
function publicRequest(request) {
  if (!request) return null;
  const startSec = Number(request.startSec) || 0;
  const playSec = effectiveDuration(request);
  return {
    id: request._id,
    provider: request.provider,
    externalId: request.externalId,
    title: request.title,
    author: request.author || '',
    url: request.url || '',
    thumbnail: request.thumbnail || '',
    durationSec: Number(request.durationSec) || 0,
    startSec,
    endSec: playSec > 0 ? startSec + playSec : null,
    playSec,
    playLabel: formatDuration(playSec),
    isLimited: Boolean(request.playLimitSec) && playSec < Math.max(0, (Number(request.durationSec) || 0) - startSec),
    requestedBy: request.requestedByDisplay || request.requestedBy,
    requestedByLogin: request.requestedBy,
    source: request.source,
    isPaid: Boolean(request.isPaid),
    isBackup: request.source === 'backup',
    createdAt: request.createdAt,
  };
}

/** Расширенные данные для админки. */
function adminRequest(request) {
  if (!request) return null;
  return {
    ...publicRequest(request),
    amount: request.amount,
    currency: request.currency,
    amountRub: request.amountRub,
    amountLabel: request.amount ? `${request.amount} ${request.currency || 'RUB'}` : '',
    status: request.status,
    statusReason: request.statusReason || '',
    startedAt: request.startedAt,
    finishedAt: request.finishedAt,
  };
}

module.exports = { formatDuration, effectiveDuration, publicRequest, adminRequest };
