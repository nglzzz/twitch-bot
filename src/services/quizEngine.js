'use strict';

const defaultWords = require('../data/quizWords');
const fallbackSets = require('../games/quizFallbacks');
const {
  getMode,
  resolveMode,
  buildRoundClue,
  buildRoundHint,
  normalizeAnswer,
} = require('../games/quizModes');

const DEFAULT_ROUND_COUNT = 10;
const DEFAULT_ROUND_DURATION_MS = 60 * 1000;
const DEFAULT_HINT_AFTER_MS = 30 * 1000;
const DEFAULT_BREAK_MS = 5 * 1000;
const DEFAULT_AUTO_DELAY_MS = 2 * 60 * 60 * 1000;

function isStreamer(tags) {
  return Boolean(tags && (tags.streamer || tags.badges && tags.badges.broadcaster === '1'));
}

function getUsername(tags) {
  return String(tags && (tags.username || tags['display-name']) || '').trim();
}

function getUserId(tags) {
  return String(tags && tags['user-id'] || '').trim();
}

function createQuizEngine(options) {
  const {
    getStream,
    repository,
    send,
    now = Date.now,
    words,
    questionProvider = null,
    roundCount = DEFAULT_ROUND_COUNT,
    roundDurationMs = DEFAULT_ROUND_DURATION_MS,
    hintAfterMs = DEFAULT_HINT_AFTER_MS,
    breakMs = DEFAULT_BREAK_MS,
    autoDelayMs = DEFAULT_AUTO_DELAY_MS,
  } = options;

  if (typeof getStream !== 'function' || typeof send !== 'function' || !repository) {
    throw new TypeError('Quiz engine requires getStream, repository, and send dependencies');
  }

  let state = null;
  let queue = Promise.resolve();
  let nextAutoAttemptAt = 0;

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function sendMessage(message) {
    send(message);
  }

  function streamId(stream) {
    return String(stream && stream.id || '');
  }

  function getStartedAt(stream) {
    const value = stream && stream.started_at;
    const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function chooseWord() {
    const remaining = state.words;
    if (!remaining.length) return null;
    const index = Math.floor(Math.random() * remaining.length);
    return remaining.splice(index, 1)[0];
  }

  function beginRound() {
    const entry = chooseWord();
    if (!entry) {
      finishGame();
      return;
    }

    const rawAnswers = Array.isArray(entry.answers) ? entry.answers : [entry.word];
    const answers = rawAnswers.map(normalizeAnswer).filter(Boolean);
    if (entry.word) answers.push(normalizeAnswer(entry.word));
    const answer = answers[0] || '';
    state.current = {
      clue: buildRoundClue(state.mode, entry),
      answers: new Set(answers),
      answer,
      startedAt: now(),
      hinted: false,
    };
    state.waitingUntil = null;
    sendMessage(`${getMode(state.mode).label} — раунд ${state.round}/${state.roundCount}: ${state.current.clue}`);
  }

  function finishGame() {
    if (!state) return;
    const ending = state.mode === 'quiz' ? 'Викторина завершена' : `Игра «${getMode(state.mode).label}» завершена`;
    sendMessage(`${ending}! ${state.roundCount} раундов позади. Команда !в топ покажет лидеров.`);
    state = null;
  }

  function advanceRound(reveal) {
    if (!state || !state.current) return;
    const current = state.current;
    if (reveal) sendMessage(`Время вышло! Ответ: ${current.answer}.`);

    if (state.round >= state.roundCount) {
      finishGame();
      return;
    }

    state.round += 1;
    state.current = null;
    state.waitingUntil = now() + breakMs;
  }

  async function startInternal(tags, stream, source, mode) {
    if (state) {
      sendMessage(`Уже идет игра «${getMode(state.mode).label}». Дождитесь ее окончания.`);
      return false;
    }

    const online = Boolean(stream);
    if (!online && !isStreamer(tags)) {
      sendMessage('Игра доступна только во время стрима. Запустить ее офлайн может только стример.');
      return false;
    }

    const id = online ? streamId(stream) : '';
    const questionStreamId = id || `offline:${new Date(now()).toISOString().slice(0, 10)}`;
    let roundWords = Array.isArray(words)
      ? words.slice()
      : (mode === 'quiz' ? defaultWords : fallbackSets[mode] || []).slice();
    if (questionProvider) {
      sendMessage(`Готовлю вопросы для игры «${getMode(mode).label}»…`);
      roundWords = await questionProvider.getQuestions({ streamId: questionStreamId, count: roundCount, mode });
      let latestStream;
      try {
        latestStream = await getStream({ force: true });
      } catch (error) {
        if (online || !isStreamer(tags)) {
          sendMessage('Не удалось проверить статус стрима. Попробуйте еще раз.');
          return false;
        }
        latestStream = null;
      }
      if (streamId(latestStream) !== id) {
        sendMessage('Статус стрима изменился во время подготовки вопросов. Запустите игру еще раз.');
        return false;
      }
    }
    if (!roundWords.length) {
      sendMessage(`Для игры «${getMode(mode).label}» пока нет новых заданий. Попробуйте позже.`);
      return false;
    }

    if (online && id) repository.markStarted(id);

    state = {
      active: true,
      streamId: id || null,
      questionStreamId,
      mode,
      source: online ? source : 'streamer-offline',
      round: 1,
      roundCount: Math.min(roundCount, roundWords.length),
      words: roundWords,
      current: null,
      waitingUntil: null,
    };
    const answerInstruction = mode === 'quiz' || mode === 'anagram'
      ? 'Отвечайте одним словом'
      : 'Пишите название целиком';
    sendMessage(`Запускаем игру «${getMode(mode).label}»! ${answerInstruction}, за каждый правильный ответ — 1 очко.`);
    beginRound();
    return true;
  }

  async function start(tags, modeId = 'quiz') {
    const mode = resolveMode(modeId);
    if (!mode) {
      send('Неизвестный режим игры. Используйте !в, !в анаграммы, !в игра или !в фильм.');
      return false;
    }
    return enqueue(async () => {
      let stream;
      try {
        stream = await getStream();
      } catch (error) {
        if (!isStreamer(tags)) {
          sendMessage('Не удалось проверить статус стрима. Попробуйте еще раз.');
          return false;
        }
        stream = null;
      }
      return startInternal(tags || {}, stream, 'manual', mode);
    });
  }

  async function stopInternal(message) {
    if (!state) {
      sendMessage('Сейчас игра не идет.');
      return false;
    }
    state = null;
    sendMessage(message || 'Игра остановлена.');
    return true;
  }

  async function tick() {
    return enqueue(async () => {
      let stream;
      let streamStatusKnown = true;
      try {
        stream = await getStream();
      } catch (error) {
        // Keep an active round moving, but do not infer offline state or auto-start.
        streamStatusKnown = false;
      }

      if (state) {
        if (streamStatusKnown) {
          if (state.source === 'streamer-offline') {
            if (stream) {
              await stopInternal('Игра остановлена: начался стрим.');
              return;
            }
          } else if (!stream || streamId(stream) !== state.streamId) {
            await stopInternal('Игра остановлена: стрим завершился.');
            return;
          }
        }

        if (!state.current) {
          if (state.waitingUntil !== null && now() >= state.waitingUntil) beginRound();
          return;
        }

        const current = state.current;
        const elapsed = now() - current.startedAt;
        if (elapsed >= roundDurationMs) {
          advanceRound(true);
          return;
        }
        if (!current.hinted && elapsed >= hintAfterMs) {
          current.hinted = true;
          sendMessage(buildRoundHint(state.mode, current.answer));
        }
        return;
      }

      if (!streamStatusKnown || !stream) return;
      const id = streamId(stream);
      const startedAt = getStartedAt(stream);
      if (!id || startedAt === null || now() < nextAutoAttemptAt || now() - startedAt < autoDelayMs || repository.hasStarted(id)) return;

      nextAutoAttemptAt = now() + 60_000;
      await startInternal({ streamer: true }, stream, 'auto', 'quiz');
    });
  }

  function guess(tags, message) {
    if (!state || !state.current || !message || String(message).startsWith('!')) return false;
    if (now() - state.current.startedAt >= roundDurationMs) return false;

    const guessValue = normalizeAnswer(message);
    if (!guessValue || !state.current.answers.has(guessValue)) return false;

    const username = getUsername(tags);
    const userId = getUserId(tags);
    if (!username || !userId) return false;

    let total;
    try {
      total = repository.addPoint({
        userId,
        username,
        displayName: String(tags && tags['display-name'] || username),
        mode: state.mode,
        streamId: state.streamId,
        createdAt: now(),
      });
    } catch (error) {
      console.error('[Quiz] Could not save score:', error.message);
      return false;
    }

    sendMessage(`@${username} угадал(а)! Ответ: ${state.current.answer}. +1 очко, всего ${total}.`);
    advanceRound(false);
    return true;
  }

  async function command(tags, message, requestedMode) {
    const args = String(message || '').trim().split(/\s+/).slice(1);
    const subcommand = normalizeAnswer(args[0] || '');

    if (subcommand === 'очки' || subcommand === 'score') {
      const userId = getUserId(tags);
      if (!userId) {
        sendMessage('Не удалось определить пользователя.');
        return;
      }
      const score = repository.getScore(userId);
      sendMessage(`@${getUsername(tags)}: ${score || 0} очков в играх чата.`);
      return;
    }

    if (subcommand === 'топ' || subcommand === 'top') {
      const leaders = repository.getTop(5);
      if (!leaders.length) {
        sendMessage('Пока в играх чата никто не набрал очков.');
        return;
      }
      sendMessage(`Топ игр чата: ${leaders.map((item, index) => `${index + 1}. ${item.username} — ${item.points}`).join('; ')}`);
      return;
    }

    if (subcommand === 'стоп' || subcommand === 'stop') {
      if (!isStreamer(tags)) {
        sendMessage('Остановить игру может только стример.');
        return;
      }
      await enqueue(() => stopInternal());
      return;
    }

    const selectedMode = requestedMode || resolveMode(args[0] || 'quiz');
    if (!selectedMode) {
      sendMessage('Режимы: !в, !в анаграммы, !в игра, !в фильм. Очки: !в очки, таблица: !в топ.');
      return;
    }
    await start(tags, selectedMode);
  }

  function getState() {
    if (!state) return null;
    return {
      active: true,
      streamId: state.streamId,
      mode: state.mode,
      source: state.source,
      round: state.round,
      roundCount: state.roundCount,
      clue: state.current && state.current.clue,
      answer: state.current && state.current.answer,
      hinted: state.current && state.current.hinted,
      waitingUntil: state.waitingUntil,
    };
  }

  return { start, tick, guess, command, getState };
}

module.exports = { createQuizEngine, normalizeAnswer };
