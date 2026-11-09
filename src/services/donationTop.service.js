/**
 * Лучший донатер дня и месяца (по сумме, в рублях) для «Доски почёта» на сцене с вебкой.
 * Границы дня и месяца — по местному времени процесса (TZ контейнера).
 */
const CACHE_MS = 15 * 1000;

function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfMonth(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Строки «донатер + валюта + сумма» → лучший донатер с суммой в рублях. Без курса валюта не считается. */
function pickLeader(rows, rates) {
  const byName = new Map();
  for (const row of rows) {
    const currency = String(row.currency || 'RUB').toUpperCase();
    const rate = currency === 'RUB' ? 1 : rates?.[currency];
    if (!rate) continue;
    const key = row.name.toLowerCase();
    const entry = byName.get(key) || { name: row.name, amount: 0, lastAt: 0 };
    entry.amount += row.amount * rate;
    entry.lastAt = Math.max(entry.lastAt, row.lastAt);
    byName.set(key, entry);
  }
  let best = null;
  for (const entry of byName.values()) {
    if (!best || entry.amount > best.amount || (entry.amount === best.amount && entry.lastAt > best.lastAt)) best = entry;
  }
  return best ? { name: best.name, amount: Math.round(best.amount) } : null;
}

function createDonationTopService({ repo, getRates, isDbReady, now = () => Date.now() } = {}) {
  let cache = null;

  async function getTop() {
    if (cache && now() - cache.at < CACHE_MS) return cache.top;
    if (!isDbReady()) return null;
    const at = now();
    const monthRows = repo.donationTotalsSince(startOfMonth(at));
    const dayRows = repo.donationTotalsSince(startOfDay(at));
    const needsRates = monthRows.some((row) => String(row.currency).toUpperCase() !== 'RUB');
    const rates = needsRates ? ((await getRates().catch(() => null)) || {}).rates : null;
    const top = { day: pickLeader(dayRows, rates), month: pickLeader(monthRows, rates) };
    cache = { at, top };
    return top;
  }

  return { getTop };
}

let defaultService = null;
function getDonationTopService() {
  if (defaultService) return defaultService;
  defaultService = createDonationTopService({
    repo: require('../repositories/streamSummary.repo'),
    getRates: () => require('./exchangeRates.service').getRubRates(),
    isDbReady: () => require('../app/db').isDbReady(),
  });
  return defaultService;
}

module.exports = { createDonationTopService, getDonationTopService, pickLeader, startOfDay, startOfMonth };
