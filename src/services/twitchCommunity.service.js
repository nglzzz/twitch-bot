'use strict';

const axios = require('axios');
const config = require('../config');
const communityRepo = require('../repositories/community.repo');
const { getTwitchAccessToken } = require('./token.service');
const getOAuthToken = require('../twitchApi/oauth');

const HELIX_USERS_URL = 'https://api.twitch.tv/helix/users';
const FOLLOWERS_URL = 'https://api.twitch.tv/helix/channels/followers';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const FOLLOW_SCOPE = 'moderator:read:followers';
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 5 * 60 * 1000;
const VALIDATION_CACHE_MAX_MS = 60 * 60 * 1000;
const AVATAR_BATCH_LIMIT = 100;
const MAX_RETRY_ENTRIES = 2000;
const VALID_TWITCH_AVATAR_HOST = 'static-cdn.jtvnw.net';

function serializeParams(params) {
  return Object.entries(params).flatMap(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
  }).join('&');
}

function normalizeLogin(value) {
  const login = String(value || '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(login) ? login : null;
}

function safeAvatarUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== VALID_TWITCH_AVATAR_HOST
        || url.username || url.password || url.port) return null;
    if (!url.pathname.startsWith('/jtv_user_pictures/')) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

function tokenValue(value) {
  if (typeof value === 'string') return value.trim();
  return String(value && value.token || '').trim();
}

