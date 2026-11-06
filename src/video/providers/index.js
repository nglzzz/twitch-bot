'use strict';

/*
 * Провайдеры видео: находят поддерживаемую ссылку в тексте и получают данные ролика.
 *
 * find(text, enabled) -> { provider, kind, id, url, startSec, settingKey } | null
 * resolve(link)       -> track | null
 *
 * track: { provider, externalId, kind, title, author, channelId, durationSec (null — неизвестна),
 *          thumbnail, url, embed, isVertical, viewCount, publishedAt, isLive }
 *
 * kind: video | short | tiktok | clip | vod
 */

const axios = require('axios');
const youtube = require('../../music/providers/youtube.provider');

const TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const cache = new Map();
async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

/** «1h2m3s», «90», «1:30», «1:02:03» -> секунды. */
function parseTime(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.floor(Number(text));
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) return text.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!match) return 0;
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
}

/** «start=1:30» в конце сообщения задаёт время старта для любой площадки. */
function startFromText(text) {
  const match = String(text || '').match(/(?:^|\s)(?:start|старт)=(\S+)/i);
  return match ? parseTime(match[1]) : 0;
}

const URL_IN_TEXT_RE = /(?<![\w.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|tiktok\.com|twitch\.tv|vimeo\.com|streamable\.com)\/[^\s<>"']*/gi;

function toUrl(raw) {
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch (_) { return null; }
}

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
}

// ---------- разбор ссылок ----------

function parseYouTube(raw) {
  const parsed = youtube.parseYouTubeInput(raw);
  if (!parsed || parsed.type !== 'video' || parsed.bare) return null;
  const isShort = /\/shorts\//i.test(raw);
  return { provider: 'youtube', kind: isShort ? 'short' : 'video', id: parsed.id, startSec: parsed.startSec || 0, settingKey: isShort ? 'shorts' : 'youtube' };
}

function parseTikTok(url) {
  const host = hostOf(url);
  if (!host.endsWith('tiktok.com')) return null;
  const path = url.pathname;
  const full = path.match(/\/(?:video|v|embed(?:\/v2)?|player\/v1)\/(\d{8,25})/);
  const user = (path.match(/^\/@([\w.-]{2,40})\//) || [])[1] || null;
  if (full) return { provider: 'tiktok', kind: 'tiktok', id: full[1], user, startSec: 0, settingKey: 'tiktok' };
  // Короткие ссылки (vm.tiktok.com/XXXX, tiktok.com/t/XXXX) раскрываются при resolve.
  const short = (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') ? path.match(/^\/([\w-]{5,20})\/?$/) : path.match(/^\/t\/([\w-]{5,20})\/?$/);
  if (short) return { provider: 'tiktok', kind: 'tiktok', id: null, shortUrl: `https://${url.hostname}${path}`, startSec: 0, settingKey: 'tiktok' };
  return null;
}

function parseTwitch(url) {
  const host = hostOf(url);
  if (host === 'clips.twitch.tv') {
    const slug = url.pathname.split('/').filter(Boolean)[0];
    if (slug && /^[\w-]{3,100}$/.test(slug) && slug !== 'embed') return { provider: 'twitch', kind: 'clip', id: slug, startSec: 0, settingKey: 'twitchClips' };
    return null;
  }
  if (host !== 'twitch.tv') return null;
  const clip = url.pathname.match(/^\/(?:[\w]+\/)?clip\/([\w-]{3,100})/);
  if (clip) return { provider: 'twitch', kind: 'clip', id: clip[1], startSec: 0, settingKey: 'twitchClips' };
  const vod = url.pathname.match(/^\/videos\/(\d{5,20})/);
  if (vod) return { provider: 'twitch', kind: 'vod', id: vod[1], startSec: parseTime(url.searchParams.get('t')), settingKey: 'twitchVods' };
  return null;
}

function parseVimeo(url) {
  const host = hostOf(url);
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const match = url.pathname.match(/\/(?:video\/|channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?(\d{5,12})(?:\/|$)/);
  if (!match) return null;
  const hash = url.hash.match(/t=([\dhms:]+)/i);
  return { provider: 'vimeo', kind: 'video', id: match[1], startSec: hash ? parseTime(hash[1]) : 0, settingKey: 'vimeo' };
}

function parseStreamable(url) {
  if (hostOf(url) !== 'streamable.com') return null;
  const match = url.pathname.match(/^\/(?:[eo]\/)?([a-z0-9]{3,12})\/?$/i);
  return match ? { provider: 'streamable', kind: 'video', id: match[1], startSec: 0, settingKey: 'streamable' } : null;
}

function parseLink(raw) {
  const text = String(raw || '').replace(/[.,;:!?)\]]+$/, '');
  if (/youtu\.?be/i.test(text)) return parseYouTube(text);
  const url = toUrl(text);
  if (!url) return null;
  return parseTikTok(url) || parseTwitch(url) || parseVimeo(url) || parseStreamable(url);
}

/**
 * Первая поддерживаемая ссылка в тексте. enabled — настройки providers:
 * ссылки выключенных площадок пропускаются (но возвращаются в disabled, чтобы ответить в чат).
 */
function find(text, enabled = null) {
  const source = String(text || '');
  URL_IN_TEXT_RE.lastIndex = 0;
  let match;
  let disabled = null;
  while ((match = URL_IN_TEXT_RE.exec(source)) !== null) {
    const link = parseLink(match[0]);
    if (!link) continue;
    link.url = match[0];
    const extraStart = startFromText(source);
    if (extraStart) link.startSec = extraStart;
    if (enabled && !enabled[link.settingKey]) { disabled = disabled || link; continue; }
    return link;
  }
  return disabled ? { ...disabled, disabled: true } : null;
}

// ---------- данные роликов ----------

/** Запасной путь, когда YouTube не отдаёт данные без входа: oEmbed (без длительности — её сообщит плеер). */
async function youtubeOEmbed(id) {
  const data = await axios.get('https://www.youtube.com/oembed', {
    params: { url: `https://www.youtube.com/watch?v=${id}`, format: 'json' }, timeout: TIMEOUT_MS,
  }).then((res) => res.data).catch(() => null);
  if (!data || !data.title) return null;
  return {
    externalId: id, title: data.title, author: data.author_name || '', channelId: data.author_url || null,
    durationSec: 0, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, url: `https://www.youtube.com/watch?v=${id}`,
    viewCount: null, publishedAt: null, isLive: false,
  };
}

async function resolveYouTube(link) {
  let track = null;
  let failure = null;
  try { track = await youtube.getVideo(link.id); } catch (error) { failure = error; }
  if (!track) track = await youtubeOEmbed(link.id);
  // YouTube не ответил вовсе — это сбой сети, а не удалённое видео.
  if (!track && failure) throw failure;
  if (!track) return null;
  let kind = link.kind;
  if (kind !== 'short' && track.durationSec > 0 && track.durationSec <= 180) {
    // Shorts открываются по /shorts/<id> без редиректа; обычное видео перекидывает на /watch.
    kind = await cached(`yt-short:${link.id}`, () => axios.head(`https://www.youtube.com/shorts/${link.id}`, {
      timeout: 5000, maxRedirects: 0, validateStatus: () => true, headers: { 'User-Agent': UA },
    }).then((res) => (res.status === 200 ? 'short' : 'video')).catch(() => 'video'));
  }
  return {
    provider: 'youtube',
    externalId: track.externalId,
    kind,
    title: track.title,
    author: track.author,
    channelId: track.channelId || null,
    durationSec: track.durationSec || null,
    thumbnail: track.thumbnail,
    url: kind === 'short' ? `https://www.youtube.com/shorts/${track.externalId}` : track.url,
    embed: null,
    isVertical: kind === 'short',
    viewCount: track.viewCount ?? null,
    publishedAt: track.publishedAt || null,
    isLive: Boolean(track.isLive),
  };
}

async function expandTikTok(shortUrl) {
  const res = await axios.get(shortUrl, { timeout: TIMEOUT_MS, maxRedirects: 0, validateStatus: () => true, headers: { 'User-Agent': UA } });
  const location = res.headers && res.headers.location;
  const match = String(location || '').match(/\/(?:video|v)\/(\d{8,25})/);
  return match ? match[1] : null;
}

async function resolveTikTok(link) {
  const id = link.id || await cached(`tt-short:${link.shortUrl}`, () => expandTikTok(link.shortUrl));
  if (!id) return null;
  const url = `https://www.tiktok.com/@${link.user || ''}/video/${id}`;
  const data = await cached(`tt:${id}`, () => axios.get('https://www.tiktok.com/oembed', {
    params: { url }, timeout: TIMEOUT_MS, headers: { 'User-Agent': UA },
  }).then((res) => res.data).catch(() => null));
  if (!data || (!data.embed_product_id && !data.html)) return null;
  return {
    provider: 'tiktok',
    externalId: id,
    kind: 'tiktok',
    title: data.title || (link.user ? `TikTok @${link.user}` : 'TikTok'),
    author: data.author_name || (link.user ? `@${link.user}` : ''),
    channelId: data.author_unique_id || link.user || null,
    durationSec: null, // TikTok не отдаёт длительность — плеер сообщит её при запуске
    thumbnail: data.thumbnail_url || '',
    url: data.author_unique_id ? `https://www.tiktok.com/@${data.author_unique_id}/video/${id}` : url,
    embed: null,
    isVertical: true,
    viewCount: null,
    publishedAt: null,
    isLive: false,
  };
}

async function twitchHelix(path, params) {
  const config = require('../../config');
  const { getTwitchAccessToken } = require('../../services/token.service');
  const token = await getTwitchAccessToken();
  if (!token || !config.TWITCH_API_CLIENT_ID) throw new Error('Twitch API не настроен');
  const res = await axios.get(`https://api.twitch.tv/helix/${path}`, {
    params,
    timeout: TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': config.TWITCH_API_CLIENT_ID },
  });
  return res.data && Array.isArray(res.data.data) ? res.data.data[0] || null : null;
}

async function resolveTwitch(link) {
  if (link.kind === 'clip') {
    const clip = await cached(`tw-clip:${link.id}`, () => twitchHelix('clips', { id: link.id }));
    if (!clip) return null;
    return {
      provider: 'twitch',
      externalId: clip.id,
      kind: 'clip',
      title: clip.title || 'Клип Twitch',
      author: clip.broadcaster_name || '',
      channelId: clip.broadcaster_id || null,
      durationSec: Math.ceil(Number(clip.duration) || 0) || null,
      thumbnail: clip.thumbnail_url || '',
      url: clip.url || `https://clips.twitch.tv/${clip.id}`,
      embed: null,
      isVertical: false,
      viewCount: clip.view_count ?? null,
      publishedAt: Date.parse(clip.created_at) || null,
      isLive: false,
    };
  }
  const vod = await cached(`tw-vod:${link.id}`, () => twitchHelix('videos', { id: link.id }));
  if (!vod) return null;
  return {
    provider: 'twitch',
    externalId: vod.id,
    kind: 'vod',
    title: vod.title || 'Запись Twitch',
    author: vod.user_name || '',
    channelId: vod.user_id || null,
    durationSec: parseTime(vod.duration) || null,
    thumbnail: String(vod.thumbnail_url || '').replace('%{width}', '640').replace('%{height}', '360'),
    url: vod.url || `https://www.twitch.tv/videos/${vod.id}`,
    embed: null,
    isVertical: false,
    viewCount: vod.view_count ?? null,
    publishedAt: Date.parse(vod.created_at) || null,
    isLive: false,
  };
}

async function resolveVimeo(link) {
  const data = await cached(`vimeo:${link.id}`, () => axios.get('https://vimeo.com/api/oembed.json', {
    params: { url: `https://vimeo.com/${link.id}` }, timeout: TIMEOUT_MS,
  }).then((res) => res.data).catch(() => null));
  if (!data) return null;
  return {
    provider: 'vimeo',
    externalId: String(data.video_id || link.id),
    kind: 'video',
    title: data.title || 'Vimeo',
    author: data.author_name || '',
    channelId: data.author_url || null,
    durationSec: Number(data.duration) || null,
    thumbnail: data.thumbnail_url || '',
    url: `https://vimeo.com/${link.id}`,
    embed: null,
    isVertical: Number(data.height) > Number(data.width),
    viewCount: null,
    publishedAt: Date.parse(String(data.upload_date || '').replace(' ', 'T')) || null,
    isLive: false,
  };
}

async function resolveStreamable(link) {
  const data = await cached(`streamable:${link.id}`, () => axios.get(`https://api.streamable.com/videos/${link.id}`, { timeout: TIMEOUT_MS })
    .then((res) => res.data).catch(() => null));
  if (!data || data.status !== 2) return null;
  const mp4 = (data.files && (data.files.mp4 || data.files['mp4-mobile'])) || {};
  return {
    provider: 'streamable',
    externalId: link.id,
    kind: 'video',
    title: data.title || 'Streamable',
    author: '',
    channelId: null,
    durationSec: Math.ceil(Number(mp4.duration) || 0) || null,
    thumbnail: data.thumbnail_url ? (String(data.thumbnail_url).startsWith('//') ? `https:${data.thumbnail_url}` : data.thumbnail_url) : '',
    url: `https://streamable.com/${link.id}`,
    embed: null,
    isVertical: Number(mp4.height) > Number(mp4.width),
    viewCount: null,
    publishedAt: null,
    isLive: false,
  };
}

const RESOLVERS = { youtube: resolveYouTube, tiktok: resolveTikTok, twitch: resolveTwitch, vimeo: resolveVimeo, streamable: resolveStreamable };

async function resolve(link) {
  const resolver = link && RESOLVERS[link.provider];
  if (!resolver) return null;
  return resolver(link);
}

/** Поиск по названию (только YouTube): «!video название». */
async function search(query) {
  const track = await youtube.search(String(query || '').slice(0, 200));
  if (!track) return null;
  return resolveYouTube({ provider: 'youtube', kind: 'video', id: track.externalId, startSec: 0 });
}

const PROVIDER_LABELS = { youtube: 'YouTube', tiktok: 'TikTok', twitch: 'Twitch', vimeo: 'Vimeo', streamable: 'Streamable' };

module.exports = { find, parseLink, resolve, search, parseTime, startFromText, PROVIDER_LABELS };
