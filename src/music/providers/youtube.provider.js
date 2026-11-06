'use strict';

// Провайдер YouTube для заказа музыки. Работает через внутренний API innertube
// (без ключа): player — метаданные видео, search — поиск, browse — плейлисты.
// Оценки (лайки/дизлайки) — Return YouTube Dislike.

const axios = require('axios');

const INNERTUBE_CONTEXT = {
  client: { clientName: 'WEB', clientVersion: '2.20251101.00.00', hl: 'ru', gl: 'RU' },
};
const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const SEARCH_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const BROWSE_URL = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
const OEMBED_URL = 'https://www.youtube.com/oembed?format=json&url=';
const RYD_URL = 'https://returnyoutubedislikeapi.com/votes?videoId=';
const SEARCH_PARAMS = 'EgIQAQ%3D%3D'; // фильтр «только видео»
const RATING_TIMEOUT_MS = 4000;
const CACHE_MAX_ENTRIES = 500;
const BROWSE_MAX_PAGES = 20;
const PLAYER_BACKOFF_MS = 30 * 60 * 1000;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{2,}$/;
const VIDEO_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v']);
// Домен YouTube с опциональными схемой/поддоменом; граница слева, чтобы
// не матчить «notyoutube.com».
const YT_URL_RE = /(?<![A-Za-z0-9.-])(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)*(?:youtube\.com|youtu\.be|youtube-nocookie\.com)(?:\/[^\s]*)?/i;
const YT_URL_IN_TEXT_RE = /(?<![A-Za-z0-9.-])(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)*(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/[^\s<>"']+/gi;

function parseTimeParam(value) {
  if (typeof value !== 'string' || !value) return 0;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  let total = 0;
  let matched = false;
  const re = /(\d+)(h|m|s)/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    matched = true;
    total += parseInt(m[1], 10) * (m[2] === 'h' ? 3600 : m[2] === 'm' ? 60 : 1);
  }
  return matched ? total : 0;
}

function parseStartSec(params) {
  return parseTimeParam(params.get('t') || params.get('start') || '');
}

function toUrlObject(candidate) {
  let s = candidate;
  if (s.startsWith('//')) s = 'https:' + s;
  else if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    return new URL(s);
  } catch (_) {
    return null;
  }
}

function isYouTubeHost(host) {
  return host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube.com') || host.endsWith('.youtube-nocookie.com');
}

// Разбирает ввод: URL видео (с таймкодом), URL плейлиста или «голый» 11-символьный id.
function parseYouTubeInput(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return { type: 'video', id: raw, startSec: 0, bare: true };

  const match = raw.match(YT_URL_RE);
  if (!match) return null;
  const url = toUrlObject(match[0]);
  if (!url || !isYouTubeHost(url.hostname.toLowerCase())) return null;

  const params = url.searchParams;
  const segments = url.pathname.split('/').filter(Boolean);

  let videoId = null;
  if (url.hostname.toLowerCase() === 'youtu.be') {
    const id = segments[0] || '';
    if (VIDEO_ID_RE.test(id)) videoId = id;
  } else if (segments[0] === 'watch') {
    const v = params.get('v');
    if (v && VIDEO_ID_RE.test(v)) videoId = v;
  } else if (VIDEO_PATH_PREFIXES.has(segments[0])) {
    const id = segments[1] || '';
    if (VIDEO_ID_RE.test(id)) videoId = id;
  }

  if (videoId) return { type: 'video', id: videoId, startSec: parseStartSec(params) };

  const list = params.get('list');
  if (list && PLAYLIST_ID_RE.test(list)) return { type: 'playlist', id: list };

  return null;
}

// Ищет первый URL видео YouTube в произвольном тексте («голые» id не матчатся).
function findYouTubeInText(text) {
  if (typeof text !== 'string') return null;
  YT_URL_IN_TEXT_RE.lastIndex = 0;
  let match;
  while ((match = YT_URL_IN_TEXT_RE.exec(text)) !== null) {
    const candidate = match[0].replace(/[.,;:!?]+$/, '');
    const parsed = parseYouTubeInput(candidate);
    if (parsed) return parsed;
  }
  return null;
}

