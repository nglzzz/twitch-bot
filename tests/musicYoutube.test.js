'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createYouTubeProvider,
  parseYouTubeInput,
  findYouTubeInText,
  getVideo,
  search,
  resolve,
  getPlaylistItems,
  getRating,
} = require('../src/music/providers/youtube.provider');

const VIDEO_ID = 'dQw4w9WgXcQ';
const MISSING_ID = 'aaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbbbbb';

function makeHttp({ post, get } = {}) {
  const calls = [];
  return {
    calls,
    async post(url, body, config) {
      calls.push({ method: 'post', url, body, config });
      if (!post) throw new Error('unexpected POST ' + url);
      return { data: await post(url, body) };
    },
    async get(url, config) {
      calls.push({ method: 'get', url, config });
      if (!get) throw new Error('unexpected GET ' + url);
      return { data: await get(url) };
    },
  };
}

function playerFixture(videoId, overrides = {}) {
  return {
    playabilityStatus: { status: 'UNPLAYABLE', reason: 'Sign in to confirm you are not a bot' },
    videoDetails: {
      videoId,
      title: 'Never Gonna Give You Up',
      author: 'Rick Astley',
      lengthSeconds: '213',
      viewCount: '1234567',
      keywords: ['Pop', ' pop ', 'Rick Astley', 'POP'],
      isLiveContent: false,
      thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/' + videoId + '/default.jpg' }] },
      ...overrides,
    },
    microformat: {
      playerMicroformatRenderer: {
        likeCount: '999',
        category: 'Music',
        isFamilySafe: true,
        embed: { iframeUrl: 'https://www.youtube.com/embed/' + videoId },
        isUnlisted: false,
      },
    },
  };
}

function searchResponse(items) {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] },
        },
      },
    },
  };
}

function videoRenderer(videoId, { live = false, title = 'Item ' + videoId } = {}) {
  const renderer = { videoId, title: { runs: [{ text: title }] } };
  if (!live) renderer.lengthText = { simpleText: '3:33' };
  return { videoRenderer: renderer };
}

function lockupItem(videoId, title) {
  return {
    lockupViewModel: {
      contentId: videoId,
      metadata: { lockupMetadataViewModel: { title: { content: title } } },
    },
  };
}

function playlistItemOld(videoId, title) {
  return { playlistVideoRenderer: { videoId, title: { runs: [{ text: title }] }, lengthSeconds: '213' } };
}

function continuationEndpoint(token) {
  return { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } };
}

function playlistPage(items, token) {
  const contents = items.slice();
  if (token) contents.push(continuationEndpoint(token));
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            selected: true,
            content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ playlistVideoListRenderer: { contents } }] } }] } },
          },
        }],
      },
    },
  };
}

function continuationResponse(items, token) {
  const continuationItems = items.slice();
  if (token) continuationItems.push(continuationEndpoint(token));
  return { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems } }] };
}

test('module exports factory, pure helpers and a default instance', () => {
  assert.equal(typeof createYouTubeProvider, 'function');
  assert.equal(typeof parseYouTubeInput, 'function');
  assert.equal(typeof findYouTubeInText, 'function');
  assert.equal(typeof getVideo, 'function');
  assert.equal(typeof search, 'function');
  assert.equal(typeof resolve, 'function');
  assert.equal(typeof getPlaylistItems, 'function');
  assert.equal(typeof getRating, 'function');
});

