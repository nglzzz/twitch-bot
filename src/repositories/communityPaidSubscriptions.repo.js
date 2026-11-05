'use strict';

const { db, stmt } = require('./base');
const communityRepo = require('./community.repo');
const achievementService = () => require('../services/achievements.service');

function recordSubscription({ provider, userId, username, displayName, externalSubscriberId, confirmedBy = null, confirmedAt = Date.now(), existingIdentityOnly = false } = {}) {
  if (!['twitch', 'boosty'].includes(provider)) throw new TypeError('A supported subscription provider is required');
  const externalId = String(externalSubscriberId || '').trim();
  if (!externalId || externalId.length > 256) throw new TypeError('A valid external subscriber ID is required');
  const confirmer = confirmedBy === null ? null : String(confirmedBy).trim().slice(0, 128);
  if (provider === 'boosty' && !confirmer) throw new TypeError('A confirmer is required for Boosty subscription links');
  const timestamp = Number(confirmedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new TypeError('A valid subscription confirmation time is required');

  return db.transaction(() => {
    let identity;
    if (existingIdentityOnly) {
      identity = communityRepo.findUniqueIdentityByLogin(username);
      if (!identity || String(identity.userId) !== String(userId)) {
        throw new Error('An existing unique Twitch identity is required for automatic Boosty linking');
      }
    } else {
      identity = communityRepo.prepareUserForEvent({ userId, username, displayName }, timestamp);
    }
    achievementService().seedBaseline(identity.userId, { now: timestamp });
    const externalOwner = stmt(`SELECT user_id FROM community_paid_subscription
      WHERE provider = ? AND external_subscriber_id = ?`).get(provider, externalId);
    if (externalOwner && externalOwner.user_id !== identity.userId) {
      throw new Error('This external subscriber is already linked to a different Twitch user');
    }
    const existing = stmt(`SELECT external_subscriber_id FROM community_paid_subscription
      WHERE user_id = ? AND provider = ?`).get(identity.userId, provider);
    if (existing) {
      if (existing.external_subscriber_id !== externalId) {
        throw new Error('This Twitch user already has a different subscriber account linked');
      }
      achievementService().evaluateUser(identity.userId, { now: timestamp });
      return false;
    }
    const inserted = stmt(`INSERT INTO community_paid_subscription
      (user_id, provider, external_subscriber_id, confirmed_by, first_confirmed_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(identity.userId, provider, externalId, confirmer, timestamp).changes === 1;
    if (inserted) achievementService().evaluateUser(identity.userId, { now: timestamp });
    return inserted;
  })();
}

function recordTwitchSubscription({ userId, username, displayName, confirmedAt = Date.now(), identityAlreadyPrepared = false } = {}) {
  const id = String(userId || '').trim();
  if (identityAlreadyPrepared && id) {
    const subscriptionExists = stmt(`SELECT 1 FROM community_paid_subscription
      WHERE user_id = ? AND provider = 'twitch' AND external_subscriber_id = ?`).get(id, id);
    const achievementExists = stmt(`SELECT 1 FROM community_achievement
      WHERE user_id = ? AND achievement_id = 'twitch_paid_sub_1'`).get(id);
    if (subscriptionExists && achievementExists) return false;
  }
  return recordSubscription({ provider: 'twitch', userId, username, displayName,
    externalSubscriberId: userId, confirmedAt });
}

function recordBoostySubscription({ userId, username, displayName, externalSubscriberId, confirmedBy, confirmedAt = Date.now() } = {}) {
  return recordSubscription({ provider: 'boosty', userId, username, displayName,
    externalSubscriberId, confirmedBy, confirmedAt });
}

function recordAutomaticBoostySubscription({ userId, username, displayName, externalSubscriberId, confirmedAt = Date.now() } = {}) {
  return recordSubscription({ provider: 'boosty', userId, username, displayName,
    externalSubscriberId, confirmedBy: 'automatic-boosty-nickname-match', confirmedAt, existingIdentityOnly: true });
}

function getStats(userId) {
  if (!userId) return { twitchPaidSubscription: false, boostyPaidSubscription: false };
  const subscriptions = new Set(stmt(`SELECT provider FROM community_paid_subscription WHERE user_id = ?`).all(String(userId))
    .map(({ provider }) => provider));
  return {
    twitchPaidSubscription: subscriptions.has('twitch'),
    boostyPaidSubscription: subscriptions.has('boosty'),
  };
}

function listBoostyMappings() {
  return stmt(`SELECT user_id AS userId, external_subscriber_id AS externalSubscriberId,
      confirmed_by AS confirmedBy
    FROM community_paid_subscription WHERE provider = 'boosty'`).all();
}

module.exports = {
  recordTwitchSubscription,
  recordBoostySubscription,
  recordAutomaticBoostySubscription,
  getStats,
  listBoostyMappings,
};
