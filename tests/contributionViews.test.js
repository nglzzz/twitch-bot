'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const handlebars = require('express-handlebars');
const { after, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-contributions-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'community.sqlite');

const db = require('../src/app/db');
const communityRepo = require('../src/repositories/community.repo');
const contributionsRepo = require('../src/repositories/communityContributions.repo');
const communityService = require('../src/services/community.service');
const achievementData = require('../src/data/achievements');
const { createCommunityAdminRouter } = require('../src/webserver/communityAdmin.routes');
const { createCommunityRouter } = require('../src/webserver/community.routes');
const Handlebars = require('handlebars').create();

const ADMIN_COOKIE = 'community-test-session=valid';
const CSRF_TOKEN = 'csrf-test-token-123';
const PROFILE_USER_ID = 'profile-twitch-user-101';
const PRIVATE_SOURCE_IDS = [
  PROFILE_USER_ID,
  'private-redemption-event-id',
  'private-meme-event-id',
  'private-donation-provider-id',
  'private-donation-external-id',
];
const VIEWS = path.resolve(__dirname, '../src/views');

function makeAdminApp({ repository, community, boostyCommunity = {
  getActiveSubscribers: async () => [],
  linkActiveSubscriber: async () => false,
}, authorize = true } = {}) {
  const app = express();
  app.engine('handlebars', handlebars({ defaultLayout: false }));
  app.set('view engine', 'handlebars');
  app.set('views', VIEWS);
  const requireAdmin = (req, res, next) => {
    if (!authorize || req.get('cookie') !== ADMIN_COOKIE) return res.redirect('/admin/login');
    req.adminUser = { _id: 'admin-test-id', displayName: 'Test admin' };
    res.locals.adminUser = req.adminUser;
    res.locals.csrfToken = CSRF_TOKEN;
    return next();
  };
  const requireCsrf = (req, res, next) => {
    if (req.body?._csrf !== CSRF_TOKEN) return res.status(403).send('Invalid CSRF token');
    return next();
  };

  app.use(createCommunityAdminRouter({
    requireAdmin,
    requireCsrf,
    navigation: () => [],
    repository,
    community,
    boostyCommunity,
  }));
  return app;
}

function makeProfileApp(service = communityService) {
  const app = express();
  app.engine('handlebars', handlebars({
    defaultLayout: false,
    helpers: {
      or(...values) { return values.slice(0, -1).some(Boolean); },
    },
  }));
  app.set('view engine', 'handlebars');
  app.set('views', VIEWS);
  app.use(createCommunityRouter({ service, isReady: db.isDbReady, navigation: () => [] }));
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

function form(fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  return body.toString();
}

function seedProfileContributions() {
  const now = Date.now();
  communityRepo.prepareUserForEvent({
    userId: PROFILE_USER_ID,
    username: 'profile_viewer',
    displayName: 'Profile Viewer <img src=x onerror=alert(1)>',
  }, now);

  contributionsRepo.recordRedemption({
    id: PRIVATE_SOURCE_IDS[1],
    userId: PROFILE_USER_ID,
    username: 'profile_viewer',
    displayName: 'Profile Viewer',
    cost: 4500,
    rewardId: 'private-reward-id',
    status: 'fulfilled',
    redeemedAt: now - 60_000,
  });

  const insertMeme = db.prepare(`INSERT INTO meme_log
    (id, event_id, user, user_alias, sticker_name, kind, sent_at, community_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertMeme.run('meme-row-1', PRIVATE_SOURCE_IDS[2], 'profile_viewer', 'Profile Viewer', 'sticker-a',
    'sticker-sent', now - 30_000, PROFILE_USER_ID, now, now);
  insertMeme.run('meme-row-2', PRIVATE_SOURCE_IDS[2], 'profile_viewer', 'Profile Viewer', 'sticker-b',
    'sticker-sent', now - 20_000, PROFILE_USER_ID, now, now);

  db.prepare(`INSERT INTO donation
    (id, source, is_test, external_id, donor_name, donor_id, amount, currency, status,
      community_user_id, created_at, updated_at)
    VALUES (?, 'donationalerts', 0, ?, ?, ?, 5, 'RUB', 'failed', ?, ?, ?)`)
    .run('donation-row-1', PRIVATE_SOURCE_IDS[4], 'Profile Viewer', PRIVATE_SOURCE_IDS[3],
      PROFILE_USER_ID, now - 10_000, now);
}

after(() => {
  if (db.open) db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('community admin page requires an authenticated session', async () => {
  const repository = { listUnassigned: () => [], assignSupportRecord: () => assert.fail('should not assign') };
  const community = { normalizeLogin: () => null, findProfileIdentity: () => null };
  await withServer(makeAdminApp({ repository, community }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/community-events`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin/login');
  });
});

