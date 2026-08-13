'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  buildEmoteMap,
  renderMessageHtml,
} = require('../src/helpers/emoteHelper');

test('renderMessageHtml replaces emotes and escapes message HTML', () => {
  const emoteMap = buildEmoteMap([{
    name: 'OMEGALUL',
    url: 'https://cdn.example/emote.webp',
    provider: '7tv',
  }]);

  const html = renderMessageHtml('<script>alert(1)</script> OMEGALUL', emoteMap);

  assert.match(html, /^&lt;script&gt;alert\(1\)&lt;\/script&gt; /);
  assert.match(html, /<img class="chat-emote"/);
  assert.match(html, /title="OMEGALUL · 7TV"/);
  assert.doesNotMatch(html, /<script>/);
});
