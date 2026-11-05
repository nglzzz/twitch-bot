'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('chat logger records real chat identities once and excludes commands, self, and bots', async () => {
  const loggerPath = require.resolve('../src/chat/logger');
  const dependencyPaths = {
    db: require.resolve('../src/app/db'),
    chat: require.resolve('../src/app/chat'),
    community: require.resolve('../src/repositories/community.repo'),
    paidSubscriptions: require.resolve('../src/repositories/communityPaidSubscriptions.repo'),
    tracker: require.resolve('../src/services/streamTracker.service'),
    config: require.resolve('../src/config'),
  };
  const originals = new Map([loggerPath, ...Object.values(dependencyPaths)].map((filename) => [filename, require.cache[filename]]));
  let listener;
  let ready = true;
  let failLink = false;
  const recorded = [];
  const recordedSubscriptions = [];
  const dependencies = {
    db: { isDbReady: () => ready },
    chat: { getClient: () => ({ on: (event, callback) => { assert.equal(event, 'message'); listener = callback; } }) },
    community: { recordChat: (event) => recorded.push(event) },
    paidSubscriptions: { recordTwitchSubscription: (event) => recordedSubscriptions.push(event) },
    tracker: { linkMessageToStream: async () => {
      if (failLink) throw new Error('stream unavailable');
      return 'stream-session';
    } },
    config: { BOT_NAME: 'our_bot' },
  };

  try {
    delete require.cache[loggerPath];
    for (const [name, filename] of Object.entries(dependencyPaths)) {
      require.cache[filename] = { id: filename, filename, loaded: true, exports: dependencies[name] };
    }
    require(loggerPath);
    const tags = { username: 'Real_Viewer', 'user-id': 'twitch-id', 'display-name': 'Real Viewer', id: 'irc-id', subscriber: '1' };
    await listener('#channel', tags, 'Привет!', false);
    assert.equal(recorded.length, 1);
    assert.deepEqual({ ...recorded[0], createdAt: 0 }, {
      userId: 'twitch-id', username: 'real_viewer', displayName: 'Real Viewer', message: 'Привет!',
      messageId: 'irc-id', streamSessionId: 'stream-session', createdAt: 0,
    });
    assert.ok(Number.isFinite(recorded[0].createdAt));
    assert.equal(recordedSubscriptions.length, 1);
    assert.deepEqual({ ...recordedSubscriptions[0], confirmedAt: 0 }, {
      userId: 'twitch-id', username: 'real_viewer', displayName: 'Real Viewer', confirmedAt: 0,
      identityAlreadyPrepared: true,
    });

    await listener('#channel', tags, '!в очки', false);
    await listener('#channel', tags, 'Сообщение бота', true);
    await listener('#channel', { username: 'Nightbot' }, 'Auto message', false);
    await listener('#channel', { username: 'OUR_BOT' }, 'Auto message', false);
    await listener('#channel', {}, 'Нет имени', false);
    await listener('#channel', tags, '', false);
    ready = false;
    await listener('#channel', tags, 'База недоступна', false);
    assert.equal(recorded.length, 1);

    ready = true;
    failLink = true;
    await listener('#channel', { ...tags, id: 'offline-id' }, 'Вне эфира', false);
    assert.equal(recorded.length, 2);
    assert.equal(recorded[1].streamSessionId, null);
  } finally {
    for (const [filename, original] of originals) {
      if (original) require.cache[filename] = original;
      else delete require.cache[filename];
    }
  }
});
