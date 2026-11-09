'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const profile = require('../src/commands/profile');

test('!профиль links to the chatter profile, or to the mentioned one', async () => {
  const tags = { username: 'vasya_pupkin', 'display-name': 'Vasya_Pupkin' };
  assert.match(await profile('#nglzzz', tags, '!профиль'), /^@Vasya_Pupkin, твой профиль и достижения: https?:\/\/\S+\/users\/vasya_pupkin$/);
  assert.match(await profile('#nglzzz', tags, '!profile @Some_Friend'), /профиль some_friend: \S+\/users\/some_friend$/);
  // мусор вместо ника — свой профиль
  assert.match(await profile('#nglzzz', tags, '!profile <script>'), /\/users\/vasya_pupkin$/);
});