test('support links require valid admin authentication and an exact CSRF token', async () => {
  const calls = [];
  const repository = { listUnassigned: () => [], assignSupportRecord: (input) => calls.push(input) };
  const community = {
    normalizeLogin: (login) => String(login || '').trim().replace(/^@/, '').toLowerCase(),
    findProfileIdentity: (login) => login === 'alice' ? { userId: 'twitch-user-42', displayName: 'Alice Display' } : null,
  };

  await withServer(makeAdminApp({ repository, community }), async (baseUrl) => {
    const post = (fields, cookie = ADMIN_COOKIE) => fetch(`${baseUrl}/admin/community-events/link`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? { cookie } : {}),
      },
      body: form(fields),
    });

    const anonymous = await post({ _csrf: CSRF_TOKEN, kind: 'meme', recordId: 'm-1', twitchLogin: 'alice' }, '');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/admin/login');

    const missing = await post({ kind: 'meme', recordId: 'm-1', twitchLogin: 'alice' });
    assert.equal(missing.status, 403);
    const wrong = await post({ _csrf: 'wrong-token', kind: 'meme', recordId: 'm-1', twitchLogin: 'alice' });
    assert.equal(wrong.status, 403);
    assert.deepEqual(calls, []);

    const valid = await post({ _csrf: CSRF_TOKEN, kind: 'meme', recordId: 'meme-record-17', twitchLogin: '@Alice' });
    assert.equal(valid.status, 302);
    assert.match(valid.headers.get('location'), /success=/);
    assert.deepEqual(calls, [{
      kind: 'meme',
      recordId: 'meme-record-17',
      userId: 'twitch-user-42',
      adminId: 'admin-test-id',
      historical: true,
    }]);
  });
});

test('support linking rejects malformed fields, unknown profiles, and legacy identities without Twitch IDs', async () => {
  const calls = [];
  const lookups = [];
  const repository = { listUnassigned: () => [], assignSupportRecord: (input) => calls.push(input) };
  const community = {
    normalizeLogin: (login) => {
      if (typeof login !== 'string') return null;
      const value = login.trim().replace(/^@/, '').toLowerCase();
      return /^[a-z0-9_]{1,25}$/.test(value) ? value : null;
    },
    findProfileIdentity: (login) => {
      lookups.push(login);
      if (login === 'known_viewer') return { userId: 'confirmed-twitch-id', displayName: 'Known Viewer' };
      if (login === 'legacy_viewer') return { userId: null, displayName: 'Legacy Viewer' };
      return null;
    },
  };

  await withServer(makeAdminApp({ repository, community }), async (baseUrl) => {
    const post = (fields) => fetch(`${baseUrl}/admin/community-events/link`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: ADMIN_COOKIE, 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: CSRF_TOKEN, ...fields }),
    });

    for (const fields of [
      { kind: 'membership', recordId: 'record-1', twitchLogin: 'known_viewer' },
      { kind: 'meme', recordId: '', twitchLogin: 'known_viewer' },
      { kind: 'meme', recordId: 'x'.repeat(129), twitchLogin: 'known_viewer' },
      { kind: ['meme', 'donation'], recordId: 'record-1', twitchLogin: 'known_viewer' },
      { kind: 'meme', recordId: ['record-1', 'record-2'], twitchLogin: 'known_viewer' },
      { kind: 'meme', recordId: 'record-1', twitchLogin: ['known_viewer', 'legacy_viewer'] },
      { kind: 'donation', recordId: 'unknown-donation', twitchLogin: 'missing_viewer' },
      { kind: 'donation', recordId: 'legacy-donation', twitchLogin: 'legacy_viewer' },
    ]) {
      const response = await post(fields);
      assert.equal(response.status, 302);
      assert.match(response.headers.get('location'), /error=/);
    }

    assert.deepEqual(calls, []);
    assert.deepEqual(lookups, ['missing_viewer', 'legacy_viewer']);
  });
});

test('unassigned event names are never auto-linked to a Twitch profile by display-name match', async () => {
  const calls = [];
  const lookups = [];
  const repository = {
    listUnassigned: ({ kind }) => kind === 'donation' ? [{ recordId: 'donation-1', displayName: 'alice', title: '5 RUB', eventAt: Date.now() }] : [],
    assignSupportRecord: (input) => calls.push(input),
  };
  const community = {
    normalizeLogin: (login) => typeof login === 'string' && /^[a-z0-9_]{1,25}$/i.test(login) ? login.toLowerCase() : null,
    findProfileIdentity: (login) => {
      lookups.push(login);
      return login === 'alice' ? { userId: 'real-alice-twitch-id', displayName: 'Alice' } : null;
    },
  };

  await withServer(makeAdminApp({ repository, community }), async (baseUrl) => {
    const get = await fetch(`${baseUrl}/admin/community-events`, { headers: { cookie: ADMIN_COOKIE } });
    assert.equal(get.status, 200);
    const html = await get.text();
    assert.match(html, /Отправитель в источнике: alice/);
    assert.match(html, /name="_csrf" value="csrf-test-token-123"/);
    assert.match(html, /name="recordId" value="donation-1"/);

    const response = await fetch(`${baseUrl}/admin/community-events/link`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: ADMIN_COOKIE, 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: CSRF_TOKEN, kind: 'donation', recordId: 'donation-1' }),
    });
    assert.equal(response.status, 302);
    assert.deepEqual(lookups, []);
    assert.deepEqual(calls, []);
  });
});

