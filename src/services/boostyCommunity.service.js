'use strict';

const BoostyClient = require('../utils/Boosty/BoostyClient');
const { getBoostyToken } = require('./token.service');
const paidSubscriptions = require('../repositories/communityPaidSubscriptions.repo');
const communityRepo = require('../repositories/community.repo');

function normalizeSubscriberId(value) {
  const id = String(value ?? '').trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : null;
}

function normalizeTwitchLogin(value) {
  const login = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(login) ? login : null;
}

function createBoostyCommunityService({
  tokenProvider = getBoostyToken,
  clientFactory = (token) => new BoostyClient(token),
  repository = paidSubscriptions,
  community = communityRepo,
  now = Date.now,
} = {}) {
  async function getSubscriberRecords() {
    const token = await tokenProvider();
    if (!token) throw new Error('Не настроен токен Boosty.');

    try {
      return await clientFactory(token).getSubscriberRecords(1000, { requireComplete: true });
    } catch (_) {
      throw new Error('Не удалось получить полный список подписчиков Boosty. Проверьте токен API и повторите попытку.');
    }
  }

  function activePaidSubscribers(subscribers) {
    return subscribers
    .filter((subscriber) => subscriber && subscriber.id !== undefined && subscriber.id !== null
      && Number(subscriber.price) > 0 && subscriber.subscribed === true)
    .map((subscriber) => ({
      id: normalizeSubscriberId(subscriber.id),
      name: String(subscriber.name || 'Участник Boosty').slice(0, 100),
    }))
    .filter((subscriber) => subscriber.id)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }

  async function getActiveSubscribers() {
    return activePaidSubscribers(await getSubscriberRecords());
  }

  async function getAvailableActiveSubscribers() {
    const activeSubscribers = await getActiveSubscribers();
    if (typeof repository.listBoostyMappings !== 'function') return activeSubscribers;
    const linkedIds = new Set(repository.listBoostyMappings()
      .map((mapping) => String(mapping.externalSubscriberId || ''))
      .filter(Boolean));
    return activeSubscribers.filter((subscriber) => !linkedIds.has(subscriber.id));
  }

  async function linkActiveSubscriber({ userId, username, displayName, subscriberId, adminId, confirmedAt = Date.now() } = {}) {
    const normalizedSubscriberId = normalizeSubscriberId(subscriberId);
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedSubscriberId || !normalizedUserId || !String(adminId || '').trim()) {
      throw new Error('Укажите участника Twitch и активную подписку Boosty.');
    }

    const activeSubscribers = await getActiveSubscribers();
    const subscriber = activeSubscribers.find((item) => item.id === normalizedSubscriberId);
    if (!subscriber) throw new Error('Эта подписка Boosty не найдена среди активных платных подписок.');

    return repository.recordBoostySubscription({
      userId: normalizedUserId,
      username,
      displayName,
      externalSubscriberId: subscriber.id,
      confirmedBy: String(adminId),
      confirmedAt,
    });
  }

  async function syncMatchingSubscribers({ confirmedAt = now() } = {}) {
    const records = await getSubscriberRecords();
    const recordsByLogin = new Map();
    for (const record of records) {
      const login = normalizeTwitchLogin(record && record.name);
      if (!login) continue;
      if (!recordsByLogin.has(login)) recordsByLogin.set(login, []);
      recordsByLogin.get(login).push(record);
    }

    const mappings = typeof repository.listBoostyMappings === 'function'
      ? repository.listBoostyMappings()
      : [];
    const linkedUserIds = new Set(mappings.map((mapping) => String(mapping.userId)));
    const linkedSubscriberIds = new Set(mappings
      .map((mapping) => String(mapping.externalSubscriberId || ''))
      .filter(Boolean));
    const result = { linked: 0, ambiguousBoosty: 0, missingTwitch: 0, alreadyLinked: 0 };

    for (const [login, matches] of recordsByLogin) {
      if (matches.length !== 1) {
        result.ambiguousBoosty += 1;
        continue;
      }
      const [subscriber] = matches;
      if (!(Number(subscriber.price) > 0 && subscriber.subscribed === true)) continue;
      const subscriberId = normalizeSubscriberId(subscriber.id);
      if (!subscriberId || linkedSubscriberIds.has(subscriberId)) {
        result.alreadyLinked += 1;
        continue;
      }

      const identity = typeof community.findUniqueIdentityByLogin === 'function'
        ? community.findUniqueIdentityByLogin(login)
        : null;
      if (!identity || !identity.userId || normalizeTwitchLogin(identity.username) !== login) {
        result.missingTwitch += 1;
        continue;
      }
      const userId = String(identity.userId);
      if (linkedUserIds.has(userId)) {
        result.alreadyLinked += 1;
        continue;
      }

      const inserted = repository.recordAutomaticBoostySubscription({
        userId,
        username: identity.username,
        displayName: identity.displayName || identity.username,
        externalSubscriberId: subscriberId,
        confirmedAt,
      });
      if (inserted) {
        result.linked += 1;
        linkedUserIds.add(userId);
        linkedSubscriberIds.add(subscriberId);
      } else {
        result.alreadyLinked += 1;
      }
    }

    return result;
  }

  return {
    getSubscriberRecords,
    getActiveSubscribers,
    getAvailableActiveSubscribers,
    linkActiveSubscriber,
    syncMatchingSubscribers,
  };
}

function createAutoLinkWorker({
  service = null,
  isDbReady = () => require('../app/db').isDbReady(),
  intervalMs = 15 * 60 * 1000,
  logger = console,
} = {}) {
  const syncService = service || createBoostyCommunityService();
  let timer = null;
  let running = false;
  let inFlight = false;

  async function poll() {
    if (inFlight || !isDbReady()) return null;
    inFlight = true;
    try {
      const result = await syncService.syncMatchingSubscribers();
      if (result.linked > 0) logger.info(`[Boosty] Automatically linked ${result.linked} paid subscriber(s) by matching nicknames.`);
      return result;
    } catch (error) {
      logger.warn('[Boosty] Automatic subscriber sync failed:', error.message);
      return null;
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (running) return worker;
    running = true;
    poll();
    timer = setInterval(() => { poll(); }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return worker;
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  const worker = { start, stop, poll };
  return worker;
}

let processWorker = null;
function startAutoLinkWorker(options = {}) {
  if (!processWorker) processWorker = createAutoLinkWorker(options).start();
  return processWorker;
}

module.exports = {
  ...createBoostyCommunityService(),
  createBoostyCommunityService,
  createAutoLinkWorker,
  startAutoLinkWorker,
  normalizeSubscriberId,
  normalizeTwitchLogin,
};
