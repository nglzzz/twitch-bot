'use strict';

// Команды заказа музыки: !sr, !wrongsong, !play, !pause, !song, !skip, !voteskip, !songlist.

const { getMusicService } = require('../services/music');
const { formatDuration } = require('../services/music/musicFormat');
const messageHelper = require('../helpers/messageHelper');

function chatter(tags) {
  return {
    login: String(tags.username || '').toLowerCase(),
    display: tags['display-name'] || tags.username,
    id: tags['user-id'] || null,
    tags,
  };
}

function withService(handler) {
  return async (channel, tags, message) => {
    const music = getMusicService();
    const user = chatter(tags);
    if (!music) return `@${user.display} заказ музыки временно недоступен.`;
    try {
      return await handler(music, user, message, tags);
    } catch (error) {
      console.error('[Music] Command failed:', error);
      return `@${user.display} что-то пошло не так, попробуй позже.`;
    }
  };
}

function siteUrl() {
  return require('../services/music').getPublicBase();
}

const songRequest = withService(async (music, user, message) => {
  const input = messageHelper.getSubjectFromMessage(message);
  const result = await music.requestTrack({ input, requester: user, source: 'chat' });
  return `@${user.display} ${result.message}`;
});

const wrongSong = withService(async (music, user) => {
  const result = await music.cancelOwnRequest({ login: user.login });
  return `@${user.display} ${result.message}`;
});

const play = withService(async (music, user, message, tags) => {
  if (!(await music.canControl(tags))) return null;
  const result = await music.play();
  return `@${user.display} ${result.message}`;
});

const pause = withService(async (music, user, message, tags) => {
  if (!(await music.canControl(tags))) return null;
  const result = await music.pause();
  return `@${user.display} ${result.message}`;
});

const currentSong = withService(async (music, user) => {
  const state = music.getState();
  const track = state.current;
  if (!track) return `@${user.display} сейчас ничего не играет. Закажи трек: !sr <ссылка или название>`;
  const position = formatDuration(Math.max(0, state.positionSec - (track.startSec || 0)));
  const by = track.isBackup ? 'из бэкап-плейлиста' : `заказ от @${track.requestedBy}`;
  return `@${user.display} 🎵 ${track.title} [${position}/${track.playLabel}] — ${by} ${track.url}`;
});

const skip = withService(async (music, user, message, tags) => {
  const result = await music.skipCommand({ login: user.login, tags });
  return `@${user.display} ${result.message}`;
});

const voteSkip = withService(async (music, user, message, tags) => {
  const result = await music.voteSkip({ login: user.login, tags });
  return `@${user.display} ${result.message}`;
});

const songList = withService(async (music, user) => {
  const url = siteUrl();
  const count = music.getQueue().length;
  const link = url ? `${url}/music` : '/music на сайте канала';
  return `@${user.display} 📃 Очередь заказов (${count}): ${link}`;
});

/** Регистрирует команды в чате. */
function registerMusicCommands(Chat) {
  const commands = [
    [songRequest, ['!sr', '!ык']],
    [wrongSong, ['!wrongsong', '!отмена']],
    [play, ['!play', '!плей']],
    [pause, ['!pause', '!пауза']],
    [currentSong, ['!currentsong', '!song', '!песня', '!трек']],
    [skip, ['!skip', '!скип']],
    [voteSkip, ['!voteskip']],
    [songList, ['!songlist', '!списоктреков']],
  ];
  for (const [handler, names] of commands) {
    for (let i = 0; i < names.length; i += 2) Chat.registerCommand(names[i], handler, names[i + 1]);
  }
}

module.exports = { registerMusicCommands, songRequest, wrongSong, play, pause, currentSong, skip, voteSkip, songList, siteUrl };
