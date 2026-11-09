/**
 * Итоги текущего эфира для титров на сцене окончания стрима.
 * Если эфир не идёт (проверка офлайн), берутся последние 6 часов.
 */
const FALLBACK_WINDOW_MS = 6 * 60 * 60 * 1000;
const CACHE_MS = 30 * 1000;

function createStreamSummaryService({
  repo,
  getActiveSession,
  isDbReady,
  botLogins = [],
  now = () => Date.now(),
} = {}) {
  const bots = new Set(botLogins.map((login) => String(login).replace(/^#/, '').toLowerCase()));
  let cache = null;

  async function getSummary() {
    if (cache && now() - cache.at < CACHE_MS) return cache.summary;
    if (!isDbReady()) return null;

    const session = await getActiveSession().catch(() => null);
    const since = session && Number(session.startedAt) ? Number(session.startedAt) : now() - FALLBACK_WINDOW_MS;
    const notBot = (entry) => !bots.has(String(entry.login || '').toLowerCase());

    const summary = {
      since,
      live: Boolean(session),
      title: session ? session.title || null : null,
      totals: repo.chatTotalsSince(since),
      topChatters: repo.topChattersSince(since, 20).filter(notBot).slice(0, 10),
      followers: repo.followersSince(since),
      subscribers: repo.subscribersSince(since),
      donors: repo.donorsSince(since),
    };
    cache = { at: now(), summary };
    return summary;
  }

  return { getSummary };
}

let defaultService = null;
function getStreamSummaryService() {
  if (defaultService) return defaultService;
  const config = require('../config');
  const { getBotList } = require('../helpers/arrayHelper');
  defaultService = createStreamSummaryService({
    repo: require('../repositories/streamSummary.repo'),
    getActiveSession: () => require('./streamTracker.service').getActiveSession(),
    isDbReady: () => require('../app/db').isDbReady(),
    botLogins: [...getBotList(), config.BOT_NAME, config.CHANNEL].filter(Boolean),
  });
  return defaultService;
}

module.exports = { createStreamSummaryService, getStreamSummaryService };