test('Boosty links require an authenticated admin, valid CSRF, existing Twitch ID, and manual exact-ID confirmation', async () => {
  const links = [];
  const lookups = [];
  const community = {
    normalizeLogin: (login) => typeof login === 'string' && /^[a-z0-9_]{1,25}$/i.test(login) ? login.toLowerCase() : null,
    findProfileIdentity: (login) => {
      lookups.push(login);
      return login === 'alice' ? { userId: 'twitch-user-42', username: 'alice', displayName: 'Alice' } : null;
    },
  };
  const boostyCommunity = {
    getActiveSubscribers: async () => [{ id: 'boosty-123', name: 'Alice on Boosty' }],
    linkActiveSubscriber: async (link) => { links.push(link); },
  };

  await withServer(makeAdminApp({ community, boostyCommunity }), async (baseUrl) => {
    const page = await fetch(`${baseUrl}/admin/community-events`, { headers: { cookie: ADMIN_COOKIE } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /name="subscriberId"/);
    assert.match(html, /value="boosty-123">Alice on Boosty · ID boosty-123/);
    assert.match(html, /name="_csrf" value="csrf-test-token-123"/);
    assert.deepEqual(lookups, [], 'listing Boosty subscribers does not auto-match Twitch names');

    const post = (fields, cookie = ADMIN_COOKIE) => fetch(`${baseUrl}/admin/community-events/link-boosty`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
      body: form(fields),
    });
    assert.equal((await post({ _csrf: CSRF_TOKEN, subscriberId: 'boosty-123', twitchLogin: 'alice' }, '')).status, 302);
    assert.equal((await post({ subscriberId: 'boosty-123', twitchLogin: 'alice' })).status, 403);
    assert.equal((await post({ _csrf: CSRF_TOKEN, subscriberId: 'boosty-123', twitchLogin: 'missing' })).status, 302);
    assert.equal((await post({ _csrf: CSRF_TOKEN, subscriberId: ['boosty-123', 'boosty-456'], twitchLogin: 'alice' })).status, 302);
    assert.equal((await post({ _csrf: CSRF_TOKEN, subscriberId: 'boosty-123', twitchLogin: 'alice' })).status, 302);
    assert.deepEqual(lookups, ['missing', 'alice']);
    assert.deepEqual(links, [{
      userId: 'twitch-user-42', username: 'alice', displayName: 'Alice',
      subscriberId: 'boosty-123', adminId: 'admin-test-id',
    }]);
  });
});