test('parseYouTubeInput handles URL forms, timestamps, playlists, bare ids and junk', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { type: 'video', id: VIDEO_ID, startSec: 0 }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', { type: 'video', id: VIDEO_ID, startSec: 90 }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90', { type: 'video', id: VIDEO_ID, startSec: 90 }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=90', { type: 'video', id: VIDEO_ID, startSec: 90 }],
    ['http://m.youtube.com/watch?v=dQw4w9WgXcQ', { type: 'video', id: VIDEO_ID, startSec: 0 }],
    ['music.youtube.com/watch?v=dQw4w9WgXcQ', { type: 'video', id: VIDEO_ID, startSec: 0 }],
    ['https://youtu.be/dQw4w9WgXcQ?t=45', { type: 'video', id: VIDEO_ID, startSec: 45 }],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', { type: 'video', id: VIDEO_ID, startSec: 0 }],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', { type: 'video', id: VIDEO_ID, startSec: 0 }],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', { type: 'video', id: VIDEO_ID, startSec: 0 }],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', { type: 'video', id: VIDEO_ID, startSec: 0 }],
    ['https://www.youtube.com/playlist?list=PLtest123456', { type: 'playlist', id: 'PLtest123456' }],
    ['https://www.youtube.com/watch?list=PLtest123456', { type: 'playlist', id: 'PLtest123456' }],
    ['dQw4w9WgXcQ', { type: 'video', id: VIDEO_ID, startSec: 0, bare: true }],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(parseYouTubeInput(input), expected);
  }

  assert.equal(parseYouTubeInput('hello world'), null);
  assert.equal(parseYouTubeInput('watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeInput('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeInput('notyoutube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeInput(''), null);
  assert.equal(parseYouTubeInput(null), null);
});

test('findYouTubeInText finds the first video URL inside a sentence', () => {
  const ru = 'зацени этот клип https://www.youtube.com/watch?v=dQw4w9WgXcQ прямо сейчас';
  assert.deepEqual(findYouTubeInText(ru), { type: 'video', id: VIDEO_ID, startSec: 0 });

  const short = 'смотри youtu.be/dQw4w9WgXcQ?t=1m30s потом обсудим';
  assert.deepEqual(findYouTubeInText(short), { type: 'video', id: VIDEO_ID, startSec: 90 });

  assert.equal(findYouTubeInText('просто текст, ссылок нет dQw4w9WgXcQ'), null);
  assert.equal(findYouTubeInText('глянь https://example.com/x'), null);
  assert.equal(findYouTubeInText(''), null);
});

test('getVideo maps innertube response to a track even when UNPLAYABLE', async () => {
  const http = makeHttp({ post: (url, body) => playerFixture(body.videoId) });
  const provider = createYouTubeProvider({ http, now: () => 1000 });

  const track = await provider.getVideo(VIDEO_ID);

  assert.equal(track.provider, 'youtube');
  assert.equal(track.externalId, VIDEO_ID);
  assert.equal(track.title, 'Never Gonna Give You Up');
  assert.equal(track.author, 'Rick Astley');
  assert.equal(track.durationSec, 213);
  assert.equal(track.viewCount, 1234567);
  assert.equal(track.likeCount, 999);
  assert.deepEqual(track.tags, ['pop', 'rick astley']);
  assert.equal(track.thumbnail, 'https://i.ytimg.com/vi/' + VIDEO_ID + '/hqdefault.jpg');
  assert.equal(track.isLive, false);
  assert.equal(track.url, 'https://www.youtube.com/watch?v=' + VIDEO_ID);

  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].config.timeout, 10000);
  assert.equal(http.calls[0].config.headers['Accept-Language'], 'ru');

  // Второй вызов берётся из кэша (тот же объект, без нового запроса).
  const cached = await provider.getVideo(VIDEO_ID);
  assert.equal(cached, track);
  assert.equal(http.calls.length, 1);
});

test('getVideo returns null when videoDetails is missing and caches the miss', async () => {
  const http = makeHttp({ post: () => ({ playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } }) });
  const provider = createYouTubeProvider({ http });

  assert.equal(await provider.getVideo(VIDEO_ID), null);
  assert.equal(await provider.getVideo(VIDEO_ID), null);
  assert.equal(http.calls.length, 1);
});

