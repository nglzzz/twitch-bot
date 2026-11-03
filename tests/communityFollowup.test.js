'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const handlebars = require('express-handlebars');
const { after, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-community-followup-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const communityRepo = require('../src/repositories/community.repo');
const communityService = require('../src/services/community.service');
const achievementRepo = require('../src/repositories/achievement.repo');
const { createCommunityRouter } = require('../src/webserver/community.routes');

const VALID_AVATAR = 'https://static-cdn.jtvnw.net/jtv_user_pictures/viewer-profile.png';
const NOW = Date.now();

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function makeApp({ enrichment = null } = {}) {
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
      or(...values) { return values.slice(0, -1).some(Boolean); },
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

function saveChat({ userId, username, displayName = username, message, messageId, createdAt = NOW, streamSessionId = null }) {
  return communityRepo.recordChat({ userId, username, displayName, message, messageId, createdAt, streamSessionId });
}

test('message-history cursor paginates equal timestamps across renamed logins without duplicates or other users', async () => {
  const userId = 'history-viewer-id';
  const timestamp = NOW - 3_600_000;
  for (let index = 0; index < 35; index += 1) {
    saveChat({
      userId,
      username: index < 6 ? 'history_old_name' : 'history_viewer',
      displayName: 'History Viewer',
      message: `история-${String(index).padStart(2, '0')}`,
      messageId: `history-message-${index}`,
      createdAt: timestamp,
    });
  }
  saveChat({ userId: null, username: 'history_viewer', message: 'legacy message for current login', messageId: 'history-legacy', createdAt: timestamp });
  saveChat({ userId: 'other-viewer-id', username: 'other_viewer', message: 'must stay private', messageId: 'history-other', createdAt: timestamp });
  saveChat({ userId, username: 'history_viewer', message: '<script>alert("history")</script>', messageId: 'history-xss', createdAt: timestamp + 1 });

  const expected = db.prepare(`SELECT message FROM chat_log
    WHERE user_id = ? OR (user_id IS NULL AND lower(user) = ?)
    ORDER BY created_at DESC, id DESC`).all(userId, 'history_viewer').map((row) => row.message);
  assert.equal(expected.length, 37);

  const app = makeApp();
  await withServer(app, async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/api/community/users/history_viewer/messages`);
    assert.equal(firstResponse.status, 200);
    const firstPage = await firstResponse.json();
    assert.equal(firstPage.messages.length, 30);
    assert.equal(firstPage.hasMore, true);
    assert.ok(firstPage.nextCursor);
    assert.deepEqual(firstPage.messages.map((row) => row.text), expected.slice(0, 30));
    assert.ok(firstPage.messages.every((row) => !Object.hasOwn(row, 'id') && !Object.hasOwn(row, 'userId')));
    assert.doesNotMatch(JSON.stringify(firstPage), /history-viewer-id|other-viewer-id|must stay private/);

    const secondResponse = await fetch(`${baseUrl}/api/community/users/history_viewer/messages?before=${encodeURIComponent(firstPage.nextCursor)}`);
    assert.equal(secondResponse.status, 200);
    const secondPage = await secondResponse.json();
    assert.equal(secondPage.messages.length, 7);
    assert.equal(secondPage.hasMore, false);
    assert.deepEqual(secondPage.messages.map((row) => row.text), expected.slice(30));
    const combined = [...firstPage.messages, ...secondPage.messages].map((row) => row.text);
    assert.equal(new Set(combined).size, 37);
    assert.deepEqual(combined, expected);

    const invalidCursor = await fetch(`${baseUrl}/api/community/users/history_viewer/messages?before[]=broken`);
    assert.equal(invalidCursor.status, 400);
    const oversizedCursor = await fetch(`${baseUrl}/api/community/users/history_viewer/messages?before=${'a'.repeat(513)}`);
    assert.equal(oversizedCursor.status, 400);

    const profilePage = await fetch(`${baseUrl}/users/history_viewer`);
    assert.equal(profilePage.status, 200);
    const html = await profilePage.text();
    assert.match(html, /&lt;script&gt;alert\(&quot;history&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\("history"\)<\/script>/);
    assert.doesNotMatch(html, /must stay private/);
  });
});

test('legacy-only message history is scoped to that profile and never exposes another chatter', async () => {
  communityRepo.recordChat({ userId: null, username: 'legacy_only_viewer', displayName: 'Legacy Only', message: 'my old public message', messageId: 'legacy-only-own', createdAt: NOW - 1000 });
  communityRepo.recordChat({ userId: null, username: 'unrelated_legacy_viewer', displayName: 'Other Legacy', message: 'someone elses message', messageId: 'legacy-only-other', createdAt: NOW });

  const app = makeApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/community/users/legacy_only_viewer/messages`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.messages.map((row) => row.text), ['my old public message']);
    assert.doesNotMatch(JSON.stringify(body), /someone elses message|unrelated_legacy_viewer/);
  });
});

