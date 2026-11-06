'use strict';

// Заказ видео: очередь, голосование «скип / оставить», донатные заказы, плеер на странице стримера.
// Сервер — источник истины, страница плеера — источник позиции (тот же протокол, что у дока музыки).

const { roleFromTags, roleRank, hasRoleAtLeast } = require('../music/musicRoles');
const { formatDuration, effectiveDuration, fullDuration, publicRequest, adminRequest, PROVIDER_LABELS } = require('./videoFormat');
const { LIMIT_ROLES, normalizePlaybackRate } = require('./videoSettings.service');

const PLAYER_TIMEOUT_MS = 12000;
const PROGRESS_BROADCAST_MS = 5000;
const PLAYER_ERROR_STREAK = 3;
const VOTE_EMIT_MS = 250;
const UNKNOWN_DURATION_SEC = 60; // для расчёта ожидания и общей длины очереди (TikTok до запуска)

function createVideoService({
  repo,
  settingsStore,
  providers,
  broadcast = () => {},
  say = () => {},
  isFollower = async () => false,
  getRubAmount = async (amount, currency) => (String(currency || 'RUB').toUpperCase() === 'RUB' ? amount : null),
  emoteUrl = () => null,
  onActivityChange = () => {},
  now = Date.now,
  timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  random = Math.random,
} = {}) {
  const state = {
    status: 'stopped', // stopped | playing | paused | waiting
    currentId: null,
    positionSec: 0,
    positionAt: 0,
    userPaused: true,
    votes: new Map(), // login -> { vote: 'skip'|'keep', weight }
    voteOpensAt: 0,
    locked: false,
    warning: null, // { reason: 'vote'|'paid', endsAt }
    warningTimer: null,
    player: { id: null, lastSeenAt: 0, online: false, problem: null },
    errorStreak: 0,
    waitTimer: null,
    nextAt: null,
    seq: 0,
    seekSeq: 0,
    announceNext: false,
    lastProgressBroadcastAt: 0,
    voteEmitTimer: null,
    active: false,
    playbackSeq: 0,
  };
  let watchdog = null;
  const deletedMessages = new Set();
  let lastPlaybackSignature = null;

  const settings = () => settingsStore.get();

  // ---------- состояние ----------

  function current() {
    return state.currentId ? repo.findById(state.currentId) : null;
  }

  function playbackRateFor(request) {
    if (!request || (request.provider !== 'youtube' && request.provider !== 'vimeo')) return 1;
    const rate = Number(settings().player.playbackRate);
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }

  function livePosition(request) {
    if (!request) return 0;
    if (state.status !== 'playing' || !state.player.online) return state.positionSec;
    const elapsed = ((now() - state.positionAt) / 1000) * playbackRateFor(request);
    const play = effectiveDuration(request);
    const end = play ? (request.startSec || 0) + play : Infinity;
    return Math.min(end, state.positionSec + Math.max(0, elapsed));
  }

  function tally() {
    let skip = 0;
    let keep = 0;
    for (const { vote, weight } of state.votes.values()) {
      if (vote === 'skip') skip += weight;
      else keep += weight;
    }
    return { skip: Math.round(skip * 100) / 100, keep: Math.round(keep * 100) / 100 };
  }

  function isProtected(request) {
    return Boolean(request && request.isPaid && settings().paid.protectFromVotes);
  }

  function wordsWithEmotes(words) {
    return words.map((word) => ({ word, url: emoteUrl(word) || null }));
  }

  function votingInfo(request) {
    const v = settings().voting;
    const { skip, keep } = tally();
    let blocked = null;
    if (!v.enabled) blocked = 'disabled';
    else if (!request) blocked = 'idle';
    else if (isProtected(request)) blocked = 'paid';
    else if (state.locked) blocked = 'locked';
    else if (state.warning) blocked = 'warning';
    return {
      enabled: v.enabled,
      skip,
      keep,
      needed: v.needed,
      progress: Math.max(0, Math.min(1, (skip - keep) / v.needed)),
      voters: state.votes.size,
      opensAt: blocked ? null : (state.voteOpensAt > now() ? state.voteOpensAt : null),
      blocked,
      locked: state.locked,
      lockEnabled: v.lockEnabled,
      lockVotes: v.lockVotes,
      skipWords: wordsWithEmotes(v.skipWords),
      keepWords: wordsWithEmotes(v.keepWords),
    };
  }

  function getState({ admin = false } = {}) {
    const request = current();
    const s = settings();
    return {
      status: state.status,
      current: admin ? adminRequest(request) : publicRequest(request),
      positionSec: request ? Math.round(livePosition(request) * 10) / 10 : 0,
      positionAt: now(),
      nextAt: state.nextAt,
      accepting: s.accepting,
      platforms: enabledPlatforms(s),
      linkMode: s.chat.linkMode,
      volume: s.player.volume,
      playbackRate: s.player.playbackRate,
      loop: s.player.loop,
      autoplay: s.player.autoplay,
      votes: votingInfo(request),
      warning: state.warning ? { ...state.warning } : null,
      player: { online: state.player.online, activeId: state.player.id, problem: state.player.problem || null },
      queueInfo: queueInfo(),
      seekSeq: state.seekSeq,
      seq: state.seq,
      playbackSeq: state.playbackSeq,
    };
  }

  function enabledPlatforms(s) {
    const labels = { youtube: 'YouTube', shorts: 'Shorts', tiktok: 'TikTok', twitchClips: 'Клипы Twitch', twitchVods: 'Записи Twitch', vimeo: 'Vimeo', streamable: 'Streamable' };
    const css = { youtube: 'youtube', shorts: 'short', tiktok: 'tiktok', twitchClips: 'twitch', twitchVods: 'twitch', vimeo: 'vimeo', streamable: 'streamable' };
    return Object.keys(labels).filter((key) => s.providers[key]).map((key) => ({ key: css[key], label: labels[key] }));
  }

  function getQueue({ admin = false } = {}) {
    return repo.findQueued().map(admin ? adminRequest : publicRequest);
  }

  function queueInfo() {
    const queued = repo.findQueued();
    const request = current();
    let totalSec = 0;
    for (const item of queued) totalSec += effectiveDuration(item) || UNKNOWN_DURATION_SEC;
    let remainingSec = 0;
    if (request) {
      const play = effectiveDuration(request);
      remainingSec = play ? Math.max(0, (request.startSec || 0) + play - livePosition(request)) : UNKNOWN_DURATION_SEC;
    }
    return { count: queued.length, totalSec: Math.round(totalSec + remainingSec) };
  }

  function emitState() {
    // Vote and progress broadcasts must not invalidate native playback reports in flight.
    const playbackSignature = JSON.stringify([
      state.status,
      state.currentId,
      state.seekSeq,
      state.userPaused,
      Boolean(state.warning),
      Boolean(state.player.problem),
    ]);
    if (playbackSignature !== lastPlaybackSignature) {
      state.playbackSeq += 1;
      lastPlaybackSignature = playbackSignature;
    }
    state.seq += 1;
    state.lastProgressBroadcastAt = now();
    if (state.voteEmitTimer) { timers.clearTimeout(state.voteEmitTimer); state.voteEmitTimer = null; }
    broadcast({ type: 'video:state', state: getState() });
    const active = Boolean(state.currentId) && state.status === 'playing';
    const idle = !state.currentId && state.status === 'stopped';
    if (active !== state.active || idle) {
      state.active = active;
      try { onActivityChange({ active, idle }); } catch (error) { logError(error); }
    }
  }

  /** Голоса приходят пачками — отправляем состояние не чаще раза в 250 мс. */
  function emitStateSoon() {
    if (state.voteEmitTimer) return;
    state.voteEmitTimer = timers.setTimeout(() => { state.voteEmitTimer = null; emitState(); }, VOTE_EMIT_MS);
  }

  function emitQueue() {
    broadcast({ type: 'video:queue', queue: getQueue() });
  }

  function setPosition(sec) {
    state.positionSec = Math.max(0, Number(sec) || 0);
    state.positionAt = now();
  }

  function clearWait() {
    if (state.waitTimer) timers.clearTimeout(state.waitTimer);
    state.waitTimer = null;
    state.nextAt = null;
  }

  function clearWarning() {
    if (state.warningTimer) timers.clearTimeout(state.warningTimer);
    state.warningTimer = null;
    state.warning = null;
  }

  function resetVotes() {
    state.votes.clear();
    state.locked = false;
    state.voteOpensAt = now() + settings().voting.blockSec * 1000;
  }

  // ---------- переходы ----------

  function finishCurrent(status, reason) {
    const request = current();
    if (request && request.status === 'playing') {
      const { skip, keep } = tally();
      repo.updateRequest(request._id, { status, statusReason: reason || null, finishedAt: now(), votesSkip: skip, votesKeep: keep });
    }
    clearWarning();
    state.currentId = null;
    state.votes.clear();
    state.locked = false;
    setPosition(0);
  }

  function startRequest(request) {
    const started = repo.updateRequest(request._id, { status: 'playing', startedAt: now() });
    state.currentId = started._id;
    clearWarning();
    resetVotes();
    setPosition(started.startSec || 0);
    state.status = state.userPaused ? 'paused' : 'playing';
    if (state.announceNext) {
      state.announceNext = false;
      if (settings().player.announce) say(`📺 Сейчас: ${itemLine(started)}`);
    }
    return started;
  }

  function itemLine(request) {
    const play = effectiveDuration(request);
    return `${request.title}${play ? ` [${formatDuration(play)}]` : ''} — заказ от @${request.requestedByDisplay || request.requestedBy}`;
  }

  let transition = Promise.resolve();
  function serial(fn) {
    const run = transition.then(fn, fn);
    transition = run.catch(logError);
    return run;
  }
  const advance = () => serial(advanceNow);

  async function advanceNow() {
    clearWait();
    if (state.currentId) { emitState(); return; }
    const next = repo.findQueued()[0];
    if (next) startRequest(next);
    else {
      state.status = 'stopped';
      setPosition(0);
    }
    emitState();
    emitQueue();
  }

  async function afterFinish({ immediate = false } = {}) {
    const s = settings();
    if (state.userPaused) {
      state.status = 'paused';
      await advance();
      return;
    }
    if (!s.player.autoplay && !immediate) {
      state.status = 'stopped';
      state.userPaused = true;
      emitState();
      emitQueue();
      return;
    }
    if (!immediate && s.player.delaySec > 0 && repo.findQueued().length) {
      state.status = 'waiting';
      state.nextAt = now() + s.player.delaySec * 1000;
      state.waitTimer = timers.setTimeout(() => { state.waitTimer = null; advance().catch(logError); }, s.player.delaySec * 1000);
      emitState();
      emitQueue();
      return;
    }
    await advance();
  }

  /** Видео доиграло само (или кончилось оплаченное время без предупреждения). */
  async function finishPlayed() {
    const request = current();
    if (request && settings().player.loop) {
      // Повтор: начинаем то же видео заново, голоса сбрасываем.
      resetVotes();
      setPosition(request.startSec || 0);
      state.seekSeq += 1;
      emitState();
      return;
    }
    finishCurrent('played');
    await afterFinish();
  }

  // ---------- предупреждение перед скипом ----------

  function startWarning(reason) {
    const request = current();
    if (!request || state.warning) return;
    const sec = settings().voting.warningSec;
    setPosition(livePosition(request));
    state.status = 'paused';
    state.warning = { reason, startedAt: now(), endsAt: now() + sec * 1000 };
    // Не через serial: afterFinish сам ставит переход в очередь, вложенный serial зависнет.
    state.warningTimer = timers.setTimeout(() => {
      state.warningTimer = null;
      if (!state.warning || state.currentId !== request._id) return;
      finishCurrent('skipped', reason === 'paid' ? 'paid_end' : 'vote');
      afterFinish({ immediate: true }).catch(logError);
    }, sec * 1000);
    emitState();
  }

  /** Стример отменил скип: видео продолжается. */
  function cancelWarning() {
    const request = current();
    if (!state.warning || !request) return { ok: false, message: 'Нечего отменять.' };
    const { reason } = state.warning;
    clearWarning();
    if (reason === 'paid') repo.updateRequest(request._id, { playLimitSec: null }); // досматриваем до конца
    else resetVotes();
    state.status = state.userPaused ? 'paused' : 'playing';
    setPosition(state.positionSec);
    emitState();
    return { ok: true, message: 'Скип отменён.' };
  }

  async function triggerVoteSkip(request) {
    if (settings().voting.action === 'warning') {
      startWarning('vote');
      return { ok: true, message: `⏭️ Чат проголосовал за скип «${request.title}».` };
    }
    await skip('vote');
    return withNowPlaying({ ok: true, message: `⏭️ Чат проголосовал: «${request.title}» пропущено.` });
  }

  // ---------- заказ ----------

  function reject(message, code) {
    return { ok: false, code, message };
  }

  function findPosition(isPaid) {
    const queue = repo.findQueued();
    const last = queue.length ? queue[queue.length - 1].position : 0;
    const s = settings();
    const firstFreeIndex = queue.findIndex((item) => !item.isPaid && item.source !== 'admin');
    if (isPaid && s.paid.prioritize) {
      // Донат встаёт после последнего доната, но перед бесплатными.
      if (firstFreeIndex < 0) return last + 1;
      const before = firstFreeIndex > 0 ? queue[firstFreeIndex - 1].position : queue[firstFreeIndex].position - 1;
      return (before + queue[firstFreeIndex].position) / 2;
    }
    if (!isPaid && s.queue.insertRandomly && firstFreeIndex >= 0) {
      // Случайное место среди бесплатных (донаты всё равно впереди).
      const index = firstFreeIndex + Math.floor(random() * (queue.length - firstFreeIndex + 1));
      if (index >= queue.length) return last + 1;
      const before = index > 0 ? queue[index - 1].position : queue[index].position - 1;
      return (before + queue[index].position) / 2;
    }
    return last + 1;
  }

  /** Лимит бесплатных заказов для зрителя: максимум по его ролям; 0 — заказывать нельзя. */
  async function freeLimitFor(tags) {
    const s = settings();
    const role = roleFromTags(tags);
    if (role === 'broadcaster') return Infinity;
    const limits = s.limits.roleLimits;
    let best = limits.everyone;
    for (const item of LIMIT_ROLES) {
      if (item === 'everyone' || item === 'follower') continue;
      if (roleRank(role) >= roleRank(item)) best = Math.max(best, limits[item]);
    }
    if (limits.follower > best && await isFollower(tags).catch(() => false)) best = limits.follower;
    return best;
  }

  function filterError(track, s) {
    if (repo.isItemBlacklisted(track.provider, track.externalId)) return 'Это видео в чёрном списке.';
    if (repo.isChannelBlacklisted(track.provider, track.channelId)) return 'Видео с этого канала заказывать нельзя.';
    const f = s.filters;
    if (f.minViews > 0 && track.viewCount !== null && track.viewCount !== undefined && track.viewCount < f.minViews) {
      return `У видео слишком мало просмотров (нужно от ${f.minViews.toLocaleString('ru-RU')}).`;
    }
    if (track.publishedAt) {
      const ageDays = (now() - track.publishedAt) / 86400000;
      if (f.minAgeDays > 0 && ageDays < f.minAgeDays) return `Видео слишком свежее: можно заказывать ролики старше ${f.minAgeDays} дн.`;
      if (f.maxAgeDays > 0 && ageDays > f.maxAgeDays) return `Видео слишком старое: можно заказывать ролики не старше ${f.maxAgeDays} дн.`;
    }
    if (f.uniqueOnly && repo.wasPlayed(track.provider, track.externalId)) return 'Это видео уже смотрели.';
    return null;
  }

  function waitLabel(requestId) {
    const playing = current();
    if (playing && playing._id === requestId) return ' Уже на экране!';
    let sec = 0;
    if (playing) {
      const play = effectiveDuration(playing);
      sec += play ? Math.max(0, (playing.startSec || 0) + play - livePosition(playing)) : UNKNOWN_DURATION_SEC;
    }
    const queue = repo.findQueued();
    let place = 0;
    for (const item of queue) {
      place += 1;
      if (item._id === requestId) break;
      sec += effectiveDuration(item) || UNKNOWN_DURATION_SEC;
    }
    if (!playing && place === 1) return '';
    const minutes = Math.max(1, Math.round(sec / 60));
    return ` Место в очереди: ${place}, ~${minutes} мин.`;
  }

  /** Добавляет зрителя к уже заказанному видео («тоже хочу»). */
  function addCoRequester(existing, requester, login) {
    if (existing.requestedBy === login || (existing.coRequesters || []).some((item) => item.login === login)) {
      return reject('Это видео уже в очереди по твоему заказу.', 'duplicate_own');
    }
    if (!settings().chat.coRequest) return reject('Это видео уже в очереди.', 'duplicate');
    const list = [...(existing.coRequesters || []), { login, display: requester?.display || login, messageId: requester?.messageId || null }].slice(0, 50);
    repo.updateRequest(existing._id, { coRequesters: list });
    emitQueue();
    if (existing.status === 'playing') emitState();
    return { ok: true, code: 'co_request', request: adminRequest(repo.findById(existing._id)), message: `«${existing.title}» уже заказали — ты добавлен к заказу (${list.length + 1} чел.).` };
  }

  /**
   * @param {object} params
   * @param {string} params.input текст сообщения, ссылка или название
   * @param {{login, display?, id?, tags?, messageId?}} params.requester
   * @param {'chat'|'donation'|'admin'} params.source
   * @param {{amount, currency, amountRub, donationId}} [params.payment]
   */
  async function requestVideo({ input, requester, source, payment = null }) {
    const s = settings();
    const isAdmin = source === 'admin';
    const isPaid = source === 'donation';
    const login = String(requester?.login || '').toLowerCase();
    const text = String(input || '').trim().slice(0, 500);
    const tags = requester?.tags || {};

    if (!text) return reject('Кинь ссылку на видео: YouTube, Shorts, TikTok.', 'empty');
    if (!isAdmin) {
      if (!s.accepting) return reject('Приём видео сейчас закрыт.', 'closed');
      if (!isPaid) {
        if (repo.isUserBlacklisted(login)) return reject('Тебе запрещено заказывать видео.', 'user_blacklisted');
        if (tags['first-msg'] && !s.chat.firstTimeChatters) return reject('Заказывать видео можно со второго сообщения в чате.', 'first_message');
      }
      if (isPaid && payment && payment.amountRub === null && (s.paid.minAmountRub > 0 || s.paid.pricePerMinuteEnabled)) {
        return reject('Не удалось пересчитать сумму доната в рубли — стример добавит видео вручную.', 'currency');
      }
      if (isPaid && payment && payment.amountRub !== null && payment.amountRub < s.paid.minAmountRub) {
        return reject(`Минимальная сумма доната для заказа видео — ${s.paid.minAmountRub} ₽.`, 'min_amount');
      }
    }

    let link = providers.find(text, isAdmin ? null : s.providers);
    if (link && link.disabled) return reject(`Видео с ${PROVIDER_LABELS[link.provider] || link.provider}${link.kind === 'short' ? ' Shorts' : ''} сейчас не принимаются.`, 'provider_disabled');

    // Права проверяем до «тоже хочу»: иначе зритель без прав мог бы стать владельцем чужого заказа.
    let freeLimit = Infinity;
    if (!isAdmin && !isPaid) {
      freeLimit = await freeLimitFor(tags);
      if (freeLimit <= 0) return reject('У тебя нет прав заказывать видео через чат, но можно заказать через донат.', 'role');
    }

    // Повторный заказ того же видео — до запросов к площадке.
    if (link && link.id && !isPaid) {
      const existing = repo.findActiveByItem(link.provider, link.id);
      if (existing && !isAdmin) return addCoRequester(existing, requester, login);
    }
    const checkLimits = () => {
      if (isAdmin) return null;
      if (repo.findQueued().length >= s.limits.maxQueue) return reject('Очередь видео заполнена, попробуй позже.', 'queue_full');
      const limit = isPaid ? s.limits.maxPaidPerUser : freeLimit;
      if (repo.countActiveByRequester(login, isPaid) >= limit) {
        return reject(limit === 0 ? 'Такие заказы сейчас недоступны.' : `Твоих ${isPaid ? 'донатных ' : ''}видео в очереди уже ${limit} — это максимум.`, 'user_limit');
      }
      return null;
    };
    const limitError = checkLimits();
    if (limitError) return limitError;

    let track = null;
    try {
      if (link) track = await providers.resolve(link);
      else if (s.providers.youtube || isAdmin) track = await providers.search(text);
    } catch (error) {
      console.warn('[Video] Resolve failed:', error.message);
      return reject('Площадка сейчас не отвечает, попробуй позже.', 'provider_error');
    }
    if (!track) return reject(link ? 'Не удалось получить это видео — оно удалено, скрыто или недоступно.' : 'Не нашёл такое видео.', 'not_found');
    if (track.isLive) return reject('Прямые трансляции заказывать нельзя.', 'live');
    if (!isAdmin && track.kind === 'short' && !s.providers.shorts) return reject('YouTube Shorts сейчас не принимаются.', 'provider_disabled');
    if (!isAdmin && track.kind === 'video' && track.provider === 'youtube' && !s.providers.youtube) return reject('Видео с YouTube сейчас не принимаются (только Shorts).', 'provider_disabled');

    let startSec = Math.max(0, Math.floor(Number(link?.startSec) || 0));
    // Клипы Twitch и Streamable встраиваются без API перемотки — всегда с начала.
    if (track.kind === 'clip' || track.provider === 'streamable') startSec = 0;
    if (track.durationSec && startSec >= track.durationSec) startSec = 0;

    if (!isAdmin) {
      const error = filterError(track, s);
      if (error) return reject(error, 'filtered');
    }

    const full = track.durationSec ? track.durationSec - startSec : null;
    let playLimitSec = null;
    if (!isPaid && !isAdmin && full !== null && full > s.limits.maxFreeDurationSec) {
      return reject(`Видео слишком длинное (${formatDuration(full)}), максимум — ${formatDuration(s.limits.maxFreeDurationSec)}. Можно указать начало: start=1:30.`, 'too_long');
    }
    if (isPaid) {
      let limit = s.limits.maxPaidDurationSec;
      if (s.paid.pricePerMinuteEnabled && payment && payment.amountRub !== null) {
        const paidSec = Math.floor((payment.amountRub / s.paid.pricePerMinuteRub) * 60);
        if (paidSec < 5) return reject(`Суммы не хватает на просмотр (цена — ${s.paid.pricePerMinuteRub} ₽/мин).`, 'too_cheap');
        limit = Math.min(limit, paidSec);
      }
      if (full === null || full > limit) playLimitSec = limit;
    }

    // Повторные проверки после сетевых запросов: очередь, приём и настройки могли измениться.
    if (!isAdmin && !settings().accepting) return reject('Приём видео сейчас закрыт.', 'closed');
    if (requester?.messageId && deletedMessages.has(String(requester.messageId))) return reject('Сообщение удалено модератором.', 'message_deleted');
    const lateLimitError = checkLimits();
    if (lateLimitError) return lateLimitError;
    if (!isAdmin && !isPaid) {
      const existing = repo.findActiveByItem(track.provider, track.externalId);
      if (existing) return addCoRequester(existing, requester, login);
    }

    const request = repo.createRequest({
      ...track,
      requestedBy: login || 'unknown',
      requestedByDisplay: requester?.display || login,
      requestedById: requester?.id || null,
      messageId: requester?.messageId || null,
      source,
      isPaid,
      amount: payment?.amount ?? null,
      currency: payment?.currency ?? null,
      amountRub: payment?.amountRub ?? null,
      donationId: payment?.donationId ?? null,
      startSec,
      playLimitSec,
      position: findPosition(isPaid),
    });

    await onQueueChanged();
    checkAutoClose();
    const limitNote = playLimitSec ? ` Оплачено ${formatDuration(playLimitSec)}.` : '';
    return { ok: true, request: adminRequest(request), message: `«${track.title}» в очереди.${waitLabel(request._id)}${limitNote}` };
  }

  /** Очередь набрала максимальную длину — закрываем приём (как в chat.vote). */
  function checkAutoClose() {
    const s = settings();
    if (!s.accepting || s.limits.maxQueueDurationMin <= 0) return;
    if (queueInfo().totalSec >= s.limits.maxQueueDurationMin * 60) {
      setAccepting(false, { reason: 'full' });
    }
  }

  function onQueueChanged() {
    return serial(async () => {
      const playing = current();
      const hasNext = repo.findQueued().length > 0;
      if (!playing && state.status === 'stopped' && hasNext && !state.userPaused && settings().player.autoplay) {
        await advanceNow();
        return;
      }
      emitQueue();
      emitState();
    });
  }

  // ---------- приём заказов ----------

  function setAccepting(on, { reason = null } = {}) {
    const s = settings();
    const value = Boolean(on);
    if (s.accepting === value) return { ok: true, accepting: value };
    settingsStore.patch((next) => ({ ...next, accepting: value }));
    if (value) state.userPaused = false; // открыли приём — смотрим видео
    if (s.chat.announceAccepting) {
      const names = ['youtube', 'shorts', 'tiktok', 'twitchClips', 'twitchVods', 'vimeo', 'streamable']
        .filter((key) => s.providers[key])
        .map((key) => ({ youtube: 'YouTube', shorts: 'Shorts', tiktok: 'TikTok', twitchClips: 'клипы Twitch', twitchVods: 'записи Twitch', vimeo: 'Vimeo', streamable: 'Streamable' })[key]);
      const how = s.chat.linkMode === 'any' ? 'кидайте ссылку в чат' : 'заказ: !video <ссылка>';
      if (value) say(`📺 Приём видео открыт — ${how} (${names.join(', ')}).`);
      else say(reason === 'full' ? '📺 Очередь видео заполнена — приём закрыт.' : '📺 Приём видео закрыт.');
    }
    if (value) onQueueChanged().catch(logError);
    else emitState();
    return { ok: true, accepting: value };
  }

  // ---------- управление ----------

  async function play() {
    state.userPaused = false;
    clearPlayerProblem();
    if (state.warning) return cancelWarning();
    if (state.status === 'paused' && state.currentId) {
      state.status = 'playing';
      setPosition(state.positionSec);
      emitState();
      return { ok: true, message: '▶️ Видео запущено.' };
    }
    if (state.status === 'playing') return { ok: true, message: 'Видео уже идёт.' };
    await advance();
    if (!state.currentId) return { ok: false, message: 'Очередь видео пуста.' };
    return { ok: true, message: '▶️ Видео запущено.' };
  }

  async function pause() {
    state.userPaused = true;
    if (state.status === 'waiting') {
      clearWait();
      state.status = 'stopped';
      emitState();
      return { ok: true, message: '⏸️ Пауза.' };
    }
    if (state.status !== 'playing') return { ok: true, message: 'Уже на паузе.' };
    setPosition(livePosition(current()));
    state.status = 'paused';
    emitState();
    return { ok: true, message: '⏸️ Пауза.' };
  }

  async function skip(reason = 'skipped') {
    const request = current();
    if (!request) {
      if (state.status === 'waiting') { await advance(); return { ok: true, message: '⏭️ Следующее видео.' }; }
      return { ok: false, message: 'Сейчас ничего не идёт.' };
    }
    finishCurrent('skipped', reason);
    await afterFinish({ immediate: true });
    return { ok: true, message: `⏭️ «${request.title}» пропущено.` };
  }

  function seek(sec) {
    const request = current();
    if (!request) return { ok: false, message: 'Сейчас ничего не идёт.' };
    const target = Number(sec);
    if (!Number.isFinite(target)) return { ok: false, message: 'Неверная позиция.' };
    const start = request.startSec || 0;
    const play = effectiveDuration(request);
    const max = play ? Math.max(start, start + play - 1) : Infinity;
    setPosition(Math.max(start, Math.min(max, target)));
    state.seekSeq += 1;
    emitState();
    return { ok: true };
  }

  function setVolume(value) {
    settingsStore.patch((next) => ({ ...next, player: { ...next.player, volume: Math.max(0, Math.min(100, Math.round(Number(value) || 0))) } }));
    emitState();
    return { ok: true };
  }

  function setPlaybackRate(value) {
    const rate = normalizePlaybackRate(value, null);
    if (rate === null) return { ok: false, message: 'Недоступная скорость.' };
    settingsStore.patch((next) => ({ ...next, player: { ...next.player, playbackRate: rate } }));
    emitState();
    return { ok: true, playbackRate: rate };
  }

  function setLoop(value) {
    settingsStore.patch((next) => ({ ...next, player: { ...next.player, loop: Boolean(value) } }));
    emitState();
    return { ok: true };
  }

  /** Стример закрепляет видео: голосование за скип для него выключено. */
  function toggleLock() {
    if (!state.currentId) return { ok: false, message: 'Сейчас ничего не идёт.' };
    const lock = !state.locked;
    // Сначала отменяем скип: cancelWarning сбрасывает голоса вместе с закреплением.
    if (lock && state.warning && state.warning.reason === 'vote') cancelWarning();
    state.locked = lock;
    emitState();
    return { ok: true };
  }

  async function removeRequest(id) {
    const request = repo.findById(id);
    if (!request) return { ok: false, message: 'Заявка не найдена.' };
    if (request.status === 'playing') return skip('removed');
    if (request.status !== 'queued') return { ok: false, message: 'Заявка уже не в очереди.' };
    repo.updateRequest(id, { status: 'removed', statusReason: 'removed', finishedAt: now() });
    emitQueue();
    emitState();
    return { ok: true, message: 'Заявка удалена.' };
  }

  function clearQueue() {
    repo.clearQueue('cleared');
    emitQueue();
    emitState();
    return { ok: true, message: 'Очередь очищена.' };
  }

  async function cancelOwnRequest({ login }) {
    const who = String(login || '').toLowerCase();
    const mine = repo.findQueued().filter((item) => item.requestedBy === who);
    const own = mine.filter((item) => item.source === 'chat' && !item.isPaid);
    if (!own.length) {
      if (mine.length) return { ok: false, message: 'Донатный заказ так отменить нельзя — напиши стримеру.' };
      return { ok: false, message: 'В очереди нет твоих видео.' };
    }
    const latest = own.reduce((a, b) => ((b.createdAt || 0) >= (a.createdAt || 0) ? b : a));
    removeOrPromote(latest, 'cancelled');
    return { ok: true, message: `«${latest.title}» убрано из очереди.` };
  }

  /**
   * Заказчик отказался от видео: если его «поддержали» другие зрители,
   * заказ переходит к первому из них, иначе снимается с очереди.
   */
  function removeOrPromote(request, reason) {
    const co = Array.isArray(request.coRequesters) ? request.coRequesters : [];
    if (co.length && request.status === 'queued' && !request.isPaid) {
      const [first, ...rest] = co;
      repo.updateRequest(request._id, { requestedBy: first.login, requestedByDisplay: first.display, messageId: first.messageId || null, coRequesters: rest });
    } else if (request.status === 'queued') {
      repo.updateRequest(request._id, { status: 'removed', statusReason: reason, finishedAt: now() });
    }
    emitQueue();
    emitState();
  }

  /** Модератор удалил сообщение со ссылкой — заказ из этого сообщения снимается. */
  async function onMessageDeleted(messageId) {
    if (!settings().chat.removeOnDelete || !messageId) return null;
    // Заказ мог ещё не сохраниться (идёт запрос к площадке) — запоминаем удалённые сообщения.
    deletedMessages.add(String(messageId));
    if (deletedMessages.size > 500) deletedMessages.delete(deletedMessages.values().next().value);
    const request = repo.findActiveByMessageId(messageId);
    if (!request) return null;
    if (request.messageId === String(messageId)) {
      if (request.status === 'playing') return skip('message_deleted');
      removeOrPromote(request, 'message_deleted');
      return { ok: true };
    }
    // Удалено сообщение «тоже хочу» — убираем только этого зрителя.
    const co = (request.coRequesters || []).filter((item) => item.messageId !== String(messageId));
    repo.updateRequest(request._id, { coRequesters: co });
    emitQueue();
    emitState();
    return { ok: true };
  }

  function reorder(ids) {
    const queued = new Set(repo.findQueued().map((item) => item._id));
    const ordered = (Array.isArray(ids) ? ids : []).map(String).filter((id) => queued.has(id));
    for (const id of queued) if (!ordered.includes(id)) ordered.push(id);
    repo.applyOrder(ordered);
    emitQueue();
    return { ok: true };
  }

  /** Поднять заявку в начало очереди («Смотреть следующим»). */
  function moveToTop(id) {
    const queue = repo.findQueued().map((item) => item._id);
    if (!queue.includes(id)) return { ok: false, message: 'Заявка не найдена.' };
    return reorder([id, ...queue.filter((item) => item !== id)]);
  }

  async function blacklistRequest(id, { channel = false, user = false } = {}) {
    const request = repo.findById(id);
    if (!request) return { ok: false, message: 'Заявка не найдена.' };
    repo.addBlacklistedItem({ provider: request.provider, externalId: request.externalId, title: request.title });
    if (channel && request.channelId) repo.addBlacklistedChannel({ provider: request.provider, channelId: request.channelId, name: request.author });
    if (user && request.source === 'chat') {
      repo.addBlacklistedUser(request.requestedBy);
      // Как в chat.vote: бан зрителя убирает все его заказы.
      repo.findQueued().filter((item) => item.requestedBy === request.requestedBy && item._id !== id && !item.isPaid)
        .forEach((item) => repo.updateRequest(item._id, { status: 'removed', statusReason: 'blacklisted', finishedAt: now() }));
    }
    if (request.status === 'playing') await skip('blacklisted');
    else if (request.status === 'queued') {
      repo.updateRequest(id, { status: 'removed', statusReason: 'blacklisted', finishedAt: now() });
    }
    emitQueue();
    emitState();
    return { ok: true, message: 'Добавлено в чёрный список.' };
  }

  // ---------- голосование ----------

  function voteWeight(tags) {
    const v = settings().voting;
    const role = roleFromTags(tags);
    if (['moderator', 'lead_moderator', 'broadcaster'].includes(role)) return v.modWeight;
    if (role === 'vip') return v.vipWeight;
    return 1;
  }

  function parseVote(message) {
    const first = String(message || '').trim().split(/\s+/)[0];
    if (!first) return null;
    const word = first.toLowerCase();
    const v = settings().voting;
    if (v.skipWords.some((item) => item.toLowerCase() === word)) return 'skip';
    if (v.keepWords.some((item) => item.toLowerCase() === word)) return 'keep';
    return null;
  }

  /**
   * Голос из чата (первое слово сообщения — слово или смайл из настроек).
   * Возвращает null, если сообщение не голос; иначе результат (в чат обычно не отвечаем).
   */
  async function vote({ login, tags, message, kind = null }) {
    const choice = kind || parseVote(message);
    if (!choice) return null;
    const request = current();
    if (!request) return { ok: false, silent: true, message: 'Сейчас ничего не идёт.' };
    const info = votingInfo(request);
    if (info.blocked) {
      const reasons = { disabled: 'Голосование выключено.', paid: 'Донатное видео нельзя пропустить голосованием.', locked: 'Видео закреплено — голосование закрыто.', warning: 'Видео уже пропускается.' };
      return { ok: false, silent: true, message: reasons[info.blocked] || 'Голосование недоступно.' };
    }
    if (state.voteOpensAt > now()) return { ok: false, silent: true, message: 'Голосование ещё не началось.' };
    const key = String(login || '').toLowerCase();
    if (!key) return null;
    const previous = state.votes.get(key);
    if (previous) {
      if (previous.vote === choice) return { ok: false, silent: true, message: 'Ты уже проголосовал.' };
      if (!settings().voting.canChangeVote) return { ok: false, silent: true, message: 'Голос менять нельзя.' };
    }
    state.votes.set(key, { vote: choice, weight: voteWeight(tags) });

    const v = settings().voting;
    const { skip: skipVotes, keep } = tally();
    if (skipVotes - keep >= v.needed) {
      return { ...(await triggerVoteSkip(request)), silent: false };
    }
    if (v.lockEnabled && keep - skipVotes >= v.lockVotes) {
      state.locked = true;
      emitState();
      return { ok: true, silent: false, message: `📌 Чат решил: «${request.title}» досматриваем до конца.` };
    }
    emitStateSoon();
    return { ok: true, silent: true, message: `Голос принят: скип ${skipVotes} / оставить ${keep}.` };
  }

  /** !vskip: с правами — мгновенный скип, без прав — голос за скип. */
  async function skipCommand({ login, tags }) {
    if (await hasRoleAtLeast(tags, settings().control.skipRole, isFollower)) return withNowPlaying(await skip('skipped'));
    const result = await vote({ login, tags, kind: 'skip' });
    if (result && result.silent && result.ok) {
      const { skip: s, keep } = tally();
      return { ok: true, message: `Голос за скип принят: ${Math.round((s - keep) * 100) / 100}/${settings().voting.needed}.` };
    }
    return result || { ok: false, message: 'Сейчас ничего не идёт.' };
  }

  function withNowPlaying(result) {
    if (!result.ok) return result;
    const next = current();
    if (next) {
      if (settings().player.announce) return { ...result, message: `${result.message} Сейчас: ${itemLine(next)}` };
    } else if (state.status === 'waiting') {
      state.announceNext = true;
    }
    return result;
  }

  function nowPlayingLine() {
    const request = current();
    if (!request) return null;
    return itemLine(request);
  }

  // ---------- плеер на странице ----------

  function registerPlayer(playerId, { takeover = true } = {}) {
    const id = String(playerId).slice(0, 64);
    if (!takeover && state.player.online && state.player.id && state.player.id !== id) return getState({ admin: true });
    setPosition(livePosition(current()));
    state.errorStreak = 0;
    state.player = { id, lastSeenAt: now(), online: true, problem: null };
    emitState();
    return getState({ admin: true });
  }

  function clearPlayerProblem() {
    state.errorStreak = 0;
    if (state.player.problem) state.player.problem = null;
  }

  function touchPlayer(playerId) {
    if (state.player.id !== playerId) return false;
    state.player.lastSeenAt = now();
    if (!state.player.online) {
      state.player.online = true;
      setPosition(state.positionSec);
      emitState();
    }
    return true;
  }

  /** Плеер сообщил длительность ролика (TikTok, Streamable отдают её только при запуске). */
  function applyDuration(request, duration) {
    const sec = Math.round(Number(duration));
    if (!Number.isFinite(sec) || sec <= 0 || request.durationSec) return request;
    const patch = { durationSec: sec };
    const s = settings();
    const full = sec - (request.startSec || 0);
    if (!request.isPaid && request.source !== 'admin' && full > s.limits.maxFreeDurationSec) patch.playLimitSec = s.limits.maxFreeDurationSec;
    const updated = repo.updateRequest(request._id, patch);
    emitState();
    return updated;
  }

  /**
   * Отчёт плеера. event: progress | playing | paused | ended | error.
   * Возвращает active:false, если этот плеер не активный (тогда он должен замолчать).
   */
  async function playerReport({ playerId, event, requestId, position, duration, errorCode, seekSeq, seq, playbackSeq }) {
    if (!touchPlayer(String(playerId || ''))) return { ok: false, active: false };
    let request = current();
    if (!request || request._id !== requestId) return { ok: true, active: true };
    const reportedStateSeq = state.seq;
    const reportedPlaybackSeq = state.playbackSeq;
    if (duration !== undefined && duration !== null && duration !== '') request = applyDuration(request, duration);

    if (event === 'playing' || event === 'paused') {
      const hasPlaybackSeq = playbackSeq !== undefined && playbackSeq !== null;
      const staleState = hasPlaybackSeq
        ? Number(playbackSeq) !== reportedPlaybackSeq
        : (seq !== undefined && seq !== null && Number(seq) !== reportedStateSeq);
      const staleSeek = seekSeq !== undefined && seekSeq !== null && Number(seekSeq) !== state.seekSeq;
      if (staleState || staleSeek) return { ok: true, active: true };

      const hasPosition = position !== undefined && position !== null && position !== '';
      const pos = hasPosition ? Number(position) : NaN;
      const hasValidPosition = Number.isFinite(pos);

      if (event === 'playing') {
        // A native embed event must not cancel a server-side warning or error pause.
        if (state.warning || state.player.problem) return { ok: true, active: true };
        const changed = state.status !== 'playing' || state.userPaused;
        setPosition(hasValidPosition ? pos : (state.status === 'playing' ? livePosition(request) : state.positionSec));
        state.status = 'playing';
        state.userPaused = false;
        if (changed) emitState();
      } else {
        // Warning and error pauses are controlled by the server. Keep them from
        // turning into a manual pause that suppresses autoplay after the warning.
        if (state.warning || state.player.problem) {
          if (hasValidPosition) setPosition(pos);
          return { ok: true, active: true };
        }
        const changed = state.status !== 'paused' || !state.userPaused;
        setPosition(hasValidPosition ? pos : livePosition(request));
        state.status = 'paused';
        state.userPaused = true;
        if (changed) emitState();
      }
    }

    if (event === 'progress') {
      const hasPosition = position !== undefined && position !== null && position !== '';
      const pos = hasPosition ? Number(position) : NaN;
      const staleSeek = seekSeq !== undefined && seekSeq !== null && Number(seekSeq) !== state.seekSeq;
      if (Number.isFinite(pos) && state.status === 'playing' && !staleSeek) {
        if (state.errorStreak || state.player.problem) {
          clearPlayerProblem();
          emitState();
        }
        setPosition(pos);
        const play = effectiveDuration(request);
        const endSec = play ? (request.startSec || 0) + play : null;
        if (endSec && pos >= endSec - 0.3) {
          const full = fullDuration(request);
          const cutByPayment = request.isPaid && request.playLimitSec && (full === null || request.playLimitSec < full);
          if (cutByPayment && settings().paid.endAction === 'warning') startWarning('paid');
          else await finishPlayed();
        } else if (now() - state.lastProgressBroadcastAt >= PROGRESS_BROADCAST_MS) {
          emitState();
        }
      }
    } else if (event === 'ended') {
      clearPlayerProblem();
      await finishPlayed();
    } else if (event === 'error') {
      const code = Number(errorCode);
      state.errorStreak += 1;
      if (state.errorStreak >= PLAYER_ERROR_STREAK) {
        setPosition(livePosition(request));
        state.status = 'paused';
        state.player.problem = `Несколько видео подряд не воспроизводятся (ошибка ${errorCode}), очередь на паузе. Проверьте, что браузер вошёл в YouTube, и нажмите «Играть».`;
        emitState();
        return { ok: true, active: true };
      }
      const reason = [101, 150].includes(code) ? 'автор запретил встраивание' : (code === 100 ? 'видео удалено или скрыто' : `ошибка плеера ${errorCode}`);
      finishCurrent('failed', reason);
      say(`⚠️ Не удалось показать «${request.title}»: ${reason}. Пропускаю.`);
      await afterFinish({ immediate: true });
    }
    return { ok: true, active: true };
  }

  function checkPlayerTimeout() {
    if (state.player.online && now() - state.player.lastSeenAt > PLAYER_TIMEOUT_MS) {
      setPosition(livePosition(current()));
      state.player.online = false;
      emitState();
    }
  }

  // ---------- донаты ----------

  /** Явный заказ музыки в донате: такие донаты всегда уходят в музыкальную очередь. */
  function isMusicCommand(message) {
    return /(?:^|\s)!(?:sr|ык)\s+\S/i.test(message) || /(?:^|[\s(])sr\s*:\s*\S/i.test(message);
  }

  /**
   * Донат со ссылкой на видео при открытом приёме. Возвращает null, если донат
   * не про видео (тогда его обработает заказ музыки).
   */
  async function handleDonation(donation) {
    const s = settings();
    const message = String(donation.message || '');
    if (!s.accepting || isMusicCommand(message)) return null;
    const link = providers.find(message, null);
    if (!link) return null;
    if (donation._id && repo.findByDonationId(donation._id)) return { ok: false, code: 'duplicate_donation', message: 'Уже обработан.' };
    const display = String(donation.donorName || 'Anonymous').replace(/^❤️\s*/, '').trim() || 'Anonymous';
    let amountRub = null;
    try { amountRub = await getRubAmount(Number(donation.amount), donation.currency); } catch (_) { amountRub = null; }
    const result = await requestVideo({
      input: message,
      requester: { login: display.toLowerCase().replace(/\s+/g, '_'), display },
      source: 'donation',
      payment: { amount: Number(donation.amount), currency: donation.currency || 'RUB', amountRub, donationId: donation._id ? String(donation._id) : null },
    });
    say(`@${display} ${result.ok ? '💸 ' : '⚠️ '}${result.message}`);
    return result;
  }

  // ---------- жизненный цикл ----------

  function init() {
    const playing = repo.findAllPlaying().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    playing.slice(1).forEach((item) => repo.updateRequest(item._id, { status: 'queued' }));
    if (playing[0]) {
      state.currentId = playing[0]._id;
      state.status = 'paused';
      setPosition(playing[0].startSec || 0);
    }
    if (!watchdog) watchdog = timers.setInterval(checkPlayerTimeout, 3000);
    if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
  }

  function stop() {
    if (watchdog) timers.clearInterval(watchdog);
    watchdog = null;
    clearWait();
    clearWarning();
    if (state.voteEmitTimer) timers.clearTimeout(state.voteEmitTimer);
  }

  function onSettingsChanged() {
    emitState();
    emitQueue();
  }

  function logError(error) {
    console.error('[Video]', error);
  }

  return {
    init,
    stop,
    getState,
    getQueue,
    requestVideo,
    setAccepting,
    play,
    pause,
    skip,
    seek,
    setVolume,
    setPlaybackRate,
    setLoop,
    toggleLock,
    cancelWarning,
    removeRequest,
    clearQueue,
    cancelOwnRequest,
    onMessageDeleted,
    reorder,
    moveToTop,
    blacklistRequest,
    vote,
    parseVote,
    skipCommand,
    nowPlayingLine,
    registerPlayer,
    playerReport,
    handleDonation,
    onSettingsChanged,
    onQueueChanged,
    _state: state,
  };
}

module.exports = { createVideoService };
