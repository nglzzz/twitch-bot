'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-community-api-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');
const {
  createTwitchCommunityService,
  safeAvatarUrl,
  constants,
} = require('../src/services/twitchCommunity.service');
const database = require('../src/app/db');

const BASE_TIME = Date.parse('2026-10-31T12:00:00.000Z');
const IMAGE = 'https://static-cdn.jtvnw.net/jtv_user_pictures/avatar-profile_image-300x300.png';

test.after(() => {
  if (database.open) database.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function makeFixture({
  users = [], profiles = [], token = 'user-token', validate = {}, getError = null,
  followerResponse = null, deferUsers = false, hasClientCredentials = true,
} = {}) {
  let nowValue = BASE_TIME;
  const requests = [];
  const updates = [];
  const followStates = [];
  const pendingUserResponses = [];
  const usersById = new Map(users.map((user) => [String(user.id), { ...user }]));
  const profilesByLogin = new Map(profiles.map((profile) => [profile.username.toLowerCase(), { ...profile }]));
  const repo = {
    findProfileIdentity(login) {
      return profilesByLogin.get(String(login).toLowerCase()) || null;
    },
    findIdentityById(userId) {
      return [...profilesByLogin.values()].find((profile) => String(profile.userId) === String(userId)) || null;
    },
    updateTwitchUser(update) {
      updates.push(update);
      usersById.set(String(update.userId), update);
      const prior = profilesByLogin.get(String(update.username).toLowerCase()) || {};
      profilesByLogin.set(String(update.username).toLowerCase(), {
        ...prior, ...update, userId: update.userId, avatarCheckedAt: update.checkedAt,
      });
      return profilesByLogin.get(String(update.username).toLowerCase());
    },
    setFollowState(state) {
      followStates.push(state);
      const profile = [...profilesByLogin.values()].find((item) => String(item.userId) === String(state.userId));
      if (profile) Object.assign(profile, {
        followStatus: state.isFollowing ? 1 : 0,
        currentFollowedAt: state.followedAt,
        followCheckedAt: state.checkedAt,
      });
    },
    listDueFollowChecks() { return [...profilesByLogin.values()].map(({ userId }) => ({ userId })); },
  };
  const axiosClient = {
    async get(url, options = {}) {
      requests.push({ url, ...options });
      if (options.headers && options.headers.Authorization.startsWith('OAuth ')) {
        return { data: { client_id: 'client-id', user_id: 'broadcaster-id', scopes: [constants.FOLLOW_SCOPE], ...validate } };
      }
      if (url === constants.FOLLOWERS_URL) {
        if (getError) throw getError;
        return { data: followerResponse || { data: [{ user_id: 'viewer-id', followed_at: '2026-08-01T00:00:00.000Z' }] } };
      }
      if (getError) throw getError;
      const query = options.params || {};
      const selected = users.filter((user) => (
        (query.id && (Array.isArray(query.id) ? query.id : [query.id]).includes(String(user.id)))
        || (query.login && (Array.isArray(query.login) ? query.login : [query.login])
          .some((login) => String(user.login).toLowerCase() === String(login).toLowerCase()))
      ));
      const result = { data: { data: selected } };
      if (!deferUsers) return result;
      return new Promise((resolve) => pendingUserResponses.push(() => resolve(result)));
    },
  };
  const service = createTwitchCommunityService({
    repo,
    axiosClient,
    settings: hasClientCredentials
      ? { TWITCH_API_CLIENT_ID: 'client-id', TWITCH_API_CLIENT_SECRET: 'client-secret', BROADCASTER_ID: 'broadcaster-id' }
      : {},
    getAccessToken: async () => token,
    getAppToken: async () => null,
    now: () => nowValue,
  });
  return {
    service, requests, updates, followStates, profilesByLogin,
    setNow(value) { nowValue = value; },
    releaseUserResponses() { pendingUserResponses.splice(0).forEach((release) => release()); },
  };
}

test('accepts Twitch CDN profile images and rejects external, insecure, or unrelated URLs', () => {
  assert.equal(safeAvatarUrl(IMAGE), IMAGE);
  assert.equal(safeAvatarUrl('http://static-cdn.jtvnw.net/jtv_user_pictures/a.png'), null);
  assert.equal(safeAvatarUrl('https://evil.example/jtv_user_pictures/a.png'), null);
  assert.equal(safeAvatarUrl('https://static-cdn.jtvnw.net/other/a.png'), null);
  assert.equal(safeAvatarUrl('https://user:pass@static-cdn.jtvnw.net/jtv_user_pictures/a.png'), null);
  assert.equal(safeAvatarUrl('https://static-cdn.jtvnw.net:444/jtv_user_pictures/a.png'), null);
  assert.equal(safeAvatarUrl('javascript:alert(1)'), null);
});

test('loads profile pictures for ranked users in one bounded Helix batch and caches them', async () => {
  const logins = ['viewer_one', 'viewer_two'];
  const fixture = makeFixture({
    profiles: logins.map((username, index) => ({ userId: `viewer-${index + 1}`, username, displayName: username })),
    users: logins.map((login, index) => ({ id: `viewer-${index + 1}`, login, display_name: login, profile_image_url: IMAGE })),
  });
  const avatars = await fixture.service.refreshAvatars(logins);
  assert.deepEqual([...avatars.entries()], logins.map((login) => [login, IMAGE]));
  const userCalls = fixture.requests.filter((request) => request.url === constants.HELIX_USERS_URL);
  assert.equal(userCalls.length, 1);
  assert.deepEqual(userCalls[0].params.id, ['viewer-1', 'viewer-2']);
  assert.equal(userCalls[0].paramsSerializer(userCalls[0].params), 'id=viewer-1&id=viewer-2');
  assert.deepEqual(fixture.updates.map((update) => update.avatarUrl), [IMAGE, IMAGE]);

  fixture.setNow(BASE_TIME + 10_000);
  await fixture.service.refreshAvatars(logins);
  assert.equal(fixture.requests.filter((request) => request.url === constants.HELIX_USERS_URL).length, 1);
});

test('resolves a legacy login to its stable Twitch ID and falls back safely when Helix fails', async () => {
  const profile = { userId: null, username: 'legacy_viewer', displayName: 'Legacy Viewer' };
  const fixture = makeFixture({
    profiles: [profile],
    users: [{ id: 'resolved-id', login: 'legacy_viewer', display_name: 'Legacy Viewer', profile_image_url: IMAGE }],
  });
  assert.equal((await fixture.service.refreshAvatars(['legacy_viewer'])).get('legacy_viewer'), IMAGE);
  assert.equal(fixture.updates[0].userId, 'resolved-id');
  assert.deepEqual(fixture.requests[0].params.login, ['legacy_viewer']);

  const fallback = makeFixture({
    profiles: [{ userId: 'known-id', username: 'known_viewer', displayName: 'Known', avatarUrl: IMAGE }],
    getError: new Error('network unavailable'),
  });
  assert.equal((await fallback.service.refreshAvatars(['known_viewer'])).get('known_viewer'), IMAGE);
});

test('resolves legacy logins in a single Helix batch', async () => {
  const profiles = ['legacy_one', 'legacy_two'].map((username) => ({
    userId: null, username, displayName: username,
  }));
  const fixture = makeFixture({
    profiles,
    users: profiles.map(({ username }, index) => ({
      id: `legacy-${index}`, login: username, display_name: username, profile_image_url: IMAGE,
    })),
  });

  const avatars = await fixture.service.refreshAvatars(['legacy_one', 'legacy_two']);

  const userCalls = fixture.requests.filter((request) => request.url === constants.HELIX_USERS_URL);
  assert.equal(userCalls.length, 1);
  assert.deepEqual(userCalls[0].params.login, ['legacy_one', 'legacy_two']);
  assert.equal(userCalls[0].paramsSerializer(userCalls[0].params), 'login=legacy_one&login=legacy_two');
  assert.equal(avatars.get('legacy_one'), IMAGE);
  assert.equal(avatars.get('legacy_two'), IMAGE);
  assert.deepEqual(fixture.updates.map(({ userId }) => userId), ['legacy-0', 'legacy-1']);
});

test('does not mutate avatar state when Twitch credentials are unavailable', async () => {
  const fixture = makeFixture({
    profiles: [{ userId: 'viewer-id', username: 'viewer', displayName: 'Viewer', avatarUrl: IMAGE }],
    token: '',
    hasClientCredentials: false,
  });

  const avatars = await fixture.service.refreshAvatars(['viewer']);

  assert.equal(avatars.get('viewer'), IMAGE);
  assert.equal(fixture.requests.length, 0);
  assert.deepEqual(fixture.updates, []);
});

test('overlapping avatar refreshes share in-flight requests for stable Twitch IDs', async () => {
  const profiles = ['viewer_one', 'viewer_two', 'viewer_three'].map((username, index) => ({
    userId: `viewer-${index + 1}`, username, displayName: username,
  }));
  const fixture = makeFixture({
    profiles,
    users: profiles.map((profile) => ({
      id: profile.userId, login: profile.username, display_name: profile.displayName, profile_image_url: IMAGE,
    })),
    deferUsers: true,
  });

  const first = fixture.service.refreshAvatars(['viewer_one', 'viewer_two']);
  await new Promise((resolve) => setImmediate(resolve));
  const overlapping = fixture.service.refreshAvatars(['viewer_two', 'viewer_three']);
  await new Promise((resolve) => setImmediate(resolve));
  const calls = fixture.requests.filter((request) => request.url === constants.HELIX_USERS_URL);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ params }) => params.id), [['viewer-1', 'viewer-2'], ['viewer-3']]);

  fixture.releaseUserResponses();
  await Promise.all([first, overlapping]);
  assert.deepEqual(fixture.updates.map(({ userId }) => userId).sort(), ['viewer-1', 'viewer-2', 'viewer-3']);
});