// Обходит дерево JSON и собирает значения по ключу в порядке появления.
function collectByKey(node, key, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectByKey(item, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(v);
    else collectByKey(v, key, out);
  }
  return out;
}

// В новом формате continuationCommand вложен сам в себя
// (continuationCommand.innertubeCommand.continuationCommand.token), поэтому
// ищем первый объект с token на любой глубине.
function findContinuationToken(data) {
  for (const cmd of collectByKey(data, 'continuationCommand')) {
    if (cmd && typeof cmd.token === 'string' && cmd.token) return cmd.token;
    const nested = findContinuationToken(cmd && cmd.innertubeCommand);
    if (nested) return nested;
  }
  return null;
}

function extractPlaylistId(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  const match = raw.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  if (PLAYLIST_ID_RE.test(raw)) return raw;
  return null;
}

function toCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return parseInt(value, 10);
  return null;
}

// Текст YouTube-выдачи: «4:45» / «1:02:03» -> секунды.
function parseClock(text) {
  if (typeof text !== 'string' || !/^\d+(?::\d{1,2}){0,2}$/.test(text.trim())) return 0;
  return text.trim().split(':').reduce((acc, part) => acc * 60 + parseInt(part, 10), 0);
}

function rendererText(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r) => (r && r.text) || '').join('');
  return '';
}

// Трек из videoRenderer поисковой выдачи (без тегов и лайков — их там нет).
function trackFromRenderer(renderer) {
  const id = renderer && renderer.videoId;
  if (!id || !VIDEO_ID_RE.test(id)) return null;
  const durationSec = parseClock(rendererText(renderer.lengthText));
  const viewsText = rendererText(renderer.viewCountText);
  const viewDigits = viewsText.replace(/\D+/g, '');
  return {
    provider: 'youtube',
    externalId: id,
    title: rendererText(renderer.title),
    author: rendererText(renderer.ownerText) || rendererText(renderer.longBylineText),
    durationSec,
    viewCount: viewDigits ? parseInt(viewDigits, 10) : (viewsText ? 0 : null),
    likeCount: null,
    tags: [],
    thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
    isLive: durationSec === 0,
    url: 'https://www.youtube.com/watch?v=' + id,
  };
}

