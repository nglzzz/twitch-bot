'use strict';

// Курсы ЦБ РФ к рублю для пересчёта донатов в других валютах.
// Курс кешируется в памяти; если источник недоступен, используется последний
// удачный ответ, а без него — null (тогда суммы показываются без пересчёта).

const axios = require('axios');

const RATES_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;
// Стейблкоины считаем по курсу доллара.
const ALIASES = { USDT: 'USD', USDC: 'USD' };

let cache = null; // { rates, date, fetchedAt }
let lastErrorAt = 0;
let pending = null;

function parseRates(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const rates = { RUB: 1 };
  for (const [code, item] of Object.entries(data?.Valute || {})) {
    const value = Number(item?.Value);
    const nominal = Number(item?.Nominal) || 1;
    if (Number.isFinite(value) && value > 0) rates[code] = value / nominal;
  }
  for (const [alias, code] of Object.entries(ALIASES)) {
    if (rates[code]) rates[alias] = rates[code];
  }
  if (!rates.USD) throw new Error('В ответе ЦБ нет курса доллара');
  return { rates, date: data.Date ? Date.parse(data.Date) : Date.now() };
}

async function getRubRates({ now = Date.now(), http = axios } = {}) {
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (lastErrorAt && now - lastErrorAt < RETRY_AFTER_ERROR_MS) return cache;
  if (!pending) {
    pending = http.get(RATES_URL, { timeout: REQUEST_TIMEOUT_MS, responseType: 'text', transformResponse: (body) => body })
      .then((response) => {
        cache = { ...parseRates(response.data), fetchedAt: now };
        return cache;
      })
      .catch((error) => {
        lastErrorAt = now;
        console.warn('[exchangeRates] Не удалось получить курс ЦБ:', error.message);
        return cache;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

function toRub(amount, currency, rates) {
  const rate = rates?.[String(currency || 'RUB').toUpperCase()];
  return rate ? amount * rate : null;
}

function resetCache() {
  cache = null;
  lastErrorAt = 0;
  pending = null;
}

module.exports = { getRubRates, toRub, parseRates, resetCache };
