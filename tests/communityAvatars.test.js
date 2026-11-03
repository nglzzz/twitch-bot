'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const express = require('express');
const handlebars = require('express-handlebars');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-community-avatars-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const communityRepo = require('../src/repositories/community.repo');
const communityService = require('../src/services/community.service');
const {
  createTwitchCommunityService,
  constants: twitchConstants,
} = require('../src/services/twitchCommunity.service');
const { createCommunityRouter } = require('../src/webserver/community.routes');

const AVATARS = {
  top_viewer: 'https://static-cdn.jtvnw.net/jtv_user_pictures/top-viewer-profile_image-300x300.png',
  next_viewer: 'https://static-cdn.jtvnw.net/jtv_user_pictures/next-viewer-profile_image-300x300.png',
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function makeApp(enrichment) {
  const app = express();
  app.engine('handlebars', handlebars({
    defaultLayout: false,
    helpers: {
      eq(left, right, options) {
        const matches = left === right;
        return options && typeof options.fn === 'function'
          ? (matches ? options.fn(this) : options.inverse(this))
          : matches;
      },
    },
  }));
  app.set('view engine', 'handlebars');
  app.set('views', path.resolve(__dirname, '../src/views'));
  app.use('/', createCommunityRouter({
    service: communityService,
    isReady: db.isDbReady,
    navigation: () => [],
    enrichment,
  }));
  return app;
}

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function recordLegacyMessages(login, displayName, count) {
  for (let index = 0; index < count; index += 1) {
    communityRepo.recordChat({
      userId: null,
      username: login,
      displayName,
      message: `historical message ${index + 1}`,
      messageId: `legacy-avatar-${login}-${index + 1}`,
      createdAt: Date.now() - (count - index),
    });
  }
}

function makeHelixClient(users) {
  const calls = [];
  return {
    calls,
    async get(url, options = {}) {
      calls.push({
        url,
        params: options.params,
        serialized: options.paramsSerializer?.(options.params),
      });
      assert.equal(url, twitchConstants.HELIX_USERS_URL);
      assert.equal(options.headers.Authorization, 'Bearer isolated-test-token');
      assert.equal(options.headers['Client-Id'], 'isolated-test-client');
      const logins = Array.isArray(options.params.login) ? options.params.login : [options.params.login];
      const normalized = new Set(logins.map((login) => String(login).toLowerCase()));
      return { data: { data: users.filter((user) => normalized.has(user.login.toLowerCase())) } };
    },
  };
}

function makeEnrichment({ axiosClient, hasCredentials = true }) {
  return createTwitchCommunityService({
    repo: communityRepo,
    axiosClient,
    settings: hasCredentials
      ? { TWITCH_API_CLIENT_ID: 'isolated-test-client', TWITCH_API_CLIENT_SECRET: 'isolated-test-secret' }
      : {},
    getAccessToken: async () => (hasCredentials ? 'isolated-test-token' : ''),
    getAppToken: async () => null,
  });
}

test('cold historical chat avatars hydrate through the leaderboard page and API, then stay cached', async () => {
  recordLegacyMessages('top_viewer', 'Top Viewer', 3);
  recordLegacyMessages('next_viewer', 'Next Viewer', 2);

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM community_user').get().count, 0);
  const originalRows = communityRepo.getLeaderboard({ board: 'chat', mode: 'all' });
  const originalRanking = originalRows.map(({ login, displayName, score, position }) => ({ login, displayName, score, position }));
  assert.deepEqual(originalRanking, [
    { login: 'top_viewer', displayName: 'Top Viewer', score: 3, position: 1 },
    { login: 'next_viewer', displayName: 'Next Viewer', score: 2, position: 2 },
  ]);

  const helix = makeHelixClient([
    { id: 'legacy-twitch-top', login: 'top_viewer', display_name: 'Top Viewer', profile_image_url: AVATARS.top_viewer },
    { id: 'legacy-twitch-next', login: 'next_viewer', display_name: 'Next Viewer', profile_image_url: AVATARS.next_viewer },
  ]);
  const enrichment = makeEnrichment({ axiosClient: helix });
  const app = makeApp(enrichment);

  await withServer(app, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/community?board=chat&mode=all`);
    assert.equal(page.status, 200);
    const html = await page.text();

    for (const [login, avatarUrl] of Object.entries(AVATARS)) {
      assert.match(html, new RegExp(`<img class="community-avatar__image" src="${escapeRegExp(avatarUrl)}"`));
      assert.match(html, new RegExp(`href="/users/${login}"`));
    }
    assert.match(html, /Top Viewer/);
    assert.match(html, /Next Viewer/);

    assert.equal(helix.calls.length, 1, 'the two legacy logins are resolved in one Helix request');
    assert.deepEqual(helix.calls[0].params.login, ['top_viewer', 'next_viewer']);
    assert.equal(helix.calls[0].serialized, 'login=top_viewer&login=next_viewer');

    const savedUsers = db.prepare(`SELECT user_id AS userId, username, avatar_url AS avatarUrl,
        avatar_checked_at AS avatarCheckedAt
      FROM community_user ORDER BY username`).all();
    assert.deepEqual(savedUsers.map(({ userId, username, avatarUrl }) => ({ userId, username, avatarUrl })), [
      { userId: 'legacy-twitch-next', username: 'next_viewer', avatarUrl: AVATARS.next_viewer },
      { userId: 'legacy-twitch-top', username: 'top_viewer', avatarUrl: AVATARS.top_viewer },
    ]);
    assert.ok(savedUsers.every((user) => Number.isFinite(user.avatarCheckedAt) && user.avatarCheckedAt > 0));

    const rankingAfterHydration = communityRepo.getLeaderboard({ board: 'chat', mode: 'all' })
      .map(({ login, displayName, score, position }) => ({ login, displayName, score, position }));
    assert.deepEqual(rankingAfterHydration, originalRanking, 'resolving identities must not alter historical message scores or rank');

    const secondPage = await fetch(`${baseUrl}/community?board=chat&mode=all`);
    assert.equal(secondPage.status, 200);
    const secondHtml = await secondPage.text();
    assert.match(secondHtml, new RegExp(escapeRegExp(AVATARS.top_viewer)));
    assert.equal(helix.calls.length, 1, 'the fresh cached avatars avoid another Twitch request');

    const apiResponse = await fetch(`${baseUrl}/api/community/leaderboard?board=chat&mode=all`);
    assert.equal(apiResponse.status, 200);
    const apiLeaderboard = await apiResponse.json();
    assert.deepEqual(apiLeaderboard.players.map(({ login, score, position, avatarUrl }) => ({ login, score, position, avatarUrl })), [
      { login: 'top_viewer', score: 3, position: 1, avatarUrl: AVATARS.top_viewer },
      { login: 'next_viewer', score: 2, position: 2, avatarUrl: AVATARS.next_viewer },
    ]);
    assert.equal(helix.calls.length, 1, 'the API response also uses the saved avatars');
  });
});

test('missing Twitch credentials leave historical identities untouched and render the initial fallback', async () => {
  recordLegacyMessages('offline_viewer', 'Offline Viewer', 1);
  const helix = makeHelixClient([]);
  const enrichment = makeEnrichment({ axiosClient: helix, hasCredentials: false });
  const app = makeApp(enrichment);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/community?board=chat&mode=all`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const offlineViewerLink = html.indexOf('href="/users/offline_viewer"', html.indexOf('<ol class="community-table"'));
    assert.notEqual(offlineViewerLink, -1);
    const rowStart = html.lastIndexOf('<li class="community-row"', offlineViewerLink);
    const rowEnd = html.indexOf('</li>', offlineViewerLink);
    const offlineViewerRow = html.slice(rowStart, rowEnd);
    assert.match(offlineViewerRow, /community-avatar__initial">O</);
    assert.doesNotMatch(offlineViewerRow, /<img class="community-avatar__image"/);
    assert.equal(helix.calls.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM community_user WHERE username = ?').get('offline_viewer').count, 0);

    const legacyProfile = communityRepo.findProfileIdentity('offline_viewer');
    assert.equal(legacyProfile.userId, null);
    assert.equal(legacyProfile.avatarCheckedAt, undefined);
  });
});
