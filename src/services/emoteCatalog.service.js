const axios = require('axios');

const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 7000;
const cache = new Map();
let latestCatalog = [];

function getUrl(urls) {
  if (!urls || typeof urls !== 'object') return null;

  const url = urls['4'] || urls['2'] || urls['1'] || Object.values(urls)[0];
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
}

function getSevenTvUrl(emote) {
  const host = emote?.data?.host;
  const files = host?.files;
  if (!host?.url || !Array.isArray(files) || files.length === 0) return null;

  const file = files.find((item) => item.name === '2x.webp')
    || files.find((item) => item.name === '1x.webp')
    || files[0];
  const baseUrl = host.url.startsWith('//') ? `https:${host.url}` : host.url;
  return `${baseUrl}/${file.name}`;
}

function makeCatalogEntry(name, url, provider) {
  return name && url ? { name, url, provider } : null;
}

function collectFfzEmotes(data) {
  if (!data?.sets) return [];

  return Object.values(data.sets).flatMap((set) => (set.emoticons || [])
    .map((emote) => makeCatalogEntry(emote.name, getUrl(emote.urls), 'ffz'))
    .filter(Boolean));
}

function collectBttvEmotes(data) {
  return (Array.isArray(data) ? data : [])
    .map((emote) => makeCatalogEntry(
      emote.code,
      emote.id ? `https://cdn.betterttv.net/emote/${emote.id}/2x` : null,
      'bttv'
    ))
    .filter(Boolean);
}

function collectSevenTvEmotes(data) {
  const emotes = data?.emotes || data?.emote_set?.emotes || [];
  return emotes
    .map((emote) => makeCatalogEntry(emote.name, getSevenTvUrl(emote), '7tv'))
    .filter(Boolean);
}

async function loadCatalog(channelId) {
  const cacheKey = String(channelId || 'global');
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.emotes;

  const requests = [
    axios.get('https://7tv.io/v3/emote-sets/global', { timeout: REQUEST_TIMEOUT_MS }),
    axios.get('https://api.betterttv.net/3/cached/emotes/global', { timeout: REQUEST_TIMEOUT_MS }),
    axios.get('https://api.frankerfacez.com/v1/set/global', { timeout: REQUEST_TIMEOUT_MS }),
  ];

  if (channelId) {
    requests.push(
      axios.get(`https://7tv.io/v3/users/twitch/${encodeURIComponent(channelId)}`, { timeout: REQUEST_TIMEOUT_MS }),
      axios.get(`https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(channelId)}`, { timeout: REQUEST_TIMEOUT_MS }),
      axios.get(`https://api.frankerfacez.com/v1/room/id/${encodeURIComponent(channelId)}`, { timeout: REQUEST_TIMEOUT_MS })
    );
  }

  const responses = await Promise.allSettled(requests);
  const getData = (index) => responses[index]?.status === 'fulfilled' ? responses[index].value.data : null;
  const emotes = [
    ...collectSevenTvEmotes(getData(0)),
    ...collectBttvEmotes(getData(1)),
    ...collectFfzEmotes(getData(2)),
    ...collectSevenTvEmotes(getData(3)),
    ...collectBttvEmotes([
      ...(getData(4)?.channelEmotes || []),
      ...(getData(4)?.sharedEmotes || []),
    ]),
    ...collectFfzEmotes(getData(5)),
  ];

  // Channel emotes take precedence over global emotes with an identical code.
  const emotesByName = new Map();
  emotes.forEach((emote) => emotesByName.set(emote.name, emote));
  const catalog = Array.from(emotesByName.values());

  cache.set(cacheKey, { emotes: catalog, expiresAt: Date.now() + CACHE_TTL_MS });
  latestCatalog = catalog;
  return catalog;
}

function getCachedCatalog(channelId) {
  const cached = cache.get(String(channelId || 'global'));
  return cached && cached.expiresAt > Date.now() ? cached.emotes : latestCatalog;
}

module.exports = {
  getCachedCatalog,
  loadCatalog,
};