test('backfills current follow date and duration from the authorized followers API only once per cache interval', async () => {
  const fixture = makeFixture({
    profiles: [{ userId: 'viewer-id', username: 'viewer', displayName: 'Viewer', followStatus: null }],
  });
  const profile = await fixture.service.refreshProfile('viewer');
  assert.equal(profile.followStatus, 1);
  assert.equal(profile.currentFollowedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(profile.followCheckedAt, BASE_TIME);
  assert.deepEqual(fixture.followStates, [{
    userId: 'viewer-id', isFollowing: true,
    followedAt: '2026-08-01T00:00:00.000Z', checkedAt: BASE_TIME, historical: true,
  }]);
  assert.deepEqual(fixture.requests.find((request) => request.url === constants.FOLLOWERS_URL).params, {
    broadcaster_id: 'broadcaster-id', user_id: 'viewer-id',
  });

  fixture.setNow(BASE_TIME + 1000);
  await fixture.service.refreshProfile('viewer');
  assert.equal(fixture.requests.filter((request) => request.url === constants.VALIDATE_URL).length, 1);
  assert.equal(fixture.requests.filter((request) => request.url === constants.FOLLOWERS_URL).length, 1);
});

test('missing scope, unauthorized requests, and incomplete follower responses never erase known follow data', async () => {
  const noScope = makeFixture({
    profiles: [{ userId: 'viewer-id', username: 'viewer', displayName: 'Viewer', followStatus: 1,
      currentFollowedAt: '2026-01-01T00:00:00.000Z', followCheckedAt: 0 }],
    validate: { scopes: [] },
  });
  const preserved = await noScope.service.refreshProfile('viewer');
  assert.equal(noScope.requests.some((request) => request.url === constants.FOLLOWERS_URL), false);
  assert.equal(noScope.followStates.length, 0);
  assert.equal(preserved.currentFollowedAt, '2026-01-01T00:00:00.000Z');

  const forbidden = makeFixture({
    profiles: [{ userId: 'viewer-id', username: 'viewer', displayName: 'Viewer', followStatus: 1,
      currentFollowedAt: '2026-01-01T00:00:00.000Z' }],
    getError: Object.assign(new Error('forbidden'), { response: { status: 403 } }),
  });
  const stillKnown = await forbidden.service.refreshProfile('viewer');
  assert.equal(forbidden.followStates.length, 0);
  assert.equal(stillKnown.currentFollowedAt, '2026-01-01T00:00:00.000Z');

  const countOnly = makeFixture({
    profiles: [{ userId: 'viewer-id', username: 'viewer', displayName: 'Viewer', followStatus: 1,
      currentFollowedAt: '2026-01-01T00:00:00.000Z' }],
    followerResponse: { total: 42 },
  });
  await countOnly.service.refreshProfile('viewer');
  await countOnly.service.refreshProfile('viewer');
  assert.equal(countOnly.followStates.length, 0);
  assert.equal(countOnly.requests.filter((request) => request.url === constants.FOLLOWERS_URL).length, 1);

  const malformed = makeFixture({
    profiles: [{ userId: 'viewer-id', username: 'viewer', displayName: 'Viewer' }],
    followerResponse: { total: 42, data: [{}] },
  });
  await malformed.service.refreshProfile('viewer');
  await malformed.service.refreshProfile('viewer');
  assert.equal(malformed.followStates.length, 0);
  assert.equal(malformed.requests.filter((request) => request.url === constants.FOLLOWERS_URL).length, 1);
});

test('a verified unfollow clears the current follow date while retaining safe API behavior', async () => {
  const fixture = makeFixture({
    profiles: [{ userId: 'viewer-id', username: 'viewer', displayName: 'Viewer', followStatus: 1,
      currentFollowedAt: '2026-01-01T00:00:00.000Z' }],
    followerResponse: { total: 42, data: [] },
  });
  await fixture.service.refreshProfile('viewer');
  assert.equal(fixture.followStates.length, 1);
  assert.equal(fixture.followStates[0].isFollowing, false);
  assert.equal(fixture.followStates[0].followedAt, null);
});