test('getVideo falls back to search results when YouTube asks to sign in', async () => {
  const http = makeHttp({
    post: (url, body) => {
      if (url.includes('/search')) {
        assert.equal(body.query, VIDEO_ID);
        const hit = videoRenderer(VIDEO_ID, { title: 'Ex Mashup' });
        hit.videoRenderer.lengthText = { simpleText: '1:04:45' };
        hit.videoRenderer.viewCountText = { simpleText: '563\u00a0845 просмотров' };
        hit.videoRenderer.ownerText = { runs: [{ text: 'MehDead' }] };
        return searchResponse([videoRenderer(OTHER_ID), hit]);
      }
      return { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you are not a bot' } };
    },
  });
  const provider = createYouTubeProvider({ http });

  const track = await provider.getVideo(VIDEO_ID);
  assert.equal(track.externalId, VIDEO_ID);
  assert.equal(track.title, 'Ex Mashup');
  assert.equal(track.author, 'MehDead');
  assert.equal(track.durationSec, 3885);
  assert.equal(track.viewCount, 563845);
  assert.equal(track.isLive, false);
  assert.deepEqual(track.tags, []);
  assert.equal(await provider.getVideo(VIDEO_ID), track);
  assert.equal(http.calls.length, 2);
});

test('after a sign-in check the player endpoint is skipped for a while', async () => {
  let clock = 0;
  const http = makeHttp({
    post: (url, body) => (url.includes('/search') ? searchResponse([videoRenderer(body.query)]) : { playabilityStatus: { status: 'LOGIN_REQUIRED' } }),
  });
  const provider = createYouTubeProvider({ http, now: () => clock });
  await provider.getVideo(VIDEO_ID);
  assert.equal((await provider.getVideo(OTHER_ID)).externalId, OTHER_ID);
  assert.equal(http.calls.filter((c) => c.url.includes('/player')).length, 1);
  clock += 31 * 60 * 1000;
  await provider.getVideo(MISSING_ID);
  assert.equal(http.calls.filter((c) => c.url.includes('/player')).length, 2);
});

test('getVideo search fallback uses the oEmbed title when the id search misses', async () => {
  const http = makeHttp({
    post: (url, body) => {
      if (url.includes('/search')) {
        return body.query === 'Unlisted Song' ? searchResponse([videoRenderer(VIDEO_ID)]) : searchResponse([videoRenderer(OTHER_ID)]);
      }
      return { playabilityStatus: { status: 'LOGIN_REQUIRED' } };
    },
    get: (url) => {
      assert.ok(url.startsWith('https://www.youtube.com/oembed?'));
      return { title: 'Unlisted Song' };
    },
  });
  const provider = createYouTubeProvider({ http });

  const track = await provider.getVideo(VIDEO_ID);
  assert.equal(track.externalId, VIDEO_ID);
  assert.equal(track.durationSec, 213);
});

test('search builds the track from the result when player is blocked', async () => {
  const http = makeHttp({
    post: (url) => (url.includes('/search') ? searchResponse([videoRenderer(VIDEO_ID, { title: 'Found' })]) : { playabilityStatus: { status: 'LOGIN_REQUIRED' } }),
  });
  const provider = createYouTubeProvider({ http });

  const track = await provider.search('found');
  assert.equal(track.externalId, VIDEO_ID);
  assert.equal(track.title, 'Found');
  assert.equal(track.durationSec, 213);
});

test('getVideo throws YOUTUBE_UNAVAILABLE only when the request fails', async () => {
  const http = makeHttp({ post: () => { throw new Error('ECONNRESET'); } });
  const provider = createYouTubeProvider({ http });

  await assert.rejects(
    () => provider.getVideo(VIDEO_ID),
    (error) => error.code === 'YOUTUBE_UNAVAILABLE'
  );
});

test('getVideo marks live content', async () => {
  const http = makeHttp({ post: (url, body) => playerFixture(body.videoId, { isLiveContent: true, lengthSeconds: '0' }) });
  const provider = createYouTubeProvider({ http });

  const track = await provider.getVideo(VIDEO_ID);
  assert.equal(track.isLive, true);
  assert.equal(track.durationSec, 0);
});

test('search skips live results and resolves the first regular video', async () => {
  const http = makeHttp({
    post: (url, body) => {
      if (url.includes('/search')) {
        assert.equal(body.query, 'never gonna give you up');
        assert.equal(body.params, 'EgIQAQ%3D%3D');
        return searchResponse([
          videoRenderer(MISSING_ID, { live: true, title: 'Live Stream' }),
          videoRenderer(VIDEO_ID, { title: 'Official Video' }),
        ]);
      }
      return playerFixture(body.videoId);
    },
  });
  const provider = createYouTubeProvider({ http });

  const track = await provider.search('never gonna give you up');

  assert.equal(track.externalId, VIDEO_ID);
  assert.equal(track.title, 'Never Gonna Give You Up');
  // getVideo вызван только для обычного видео, стрим пропущен.
  assert.equal(http.calls.filter((c) => c.url.includes('/player')).length, 1);
});

test('resolve falls back to search for bare ids that do not exist', async () => {
  const http = makeHttp({
    post: (url, body) => {
      if (url.includes('/search')) return searchResponse([videoRenderer(VIDEO_ID)]);
      if (body.videoId === MISSING_ID) return { playabilityStatus: { status: 'ERROR' } };
      return playerFixture(body.videoId);
    },
  });
  const provider = createYouTubeProvider({ http });

  const result = await provider.resolve(MISSING_ID);

  assert.equal(result.track.externalId, VIDEO_ID);
  assert.equal(result.startSec, 0);
  assert.ok(http.calls.some((c) => c.method === 'post' && c.url.includes('/search') && c.body.query === MISSING_ID));
});

test('resolve returns startSec for timestamped URLs and null for playlists', async () => {
  const http = makeHttp({
    post: (url, body) => {
      if (url.includes('/search')) return searchResponse([videoRenderer(VIDEO_ID)]);
      return playerFixture(body.videoId);
    },
  });
  const provider = createYouTubeProvider({ http });

  const result = await provider.resolve('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s');
  assert.equal(result.startSec, 90);
  assert.equal(result.track.externalId, VIDEO_ID);

  assert.equal(await provider.resolve('https://www.youtube.com/playlist?list=PLtest123456'), null);
});

test('resolve searches free text', async () => {
  const http = makeHttp({
    post: (url, body) => {
      if (url.includes('/search')) return searchResponse([videoRenderer(VIDEO_ID)]);
      return playerFixture(body.videoId);
    },
  });
  const provider = createYouTubeProvider({ http });

  const result = await provider.resolve('  never gonna give you up  ');
  assert.equal(result.track.externalId, VIDEO_ID);
  assert.equal(result.startSec, 0);
});

test('getPlaylistItems walks lockupViewModel, continuations and old format', async () => {
  const posts = [];
  const http = makeHttp({
    post: (url, body) => {
      posts.push(body);
      if (body.continuation) {
        assert.equal(body.continuation, 'TOKEN1');
        return continuationResponse([
          playlistItemOld(OTHER_ID, 'Old Format Item'),
          lockupItem(MISSING_ID, 'Duplicate should be skipped'),
        ]);
      }
      assert.equal(body.browseId, 'VLPLtest123456');
      return playlistPage([
        lockupItem(MISSING_ID, 'First'),
        lockupItem(VIDEO_ID, 'Second'),
      ], 'TOKEN1');
    },
  });
  const provider = createYouTubeProvider({ http });

  const items = await provider.getPlaylistItems('https://www.youtube.com/playlist?list=PLtest123456');

  assert.deepEqual(items, [
    { externalId: MISSING_ID, title: 'First' },
    { externalId: VIDEO_ID, title: 'Second' },
    { externalId: OTHER_ID, title: 'Old Format Item' },
  ]);
  assert.equal(posts.length, 2);
});

test('getPlaylistItems respects max and accepts raw playlist ids', async () => {
  const http = makeHttp({
    post: (url, body) => playlistPage([
      lockupItem(MISSING_ID, 'First'),
      lockupItem(VIDEO_ID, 'Second'),
      lockupItem(OTHER_ID, 'Third'),
    ], 'TOKEN2'),
  });
  const provider = createYouTubeProvider({ http });

  const items = await provider.getPlaylistItems('PLtest123456', { max: 2 });

  assert.deepEqual(items.map((i) => i.externalId), [MISSING_ID, VIDEO_ID]);
  // Дошли до лимита — continuation не запрашиваем.
  assert.equal(http.calls.length, 1);
});

test('search and getPlaylistItems do not throw on network failure', async () => {
  const http = makeHttp({ post: () => { throw new Error('socket hang up'); } });
  const provider = createYouTubeProvider({ http });

  assert.equal(await provider.search('anything'), null);
  assert.deepEqual(await provider.getPlaylistItems('PLtest123456'), []);
  assert.deepEqual(await provider.getPlaylistItems('not a valid /// input'), []);
});

test('getRating computes percent, handles zero votes, caches and fails soft', async () => {
  const votes = {
    [VIDEO_ID]: { likes: 80, dislikes: 20, viewCount: 100, rating: 4 },
    [OTHER_ID]: { likes: 0, dislikes: 0, viewCount: 5, rating: 0 },
  };
  let failNext = false;
  const http = makeHttp({
    get: (url) => {
      if (failNext) throw new Error('timeout');
      const id = url.slice(-VIDEO_ID.length);
      return votes[id];
    },
  });
  const provider = createYouTubeProvider({ http, now: () => 1000 });

  assert.deepEqual(await provider.getRating(VIDEO_ID), { likes: 80, dislikes: 20, percent: 80 });
  assert.deepEqual(await provider.getRating(VIDEO_ID), { likes: 80, dislikes: 20, percent: 80 });
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].url, 'https://returnyoutubedislikeapi.com/votes?videoId=' + VIDEO_ID);
  assert.equal(http.calls[0].config.timeout, 4000);

  // Оба нуля -> percent: null.
  assert.deepEqual(await provider.getRating(OTHER_ID), { likes: 0, dislikes: 0, percent: null });

  failNext = true;
  assert.equal(await provider.getRating('ccccccccccc'), null);
});