test('Twitch-confirmed follow date drives tenure achievements and survives loss of current-follow status', () => {
  const userId = 'follow-tenure-viewer-id';
  const currentTime = Date.now();
  const startedAt = currentTime - (32 * 24 * 60 * 60 * 1000) - (2 * 60 * 60 * 1000);
  saveChat({ userId, username: 'follow_tenure_viewer', message: 'hello before follow check', messageId: 'follow-tenure-chat', createdAt: currentTime - 1000 });

  communityRepo.setFollowState({ userId, isFollowing: true, followedAt: startedAt, checkedAt: currentTime, historical: true });
  const profile = communityService.getProfile('follow_tenure_viewer');
  assert.equal(profile.followStatusLabel, 'Фолловер канала');
  assert.equal(profile.followDurationLabel, '32 дн.');
  assert.match(profile.currentFollowedAtLabel, /\d/);
  assert.equal(profile.achievements.find((achievement) => achievement.id === 'follow_days_7').unlocked, true);
  assert.equal(profile.achievements.find((achievement) => achievement.id === 'follow_days_30').unlocked, true);
  assert.equal(profile.achievements.find((achievement) => achievement.id === 'follow_days_90').unlocked, false);

  communityRepo.setFollowState({ userId, isFollowing: false, checkedAt: currentTime + 1, historical: true });
  const afterUnfollow = communityService.getProfile('follow_tenure_viewer');
  assert.match(afterUnfollow.followStatusLabel, /не фолловит/);
  assert.equal(afterUnfollow.achievements.find((achievement) => achievement.id === 'follow_days_7').unlocked, true);
  assert.equal(afterUnfollow.achievements.find((achievement) => achievement.id === 'follow_days_30').unlocked, true);
  assert.equal(achievementRepo.getEarned(userId).filter((achievement) => achievement.achievementId.startsWith('follow_days_')).length, 2);
});

test('profiles and recent-achievement API show cached Twitch avatars, verified follow dates, and saved awards without GET-side unlocks', async () => {
  const userId = 'visible-profile-viewer-id';
  saveChat({ userId, username: 'visible_profile_viewer', displayName: 'Visible Viewer', message: 'my first real message', messageId: 'visible-profile-first', createdAt: NOW - 1000 });
  communityRepo.updateTwitchUser({
    userId,
    username: 'visible_profile_viewer',
    displayName: 'Visible Viewer',
    avatarUrl: VALID_AVATAR,
    checkedAt: NOW,
  });
  communityRepo.setFollowState({ userId, isFollowing: true, followedAt: NOW - 15 * 86400000, checkedAt: NOW, historical: true });

  const calls = { profiles: [], avatars: [] };
  const enrichment = {
    async refreshProfile(login) {
      calls.profiles.push(login);
      return communityRepo.findProfileIdentity(login);
    },
    async refreshAvatars(logins) {
      calls.avatars.push(logins.slice());
      return new Map(logins.map((login) => [login, VALID_AVATAR]));
    },
  };
  const app = makeApp({ enrichment });
  await withServer(app, async (baseUrl) => {
    const beforeAwards = achievementRepo.getEarned(userId).length;
    const pageResponse = await fetch(`${baseUrl}/users/visible_profile_viewer`);
    assert.equal(pageResponse.status, 200);
    const html = await pageResponse.text();
    assert.match(html, new RegExp(VALID_AVATAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, /15 дн\./);
    assert.match(html, /Первая неделя вместе/);
    assert.match(html, /Фоллоу с/);
    assert.deepEqual(calls.profiles, ['visible_profile_viewer']);
    assert.equal(achievementRepo.getEarned(userId).length, beforeAwards, 'rendering a profile does not create achievement events');

    const feedResponse = await fetch(`${baseUrl}/api/community/achievements`);
    assert.equal(feedResponse.status, 200);
    const feed = await feedResponse.json();
    assert.ok(feed.achievements.some((award) => award.login === 'visible_profile_viewer'
      && award.title === 'Первая неделя вместе' && award.avatarUrl === VALID_AVATAR));
    assert.ok(feed.achievements.some((award) => award.login === 'visible_profile_viewer'
      && award.title === 'Первый сигнал'));

    const leaderboardResponse = await fetch(`${baseUrl}/community?board=chat`);
    assert.equal(leaderboardResponse.status, 200);
    const leaderboardHtml = await leaderboardResponse.text();
    assert.match(leaderboardHtml, new RegExp(VALID_AVATAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(calls.avatars.some((logins) => logins.includes('visible_profile_viewer')));
    assert.equal(achievementRepo.getEarned(userId).length, beforeAwards, 'community/feed reads do not create duplicate unlock events');

    db.prepare('UPDATE community_user SET avatar_url = ? WHERE user_id = ?').run('javascript:alert(1)', userId);
    const unsafeAvatarResponse = await fetch(`${baseUrl}/users/visible_profile_viewer`);
    assert.equal(unsafeAvatarResponse.status, 200);
    const unsafeAvatarHtml = await unsafeAvatarResponse.text();
    assert.doesNotMatch(unsafeAvatarHtml, /src="javascript:alert\(1\)"/);
  });
});