function createYouTubeProvider({ http = axios, now = Date.now, cacheTtlMs = 10 * 60 * 1000 } = {}) {
  const videoCache = new Map();
  // После «войдите, чтобы подтвердить, что вы не бот» не дёргаем player какое-то время:
  // лишние анонимные запросы с того же IP только усиливают проверку.
  let playerBlockedUntil = 0;
  const ratingCache = new Map();

  function cacheGet(cache, key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (now() > entry.expiresAt) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key); // LRU: обновляем позицию
    cache.set(key, entry);
    return entry.value;
  }

  function cacheSet(cache, key, value) {
    cache.set(key, { value, expiresAt: now() + cacheTtlMs });
    if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }

  function innertubeOptions() {
    return {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'ru' },
    };
  }

  // Трек из ответа player. Если videoDetails нет — null (status нужен, чтобы
  // отличить удалённое видео от проверки «подтвердите, что вы не бот»).
  async function fetchPlayer(id) {
    if (now() < playerBlockedUntil) return { track: null, status: 'LOGIN_REQUIRED' };
    let data;
    try {
      const res = await http.post(PLAYER_URL, { context: INNERTUBE_CONTEXT, videoId: id }, innertubeOptions());
      data = res.data;
    } catch (error) {
      console.warn('[Music/YouTube] player request failed for ' + id + ':', error && error.message);
      const unavailable = new Error('YouTube request failed');
      unavailable.code = 'YOUTUBE_UNAVAILABLE';
      throw unavailable;
    }

    const status = data && data.playabilityStatus && data.playabilityStatus.status;
    const details = data && data.videoDetails;
    if (!details) {
      if (status === 'LOGIN_REQUIRED') playerBlockedUntil = now() + PLAYER_BACKOFF_MS;
      return { track: null, status };
    }

    const micro = (data.microformat && data.microformat.playerMicroformatRenderer) || {};
    const durationSec = parseInt(details.lengthSeconds, 10) || 0;
    const track = {
      provider: 'youtube',
      externalId: typeof details.videoId === 'string' && details.videoId ? details.videoId : id,
      title: typeof details.title === 'string' ? details.title : '',
      author: typeof details.author === 'string' ? details.author : '',
      durationSec,
      viewCount: toCount(details.viewCount),
      likeCount: toCount(micro.likeCount),
      tags: Array.isArray(details.keywords)
        ? [...new Set(details.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean))]
        : [],
      thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
      isLive: Boolean(details.isLiveContent) && durationSec === 0,
      url: 'https://www.youtube.com/watch?v=' + id,
      publishedAt: Date.parse(micro.publishDate || micro.uploadDate || '') || null,
      channelId: typeof details.channelId === 'string' ? details.channelId : null,
    };
    return { track, status };
  }

  async function searchRenderers(query) {
    const res = await http.post(SEARCH_URL, { context: INNERTUBE_CONTEXT, query, params: SEARCH_PARAMS }, innertubeOptions());
    return collectByKey(res.data, 'videoRenderer').filter((r) => r && typeof r.videoId === 'string');
  }

  async function oembedTitle(id) {
    try {
      const res = await http.get(OEMBED_URL + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { timeout: 8000 });
      const title = res.data && res.data.title;
      return typeof title === 'string' && title.trim() ? title.trim() : null;
    } catch (_) {
      return null;
    }
  }

  // Запасной путь, когда player не отдаёт videoDetails (YouTube просит войти):
  // то же видео ищется в обычной выдаче — сначала по id, затем по названию из oEmbed.
  async function lookupViaSearch(id) {
    try {
      let hit = (await searchRenderers(id)).find((r) => r.videoId === id);
      if (!hit) {
        const title = await oembedTitle(id);
        if (title) hit = (await searchRenderers(title)).find((r) => r.videoId === id);
      }
      return hit ? trackFromRenderer(hit) : null;
    } catch (error) {
      console.warn('[Music/YouTube] search fallback failed for ' + id + ':', error && error.message);
      return null;
    }
  }

  // Метаданные видео. UNPLAYABLE/LOGIN_REQUIRED — это бот-чек, а не «не найдено»:
  // видео считается ненайденным, только если и запасной поиск его не нашёл.
  async function getVideo(id) {
    if (typeof id !== 'string' || !VIDEO_ID_RE.test(id)) return null;
    const cached = cacheGet(videoCache, id);
    if (cached !== undefined) return cached;

    const { track: fromPlayer, status } = await fetchPlayer(id);
    const track = fromPlayer || (status === 'ERROR' ? null : await lookupViaSearch(id));
    cacheSet(videoCache, id, track);
    return track;
  }

  // Первый подходящий трек поисковой выдачи (стримы пропускаются). Если player
  // недоступен, трек собирается из данных самой выдачи.
  async function search(query) {
    let renderers;
    try {
      renderers = await searchRenderers(query);
    } catch (error) {
      console.warn('[Music/YouTube] search request failed:', error && error.message);
      return null;
    }
    try {
      for (const renderer of renderers) {
        if (!renderer.lengthText) continue; // live-стрим
        const id = renderer.videoId;
        const cached = cacheGet(videoCache, id);
        if (cached) return cached;
        const { track: fromPlayer } = await fetchPlayer(id);
        const track = fromPlayer || trackFromRenderer(renderer);
        if (track) {
          cacheSet(videoCache, id, track);
          return track;
        }
      }
    } catch (error) {
      console.warn('[Music/YouTube] search resolve failed:', error && error.message);
      return null;
    }
    return null;
  }

  // Ввод пользователя (URL / голый id / текст запроса) -> { track, startSec }.
  async function resolve(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim().slice(0, 200);
    if (!trimmed) return null;

    const parsed = parseYouTubeInput(trimmed);
    if (!parsed) {
      const track = await search(trimmed);
      return track ? { track, startSec: 0 } : null;
    }
    if (parsed.type === 'playlist') return null;

    let track = await getVideo(parsed.id);
    if (!track && parsed.bare) track = await search(trimmed);
    if (!track) return null;
    return { track, startSec: parsed.startSec || 0 };
  }

  // Треки плейлиста: новый формат (lockupViewModel) и старый
  // (playlistVideoRenderer), с догрузкой страниц через continuation.
  async function getPlaylistItems(playlistIdOrUrl, options = {}) {
    const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : 500;
    const playlistId = extractPlaylistId(playlistIdOrUrl);
    if (!playlistId) return [];

    const seen = new Set();
    const items = [];
    let body = { context: INNERTUBE_CONTEXT, browseId: 'VL' + playlistId };

    const pushEntry = (entry) => {
      if (!entry || seen.has(entry.externalId)) return;
      seen.add(entry.externalId);
      items.push(entry);
    };

    for (let page = 0; page < BROWSE_MAX_PAGES; page++) {
      let data;
      try {
        const res = await http.post(BROWSE_URL, body, innertubeOptions());
        data = res.data;
      } catch (error) {
        console.warn('[Music/YouTube] browse request failed:', error && error.message);
        return items;
      }

      for (const vm of collectByKey(data, 'lockupViewModel')) {
        if (!vm || typeof vm.contentId !== 'string' || !VIDEO_ID_RE.test(vm.contentId)) continue;
        const meta = vm.metadata && vm.metadata.lockupMetadataViewModel;
        const title = meta && meta.title && typeof meta.title.content === 'string' ? meta.title.content : '';
        pushEntry({ externalId: vm.contentId, title });
      }
      for (const renderer of collectByKey(data, 'playlistVideoRenderer')) {
        if (!renderer || typeof renderer.videoId !== 'string' || !VIDEO_ID_RE.test(renderer.videoId)) continue;
        const runs = renderer.title && Array.isArray(renderer.title.runs) ? renderer.title.runs : [];
        const title = runs[0] && typeof runs[0].text === 'string' ? runs[0].text : '';
        pushEntry({ externalId: renderer.videoId, title });
      }

      if (items.length >= max) return items.slice(0, max);

      const token = findContinuationToken(data);
      if (!token) break;
      body = { context: INNERTUBE_CONTEXT, continuation: token };
    }
    return items;
  }

  // Лайки/дизлайки через Return YouTube Dislike.
  async function getRating(id) {
    if (typeof id !== 'string' || !VIDEO_ID_RE.test(id)) return null;
    const cached = cacheGet(ratingCache, id);
    if (cached !== undefined) return cached;

    let data;
    try {
      const res = await http.get(RYD_URL + encodeURIComponent(id), { timeout: RATING_TIMEOUT_MS });
      data = res.data;
    } catch (error) {
      console.warn('[Music/YouTube] rating request failed for ' + id + ':', error && error.message);
      return null;
    }

    const likes = toCount(data && data.likes);
    const dislikes = toCount(data && data.dislikes);
    if (likes === null || dislikes === null) return null;

    const total = likes + dislikes;
    const rating = {
      likes,
      dislikes,
      percent: total > 0 ? Math.round((likes / total) * 1000) / 10 : null,
    };
    cacheSet(ratingCache, id, rating);
    return rating;
  }

  return { getVideo, search, resolve, getPlaylistItems, getRating };
}

const defaultInstance = createYouTubeProvider();

module.exports = {
  createYouTubeProvider,
  parseYouTubeInput,
  findYouTubeInText,
  ...defaultInstance,
};
