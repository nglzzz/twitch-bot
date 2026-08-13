'use strict';

/**
 * Рендер сообщений чата с подстановкой смайлов 7tv/BetterTV/FFZ.
 * Используется в серверных виджетах («Последние сообщения чата» и профиль
 * чаттера) и зеркально повторяет логику клиентского renderMessageContent()
 * из оверлея /speak, чтобы смайлы выглядели одинаково везде.
 */

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Строит Map<emoteName, { url, provider }> из каталога emoteCatalog.service.
 * При совпадении имён побеждает запись с непустым url.
 */
function buildEmoteMap(catalog) {
  const map = new Map();

  if (!Array.isArray(catalog)) {
    return map;
  }

  catalog.forEach((emote) => {
    if (!emote || typeof emote.name !== 'string' || typeof emote.url !== 'string' || !emote.url) {
      return;
    }

    map.set(emote.name, { url: emote.url, provider: emote.provider || 'emote' });
  });

  return map;
}

/**
 * Превращает текст сообщения в безопасный HTML: смайл-токены заменяются на
 * <img class="chat-emote">, остальной текст экранируется. Токенизация по
 * /(\s+)/ сохраняет пробелы и совпадает с разметкой оверлея.
 */
function renderMessageHtml(text, emoteMap) {
  const source = String(text === null || text === undefined ? '' : text);

  if (!emoteMap || emoteMap.size === 0) {
    return escapeHtml(source);
  }

  return source
    .split(/(\s+)/)
    .map((part) => {
      const emote = part ? emoteMap.get(part) : null;
      if (!emote) {
        return escapeHtml(part);
      }

      const name = escapeHtml(part);
      const title = `${name} · ${escapeHtml(emote.provider.toUpperCase())}`;
      return `<img class="chat-emote" src="${escapeHtml(emote.url)}" alt="${name}" title="${title}" loading="lazy" />`;
    })
    .join('');
}

module.exports = {
  escapeHtml,
  buildEmoteMap,
  renderMessageHtml,
};