function createTwitchCommunityService({
  repo = communityRepo,
  axiosClient = axios,
  settings = config,
  getAccessToken = getTwitchAccessToken,
  getAppToken = getOAuthToken,
  now = Date.now,
  cacheMs = DEFAULT_CACHE_MS,
  failureCacheMs = FAILURE_CACHE_MS,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const avatarRequests = new Map();
  const loginRequests = new Map();
  const avatarRetryAt = new Map();
  const followRetryAt = new Map();
  let validation = null;
  let validationToken = '';
  let validationRequest = null;

  function pruneRetryMap(map) {
    const currentTime = now();
    for (const [key, expiresAt] of map) {
      if (expiresAt <= currentTime) map.delete(key);
    }
    while (map.size >= MAX_RETRY_ENTRIES) {
      map.delete(map.keys().next().value);
    }
  }

  function setRetry(map, key, ttl = failureCacheMs) {
    pruneRetryMap(map);
    map.set(key, now() + ttl);
  }

  async function getHelixToken() {
    let userToken = '';
    try {
      userToken = tokenValue(await getAccessToken());
    } catch (_) {
      userToken = '';
    }
    if (userToken) return userToken;

    if (!settings.TWITCH_API_CLIENT_ID || !settings.TWITCH_API_CLIENT_SECRET) return '';
    try {
      return tokenValue(await getAppToken());
    } catch (_) {
      return '';
    }
  }

  async function requestHeaders(token) {
    if (!settings.TWITCH_API_CLIENT_ID || !token) return null;
    return {
      Authorization: `Bearer ${token}`,
      'Client-Id': settings.TWITCH_API_CLIENT_ID,
    };
  }

  async function fetchTwitchUsers(params) {
    const token = await getHelixToken();
    const headers = await requestHeaders(token);
    if (!headers) return null;

    const response = await axiosClient.get(HELIX_USERS_URL, {
      params,
      paramsSerializer: serializeParams,
      headers,
      timeout: timeoutMs,
    });
    return Array.isArray(response.data && response.data.data) ? response.data.data : null;
  }

  async function findProfile(login) {
    if (typeof repo.findProfileIdentity !== 'function') return null;
    return repo.findProfileIdentity(login);
  }

  async function saveTwitchUser(user, { avatarUrl = null, checkedAt = now() } = {}) {
    if (!user || !user.id || typeof repo.updateTwitchUser !== 'function') return;
    await repo.updateTwitchUser({
      userId: String(user.id),
      username: user.login,
      displayName: user.display_name,
      avatarUrl: safeAvatarUrl(user.profile_image_url),
      checkedAt,
    });
  }

  async function refreshAvatars(logins) {
    const result = new Map();
    pruneRetryMap(avatarRetryAt);
    const normalized = [...new Set((Array.isArray(logins) ? logins : [])
      .map(normalizeLogin).filter(Boolean))].slice(0, AVATAR_BATCH_LIMIT);

    const profiles = await Promise.all(normalized.map(async (login) => ({ login, profile: await findProfile(login) })));
    for (const { login, profile } of profiles) {
      if (!profile) continue;
      result.set(login, safeAvatarUrl(profile.avatarUrl));
    }

    const pendingIdentities = profiles.filter(({ login, profile }) => profile
      && (!profile.avatarCheckedAt || now() - Number(profile.avatarCheckedAt) >= cacheMs)
      && (avatarRetryAt.get(profile.userId ? String(profile.userId) : `login:${login}`) || 0) <= now());
    const waits = [];
    const freshIdentities = [];
    for (const identity of pendingIdentities) {
      const key = identity.profile.userId ? String(identity.profile.userId) : `login:${identity.login}`;
      const inFlight = identity.profile.userId ? avatarRequests.get(key) : loginRequests.get(identity.login);
      if (inFlight) waits.push(inFlight);
      else freshIdentities.push(identity);
    }

    // Resolve IDs in bounded batches so a reused login never associates a
    // previous owner's photo with the current account.
    const batches = [];
    for (let offset = 0; offset < freshIdentities.length; offset += AVATAR_BATCH_LIMIT) {
      batches.push(freshIdentities.slice(offset, offset + AVATAR_BATCH_LIMIT));
    }
    for (const batch of batches) {
      const stable = batch.filter(({ profile }) => profile.userId);
      const legacy = batch.filter(({ profile }) => !profile.userId);
      const groups = [
        { items: stable, queryName: 'id', keyOf: (item) => String(item.profile.userId) },
        { items: legacy, queryName: 'login', keyOf: (item) => `login:${item.login}` },
      ].filter(({ items }) => items.length > 0);

      for (const group of groups) {
        const queryValues = [...new Set(group.items.map((item) => (
          group.queryName === 'id' ? String(item.profile.userId) : item.login
        )))];
        const request = (async () => {
          try {
            const users = await fetchTwitchUsers({ [group.queryName]: queryValues });
            if (users === null) {
              for (const item of group.items) setRetry(avatarRetryAt, group.keyOf(item));
              return;
            }
            const byKey = new Map(users.map((user) => [
              group.queryName === 'id' ? String(user.id) : normalizeLogin(user.login),
              user,
            ]));
            for (const item of group.items) {
              const lookupKey = group.queryName === 'id' ? String(item.profile.userId) : item.login;
              const user = byKey.get(lookupKey);
              if (user) {
                await saveTwitchUser(user, { checkedAt: now() });
                const key = String(user.id);
                avatarRetryAt.delete(key);
                avatarRetryAt.delete(`login:${item.login}`);
              } else if (item.profile.userId && typeof repo.updateTwitchUser === 'function') {
                // A valid Helix response with no matching ID is a cached
                // negative lookup; transient errors never clear old images.
                await repo.updateTwitchUser({
                  userId: String(item.profile.userId), username: item.profile.username,
                  displayName: item.profile.displayName, avatarUrl: null, checkedAt: now(),
                });
              } else {
                setRetry(avatarRetryAt, group.keyOf(item), cacheMs);
              }
            }
          } catch (_) {
            for (const item of group.items) setRetry(avatarRetryAt, group.keyOf(item));
          }
        })();

        for (const item of group.items) {
          const key = group.keyOf(item);
          (group.queryName === 'id' ? avatarRequests : loginRequests).set(
            group.queryName === 'id' ? key : item.login,
            request
          );
        }
        waits.push(request.finally(() => {
          for (const item of group.items) {
            const key = group.keyOf(item);
            const requestMap = group.queryName === 'id' ? avatarRequests : loginRequests;
            const mapKey = group.queryName === 'id' ? key : item.login;
            if (requestMap.get(mapKey) === request) requestMap.delete(mapKey);
          }
        }));
      }
    }

    await Promise.all(waits);
    for (const { login, profile } of profiles) {
      if (!profile) continue;
      const current = (profile.userId && typeof repo.findIdentityById === 'function'
        ? await repo.findIdentityById(String(profile.userId))
        : null) || await findProfile(login);
      if (current) result.set(login, safeAvatarUrl(current.avatarUrl));
    }

    return result;
  }

  async function validateFollowerToken() {
    const token = await getHelixToken();
    if (!token) return null;
    if (validation && validationToken === token && validation.expiresAt > now()) return validation.value;
    if (validationRequest && validationToken === token) return validationRequest;

    const headers = await requestHeaders(token);
    if (!headers) return null;
    validationToken = token;
    validationRequest = (async () => {
      let result = null;
      let ttl = Math.min(failureCacheMs, FAILURE_CACHE_MS);
      try {
        const response = await axiosClient.get(VALIDATE_URL, {
          headers: { Authorization: `OAuth ${token}` },
          timeout: timeoutMs,
        });
        const body = response.data || {};
        const scopes = new Set(Array.isArray(body.scopes) ? body.scopes : []);
        if (String(body.client_id || '') === String(settings.TWITCH_API_CLIENT_ID)
            && body.user_id && scopes.has(FOLLOW_SCOPE)) {
          result = { token, moderatorUserId: String(body.user_id) };
          const tokenTtl = Number(body.expires_in);
          const remainingMs = Number.isFinite(tokenTtl) ? tokenTtl * 1000 - 30_000 : VALIDATION_CACHE_MAX_MS;
          ttl = Math.min(cacheMs, VALIDATION_CACHE_MAX_MS, remainingMs);
        }
      } catch (_) {
        result = null;
      }
      validation = { value: result, expiresAt: now() + Math.max(10_000, ttl) };
      return result;
    })();
    try {
      return await validationRequest;
    } finally {
      validationRequest = null;
    }
  }

  async function refreshFollower(profile, auth, { historical = false } = {}) {
    if (!profile || !profile.userId || !auth || !settings.BROADCASTER_ID) return false;
    const userId = String(profile.userId);
    const headers = await requestHeaders(auth.token);
    if (!headers) {
      setRetry(followRetryAt, userId);
      return false;
    }

    try {
      const response = await axiosClient.get(FOLLOWERS_URL, {
        params: { broadcaster_id: String(settings.BROADCASTER_ID), user_id: String(profile.userId) },
        headers,
        timeout: timeoutMs,
      });
      const data = response.data && response.data.data;
      // Twitch can return a follower count without user rows when permission
      // is incomplete. Treat that as unknown instead of erasing a follow.
      if (!Array.isArray(data) || data.some((item) => !item || !item.user_id)) {
        setRetry(followRetryAt, userId);
        return false;
      }
      const follower = data.find((item) => String(item.user_id) === userId);
      const checkedAt = now();
      if (typeof repo.setFollowState !== 'function') {
        setRetry(followRetryAt, userId);
        return false;
      }
      await repo.setFollowState({
        userId,
        isFollowing: Boolean(follower),
        followedAt: follower && follower.followed_at ? follower.followed_at : null,
        checkedAt,
        historical: Boolean(historical),
      });
      followRetryAt.delete(String(profile.userId));
      return true;
    } catch (_) {
      setRetry(followRetryAt, userId);
      return false;
    }
  }

  async function refreshProfile(login) {
    const normalized = normalizeLogin(login);
    if (!normalized) return null;
    const cached = await findProfile(normalized);
    if (!cached) return null;

    let profile = cached;
    const cachedAt = Number(profile.avatarCheckedAt) || 0;
    if (!cached.userId || !cachedAt || now() - cachedAt >= cacheMs) {
      const avatar = await refreshAvatars([normalized]);
      profile = (cached.userId && typeof repo.findIdentityById === 'function'
        ? await repo.findIdentityById(String(cached.userId))
        : null) || await findProfile(normalized) || { ...cached, avatarUrl: avatar.get(normalized) || null };
    }

    if (!profile.userId) return profile;
    const followCheckedAt = Number(profile.followCheckedAt) || 0;
    if ((!followCheckedAt || now() - followCheckedAt >= cacheMs)
        && (followRetryAt.get(String(profile.userId)) || 0) <= now()) {
      const auth = await validateFollowerToken();
      if (auth) {
        await refreshFollower(profile, auth, { historical: !followCheckedAt });
        profile = (typeof repo.findIdentityById === 'function'
          ? await repo.findIdentityById(String(profile.userId))
          : null) || await findProfile(normalized) || profile;
      }
    }
    return profile;
  }

  async function refreshDueFollowers(limit = 10) {
    if (typeof repo.listDueFollowChecks !== 'function' || typeof repo.findIdentityById !== 'function') return 0;
    const auth = await validateFollowerToken();
    if (!auth || !settings.BROADCASTER_ID) return 0;

    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 10)));
    let users;
    try {
      users = await repo.listDueFollowChecks({ before: now() - cacheMs, limit: Math.max(100, safeLimit) });
    } catch (_) {
      return 0;
    }
    let checked = 0;
    const eligible = users.filter((entry) => entry && entry.userId
      && (followRetryAt.get(String(entry.userId)) || 0) <= now());
    for (const entry of eligible.slice(0, safeLimit)) {
      const profile = entry && entry.userId ? await repo.findIdentityById(String(entry.userId)) : null;
      if (!profile) continue;
      const historical = !profile.followCheckedAt;
      if (await refreshFollower(profile, auth, { historical })) checked += 1;
    }
    return checked;
  }

  return {
    refreshProfile,
    refreshAvatars,
    refreshDueFollowers,
    validateFollowerToken,
  };
}

const service = createTwitchCommunityService();

module.exports = {
  createTwitchCommunityService,
  ...service,
  safeAvatarUrl,
  normalizeLogin,
  constants: {
    HELIX_USERS_URL,
    FOLLOWERS_URL,
    VALIDATE_URL,
    FOLLOW_SCOPE,
    REQUEST_TIMEOUT_MS,
    DEFAULT_CACHE_MS,
    FAILURE_CACHE_MS,
    AVATAR_BATCH_LIMIT,
  },
};
