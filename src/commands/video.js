'use strict';

// Команды заказа видео: !video, !wrongvideo, !vskip.
// Ссылки без команды и голоса «скип / оставить» обрабатывает handleChatMessage (src/services/video).

const { getVideoService, getSettingsStore, replyFor, chatter } = require('../services/video');
const { formatDuration } = require('../services/video/videoFormat');

function withService(handler) {
  return async (channel, tags, message) => {
    const video = getVideoService();
    const user = chatter(tags);
    if (!video) return `@${user.display} заказ видео временно недоступен.`;
    try {
      return await handler(video, user, message, tags);
    } catch (error) {
      console.error('[Video] Command failed:', error);
      return `@${user.display} что-то пошло не так, попробуй позже.`;
    }
  };
}

function siteUrl() {
  return require('../services/music').getPublicBase();
}

const videoRequest = withService(async (video, user, message) => {
  // Без getSubjectFromMessage: он вырезает «@», а в ссылках TikTok это часть адреса.
  const input = String(message || '').trim().split(/\s+/).slice(1).join(' ');
  if (!input) {
    const state = video.getState();
    const url = siteUrl();
    const page = url ? ` Очередь: ${url}/video` : '';
    const item = state.current;
    if (!item) return `@${user.display} сейчас видео не идёт.${state.accepting ? ' Кидай ссылку в чат!' : ''}${page}`;
    const position = formatDuration(Math.max(0, state.positionSec - (item.startSec || 0)));
    return `@${user.display} 📺 ${item.title} [${position}${item.playLabel ? `/${item.playLabel}` : ''}] — заказ от @${item.requestedBy} ${item.url}${page}`;
  }
  const result = await video.requestVideo({ input, requester: user, source: 'chat' });
  // На команду всегда отвечаем, даже если ответы на ссылки выключены.
  return replyFor(user, result, { ...getSettingsStore().get(), chat: { replies: 'all' } });
});

const wrongVideo = withService(async (video, user) => {
  const result = await video.cancelOwnRequest({ login: user.login });
  return `@${user.display} ${result.message}`;
});

const videoSkip = withService(async (video, user, message, tags) => {
  const result = await video.skipCommand({ login: user.login, tags });
  return result && result.message ? `@${user.display} ${result.message}` : null;
});

/** Идёт ли сейчас видео: тогда !skip из музыки относится к видео. */
function isVideoActive() {
  const video = getVideoService();
  if (!video) return false;
  const state = video.getState();
  if (!state.current) return false;
  if (state.status === 'playing') return true;
  // Видео на паузе, а музыка не играет — значит, сейчас всё равно «режим видео».
  const music = require('../services/music').getMusicService();
  return state.status === 'paused' && (!music || music.getState().status !== 'playing');
}

function registerVideoCommands(Chat) {
  const commands = [
    [videoRequest, ['!video', '!видео']],
    [wrongVideo, ['!wrongvideo', '!отменавидео']],
    [videoSkip, ['!vskip', '!вскип']],
  ];
  for (const [handler, names] of commands) {
    for (let i = 0; i < names.length; i += 2) Chat.registerCommand(names[i], handler, names[i + 1]);
  }
}

module.exports = { registerVideoCommands, videoRequest, wrongVideo, videoSkip, isVideoActive };