test('admin community-event template escapes names and status and preserves exact CSRF and record IDs', () => {
  const template = fs.readFileSync(path.join(VIEWS, 'pages/admin-community-events.handlebars'), 'utf8');
  const render = Handlebars.compile(template);
  const csrf = 'csrf-exact-value-456';
  const displayName = '<img src=x onerror=alert(1)>';
  const statusLabel = '<script>doNotRun()</script>';
  const html = render({
    csrfToken: csrf,
    hasMemeEvents: true,
    hasDonationEvents: false,
    memeEvents: [{ id: 'record-id-exact-1', title: 'Sticker', displayName, statusLabel, createdAtLabel: 'Сегодня' }],
  });

  assert.match(html, /name="_csrf" value="csrf-exact-value-456"/);
  assert.match(html, /name="recordId" value="record-id-exact-1"/);
  assert.match(html, /&lt;img src&#x3D;x onerror&#x3D;alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;doNotRun\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<script>doNotRun\(\)<\/script>/);
});

test('profile service returns private contribution totals without exposing external source IDs', async () => {
  seedProfileContributions();
  const profile = communityService.getProfile('PROFILE_VIEWER');
  assert.ok(profile);
  assert.equal(profile.achievements.length, 51);
  assert.equal(profile.contributions.pointsSpent, 4500);
  assert.equal(profile.contributions.memesSent, 1);
  assert.equal(profile.contributions.donationsCount, 1);
  assert.equal(profile.contributions.pointsBalance, null);
  assert.equal(profile.contributions.hasPointsBalance, false);

  const serialized = JSON.stringify(profile);
  for (const sourceId of PRIVATE_SOURCE_IDS) assert.doesNotMatch(serialized, new RegExp(sourceId));
  assert.doesNotMatch(serialized, /private-reward-id/);
  assert.doesNotMatch(serialized, /community_user_id|external_id|donor_id/i);

  await withServer(makeProfileApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users/profile_viewer`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Накоплено баллов<\/small><strong>Недоступно<\/strong>/);
    assert.doesNotMatch(html, /Накоплено баллов<\/small><strong>0<\/strong>/);
    assert.match(html, /Баллов на выполненные награды<\/small><strong>4500<\/strong>/);
    assert.match(html, /Мемов подтверждено<\/small><strong>1<\/strong>/);
    assert.match(html, /Донатов подтверждено<\/small><strong>1<\/strong>/);
    assert.match(html, /открыто/);
    for (const sourceId of PRIVATE_SOURCE_IDS) assert.doesNotMatch(html, new RegExp(sourceId));
    assert.doesNotMatch(html, /private-reward-id|community_user_id|external_id|donor_id/i);
  });
});

test('public profile template renders the full achievement and contribution view model safely', () => {
  const profile = communityService.getProfile('profile_viewer');
  const template = fs.readFileSync(path.join(VIEWS, 'pages/user-profile.handlebars'), 'utf8');
  Handlebars.registerHelper('or', (...values) => values.slice(0, -1).some(Boolean));
  const render = Handlebars.compile(template);
  const html = render({ userProfile: { ...profile, available: true, found: true } });

  assert.equal(profile.achievements.length, achievementData.length);
  assert.equal(profile.achievements.length, 51);
  assert.match(html, /Первые 1 000 в дело/);
  assert.match(html, /Накоплено баллов<\/small><strong>Недоступно<\/strong>/);
  assert.match(html, /Баллов на выполненные награды<\/small><strong>4500<\/strong>/);
  assert.match(html, /Мемов подтверждено<\/small><strong>1<\/strong>/);
  assert.match(html, /Донатов подтверждено<\/small><strong>1<\/strong>/);
  assert.match(html, /&lt;img src&#x3D;x onerror&#x3D;alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  for (const sourceId of PRIVATE_SOURCE_IDS) assert.doesNotMatch(html, new RegExp(sourceId));
});


test('community events page opens the first tab with pending items and keeps the tab after linking', async () => {
  const repository = {
    listUnassigned: ({ kind }) => kind === 'meme' ? [{ recordId: 'meme-1', displayName: 'alice', title: 'Sticker', eventAt: Date.now() }] : [],
    assignSupportRecord: () => {},
  };
  const community = {
    normalizeLogin: (login) => typeof login === 'string' && /^[a-z0-9_]{1,25}$/i.test(login) ? login.toLowerCase() : null,
    findProfileIdentity: (login) => (login === 'alice' ? { userId: 'alice-id' } : null),
  };
  const panelHidden = (html, tab) => new RegExp(`data-panel="${tab}"\\s+hidden`).test(html);

  await withServer(makeAdminApp({ repository, community }), async (baseUrl) => {
    const auto = await (await fetch(`${baseUrl}/admin/community-events`, { headers: { cookie: ADMIN_COOKIE } })).text();
    assert.equal(panelHidden(auto, 'memes'), false);
    assert.equal(panelHidden(auto, 'donations'), true);
    assert.equal(panelHidden(auto, 'boosty'), true);
    assert.match(auto, /id="events-tab-memes"[^>]*aria-selected="true"/);

    const chosen = await (await fetch(`${baseUrl}/admin/community-events?tab=boosty`, { headers: { cookie: ADMIN_COOKIE } })).text();
    assert.equal(panelHidden(chosen, 'boosty'), false);
    assert.equal(panelHidden(chosen, 'memes'), true);

    const invalid = await (await fetch(`${baseUrl}/admin/community-events?tab=<x>`, { headers: { cookie: ADMIN_COOKIE } })).text();
    assert.equal(panelHidden(invalid, 'memes'), false);

    const post = (fields) => fetch(`${baseUrl}/admin/community-events/link`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: ADMIN_COOKIE, 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: CSRF_TOKEN, ...fields }),
    });
    const linked = await post({ kind: 'meme', recordId: 'meme-1', twitchLogin: 'alice' });
    assert.match(linked.headers.get('location'), /^\/admin\/community-events\?tab=memes&success=/);
    const failed = await post({ kind: 'donation', recordId: 'donation-1', twitchLogin: 'nobody' });
    assert.match(failed.headers.get('location'), /^\/admin\/community-events\?tab=donations&error=/);
  });
});
