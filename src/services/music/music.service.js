'use strict';

// Ядро заказа музыки: очередь, состояние плеера, правила заказа, голосование
// за скип и бэкап-плейлист.
//
// Источник истины — сервер. Звук воспроизводит док OBS (/music/dock): он
// получает состояние через WebSocket, сам загружает нужный трек и сообщает
// серверу прогресс, окончание и ошибки (HTTP с токеном). Активен только
// последний зарегистрированный док, чтобы трек не играл дважды.

const { formatDuration, effectiveDuration, publicRequest, adminRequest } = require('./musicFormat');
const { roleFromTags, hasRoleAtLeast, matchesAnyRole } = require('./musicRoles');

const PLAYER_TIMEOUT_MS = 12000;
const PROGRESS_BROADCAST_MS = 5000;
const PLAYER_ERROR_STREAK = 3;
const BACKUP_REFRESH_MS = 6 * 60 * 60 * 1000;

function createMusicService({
  repo,
  settingsStore,
  provider,
  broadcast = () => {},
  say = () => {},
  isFollower = async () => false,
  getRubAmount = async (amount, currency) => (String(currency || 'RUB').toUpperCase() === 'RUB' ? amount : null),
  now = Date.now,
  timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  random = Math.random,
} = {}) {
  const state = {
    status: 'stopped', // stopped | playing | paused | waiting
    currentId: null,
    positionSec: 0,
    positionAt: 0,
    userPaused: true, // после запуска бота музыка не стартует сама
    votes: new Map(),
    player: { id: null, lastSeenAt: 0, online: false, problem: null },
    errorStreak: 0, // ошибки плеера подряд без единого реально сыгранного трека
    waitTimer: null,
    nextAt: null,
    seq: 0,
    seekSeq: 0, // растёт при каждой перемотке; док сверяет его, чтобы не затереть её старым прогрессом
    announceNext: false, // объявить в чате следующий трек (только после !skip / голосования)
    lastProgressBroadcastAt: 0,
  };
  const backup = { url: '', items: [], loadedAt: 0, index: 0, recent: [], loading: null };
  let watchdog = null;

  const settings = () => settingsStore.get();

  // ---------- состояние ----------

  function current() {
    return state.currentId ? repo.findById(state.currentId) : null;
  }

  function livePosition(request) {
    if (!request) return 0;
    if (state.status !== 'playing' || !state.player.online) return state.positionSec;
    const elapsed = (now() - state.positionAt) / 1000;
    const end = (request.startSec || 0) + effectiveDuration(request);
    return Math.min(end || Infinity, state.positionSec + Math.max(0, elapsed));
  }

  function voteInfo() {
    const s = settings();
    let total = 0;
    for (const weight of state.votes.values()) total += weight;
    return { enabled: s.community.voteSkipEnabled, total: Math.round(total * 100) / 100, needed: s.community.voteSkipThreshold, voters: state.votes.size };
  }

  function getState() {
    const request = current();
    const s = settings();
    return {
      status: state.status,
      current: publicRequest(request),
      positionSec: request ? Math.round(livePosition(request) * 10) / 10 : 0,
      positionAt: now(),
      nextAt: state.nextAt,
      volume: s.player.volume,
      autoplay: s.player.autoplay,
      votes: voteInfo(),
      player: { online: state.player.online, activeId: state.player.id, problem: state.player.problem || null },
      overlayMode: s.obs.overlayMode,
      seekSeq: state.seekSeq,
      seq: state.seq,
    };
  }

  function getQueue({ admin = false } = {}) {
    return repo.findQueued().map(admin ? adminRequest : publicRequest);
  }

  function emitState() {
    state.seq += 1;
    state.lastProgressBroadcastAt = now();
    broadcast({ type: 'music:state', state: getState() });
  }

  function emitQueue() {
    broadcast({ type: 'music:queue', queue: getQueue() });
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

  // ---------- выбор следующего трека ----------

  function isPlayableType(request) {
    const playTypes = settings().playTypes;
    if (request.source === 'admin' || playTypes === 'all') return true;
    return playTypes === 'paid' ? request.isPaid : !request.isPaid;
  }

  function finishCurrent(status, reason) {
    const request = current();
    if (request && request.status === 'playing') {
      repo.updateRequest(request._id, { status, statusReason: reason || null, finishedAt: now() });
    }
    state.currentId = null;
    state.votes.clear();
    setPosition(0);
  }

  function startRequest(request) {
    const started = repo.updateRequest(request._id, { status: 'playing', startedAt: now() });
    state.currentId = started._id;
    state.votes.clear();
    setPosition(started.startSec || 0);
    state.status = state.userPaused ? 'paused' : 'playing';
    if (state.announceNext) {
      state.announceNext = false;
      if (settings().player.announce) say(`🎵 Сейчас играет: ${trackLine(started)}`);
    }
    return started;
  }

  function trackLine(request) {
    const by = request.source === 'backup' ? 'из плейлиста' : `заказ от @${request.requestedByDisplay || request.requestedBy}`;
    return `${request.title} [${formatDuration(effectiveDuration(request))}] — ${by}`;
  }

  // Переходы между треками выполняются строго по очереди: иначе два
  // параллельных advance (например, автостарт и загрузка бэкапа) затрут друг друга.
  let transition = Promise.resolve();
  function serial(fn) {
    const run = transition.then(fn, fn);
    transition = run.catch(logError);
    return run;
  }
  const advance = () => serial(advanceNow);

  async function advanceNow() {
    clearWait();
    if (state.currentId) {
      // Пока ждали очереди, трек уже запустили — ничего не делаем.
      emitState();
      return;
    }
    const next = repo.findQueued().find(isPlayableType);
    if (next) {
      startRequest(next);
    } else {
      const backupRequest = await createBackupRequest();
      // Пока грузился плейлист, мог прийти настоящий заказ.
      const late = repo.findQueued().find(isPlayableType);
      if (late) {
        if (backupRequest) repo.updateRequest(backupRequest._id, { status: 'removed', statusReason: 'superseded', finishedAt: now() });
        startRequest(late);
      } else if (backupRequest) {
        startRequest(backupRequest);
      } else {
        state.currentId = null;
        state.status = 'stopped';
        setPosition(0);
      }
    }
    emitState();
    emitQueue();
  }

  /** Трек закончился (или его прервали) — решаем, что дальше. */
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
    if (!immediate && s.player.delaySec > 0) {
      state.status = 'waiting';
      state.nextAt = now() + s.player.delaySec * 1000;
      state.waitTimer = timers.setTimeout(() => { state.waitTimer = null; advance().catch(logError); }, s.player.delaySec * 1000);
      emitState();
      emitQueue();
      return;
    }
    await advance();
  }

  // ---------- бэкап-плейлист ----------

  async function loadBackup(force = false) {
    const url = settings().backup.playlistUrl;
    if (!url) { backup.url = ''; backup.items = []; return backup.items; }
    if (!force && backup.url === url && backup.items.length && now() - backup.loadedAt < BACKUP_REFRESH_MS) return backup.items;
    if (backup.loading) return backup.loading;
    backup.loading = (async () => {
      try {
        const items = await provider.getPlaylistItems(url, { max: 1000 });
        if (items.length || backup.url !== url) {
          backup.items = items;
          backup.index = 0;
          backup.recent = [];
        }
        backup.url = url;
        backup.loadedAt = now();
      } catch (error) {
        console.warn('[Music] Backup playlist load failed:', error.message);
      } finally {
        backup.loading = null;
      }
      return backup.items;
    })();
    return backup.loading;
  }

  function pickBackupItem(items) {
    if (!items.length) return null;
    if (!settings().backup.shuffle) {
      const item = items[backup.index % items.length];
      backup.index = (backup.index + 1) % items.length;
      return item;
    }
    const avoid = new Set(backup.recent);
    const pool = items.filter((item) => !avoid.has(item.externalId));
    const list = pool.length ? pool : items;
    const item = list[Math.floor(random() * list.length)];
    backup.recent.push(item.externalId);
    const memory = Math.min(50, Math.floor(items.length / 2));
    while (backup.recent.length > memory) backup.recent.shift();
    return item;
  }

  async function createBackupRequest() {
    const items = await loadBackup();
    const attempts = Math.min(items.length, 25);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const item = pickBackupItem(items);
      if (!item || repo.isTrackBlacklisted('youtube', item.externalId)) continue;
      let track = null;
      try { track = await provider.getVideo(item.externalId); } catch (_) { track = null; }
      if (!track || track.isLive) continue;
      return repo.createRequest({
        ...track,
        requestedBy: 'backup',
        requestedByDisplay: 'Бэкап-плейлист',
        source: 'backup',
        isPaid: false,
        position: 0,
        status: 'queued',
      });
    }
    return null;
  }

  // ---------- заказ трека ----------

  function reject(message, code) {
    return { ok: false, code, message };
  }

  function findPosition(isPaid) {
    const queue = repo.findQueued();
    const last = queue.length ? queue[queue.length - 1].position : 0;
    if (!isPaid || !settings().paid.prioritize) return last + 1;
    // Платный встаёт после последнего платного, но перед бесплатными.
    const firstFreeIndex = queue.findIndex((item) => !item.isPaid && item.source !== 'admin');
    if (firstFreeIndex < 0) return last + 1;
    const before = firstFreeIndex > 0 ? queue[firstFreeIndex - 1].position : queue[firstFreeIndex].position - 1;
    return (before + queue[firstFreeIndex].position) / 2;
  }

  async function passesFilters(track, s) {
    if (repo.isTrackBlacklisted(track.provider, track.externalId)) return 'Этот трек в чёрном списке.';
    const blocked = new Set(s.filters.blockedTags);
    if (blocked.size) {
      const hashtags = (String(track.title || '').match(/#[\p{L}\p{N}_]+/gu) || []).map((tag) => tag.slice(1).toLowerCase());
      const hit = [...(track.tags || []), ...hashtags].find((tag) => blocked.has(String(tag).toLowerCase()));
      if (hit) return `У трека запрещённый тег «${hit}».`;
    }
    if (s.filters.minViews > 0 && track.viewCount !== null && track.viewCount !== undefined && track.viewCount < s.filters.minViews) {
      return `У видео слишком мало просмотров (нужно от ${s.filters.minViews.toLocaleString('ru-RU')}).`;
    }
    if (s.filters.minLikePercent > 0 && typeof provider.getRating === 'function') {
      const rating = await provider.getRating(track.externalId).catch(() => null);
      if (rating && rating.percent !== null && rating.percent < s.filters.minLikePercent) {
        return `У видео слишком мало лайков: ${rating.percent}% (нужно от ${s.filters.minLikePercent}%).`;
      }
    }
    return null;
  }

  /**
   * @param {object} params
   * @param {string} params.input ссылка, ID или название
   * @param {{login:string, display?:string, id?:string, tags?:object}} params.requester
   * @param {'chat'|'donation'|'admin'} params.source
   * @param {{amount:number, currency:string, amountRub:number|null, donationId:string}} [params.payment]
   */
  async function requestTrack({ input, requester, source, payment = null }) {
    const s = settings();
    const isAdmin = source === 'admin';
    const isPaid = source === 'donation';
    const login = String(requester?.login || '').toLowerCase();
    const query = String(input || '').trim().slice(0, 300);

    if (!query) return reject('Укажи ссылку на YouTube или название трека: !sr <трек>', 'empty');
    if (!isAdmin) {
      if (!s.enabled) return reject('Заказ музыки сейчас выключен.', 'disabled');
      if (isPaid && s.playTypes === 'free') return reject('Сейчас играют только бесплатные заказы, донатные не принимаются.', 'type');
      if (!isPaid && s.playTypes === 'paid') return reject('Сейчас принимаются только заказы через донат.', 'type');
      if (!isPaid) {
        if (repo.isUserBlacklisted(login)) return reject('Тебе запрещено заказывать музыку.', 'user_blacklisted');
        if (!(await matchesAnyRole(requester.tags, s.community.requestRoles, isFollower))) return reject('У тебя нет прав заказывать музыку через чат, но можно заказать через донат.', 'role');
      }
      if (isPaid && payment && payment.amountRub === null && (s.paid.minAmountRub > 0 || s.paid.pricePerSecondEnabled)) {
        return reject('Не удалось пересчитать сумму доната в рубли — стример добавит трек вручную.', 'currency');
      }
      if (isPaid && payment && payment.amountRub !== null && payment.amountRub < s.paid.minAmountRub) {
        return reject(`Минимальная сумма доната для заказа — ${s.paid.minAmountRub} ₽.`, 'min_amount');
      }
    }

    const checkLimits = () => {
      if (isAdmin) return null;
      if (repo.findQueued().length >= s.limits.maxQueue) return reject('Очередь заполнена, попробуй позже.', 'queue_full');
      const limit = isPaid ? s.limits.maxPaidPerUser : s.limits.maxFreePerUser;
      if (repo.countActiveByRequester(login, isPaid) >= limit) {
        return reject(limit === 0 ? 'Такие заказы сейчас недоступны.' : `У тебя уже ${limit} ${isPaid ? 'платных' : 'бесплатных'} заказов в очереди, это максимум.`, 'user_limit');
      }
      return null;
    };
    const limitError = checkLimits();
    if (limitError) return limitError;

    let resolved;
    try {
      resolved = await provider.resolve(query);
    } catch (error) {
      console.warn('[Music] Resolve failed:', error.message);
      return reject('YouTube сейчас не отвечает, попробуй позже.', 'provider_error');
    }
    if (!resolved || !resolved.track) return reject('Не нашёл такой трек на YouTube.', 'not_found');
    const { track } = resolved;
    let startSec = Math.max(0, Math.floor(Number(resolved.startSec) || 0));
    if (startSec >= track.durationSec) startSec = 0;
    if (track.isLive || !track.durationSec) return reject('Прямые трансляции заказывать нельзя.', 'live');

    if (!isAdmin) {
      const filterError = await passesFilters(track, s);
      if (filterError) return reject(filterError, 'filtered');
    }

    const fullSec = track.durationSec - startSec;
    let playLimitSec = null;
    if (!isPaid && !isAdmin && fullSec > s.limits.maxFreeDurationSec) {
      return reject(`Трек слишком длинный (${formatDuration(fullSec)}), максимум — ${formatDuration(s.limits.maxFreeDurationSec)}.`, 'too_long');
    }
    if (isPaid) {
      let limit = s.limits.maxPaidDurationSec;
      if (s.paid.pricePerSecondEnabled && payment && payment.amountRub !== null) {
        const paidSec = Math.floor(payment.amountRub / s.paid.pricePerSecondRub);
        if (paidSec < 1) return reject(`Суммы не хватает даже на секунду (цена — ${s.paid.pricePerSecondRub} ₽/сек).`, 'too_cheap');
        limit = Math.min(limit, paidSec);
      }
      if (fullSec > limit) playLimitSec = limit;
    }

    // Повторная проверка после асинхронных запросов: за это время очередь могла измениться.
    const lateLimitError = checkLimits();
    if (lateLimitError) return lateLimitError;
    if (!isAdmin && repo.findActiveByTrack(track.provider, track.externalId)) return reject('Этот трек уже в очереди.', 'duplicate');

    const request = repo.createRequest({
      ...track,
      requestedBy: login || 'unknown',
      requestedByDisplay: requester?.display || login,
      requestedById: requester?.id || null,
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
    const ahead = repo.findQueued().findIndex((item) => item._id === request._id);
    const playing = current();
    const limitNote = playLimitSec ? ` Будет играть ${formatDuration(playLimitSec)}.` : '';
    const placeNote = playing && playing._id !== request._id ? ` Место в очереди: ${ahead + 1}.` : '';
    return { ok: true, request: adminRequest(request), message: `«${track.title}» добавлен в очередь.${placeNote}${limitNote}` };
  }

  /**
   * Реакция на изменение очереди: автостарт и прерывание бэкапа. Выполняется
   * в той же цепочке, что и переходы, чтобы увидеть результат текущего перехода.
   */
  function onQueueChanged() {
    return serial(async () => {
      const playing = current();
      const hasReal = repo.findQueued().some(isPlayableType);
      if (playing && playing.source === 'backup' && hasReal && settings().backup.interrupt && state.status === 'playing') {
        finishCurrent('skipped', 'interrupted');
        await advanceNow();
        return;
      }
      if (!playing && state.status === 'stopped' && hasReal && !state.userPaused && settings().player.autoplay) {
        await advanceNow();
        return;
      }
      emitQueue();
    });
  }

  // ---------- управление ----------

  async function play() {
    state.userPaused = false;
    clearPlayerProblem();
    if (state.status === 'paused' && state.currentId) {
      state.status = 'playing';
      setPosition(state.positionSec);
      emitState();
      return { ok: true, message: '▶️ Плеер запущен.' };
    }
    if (state.status === 'playing') return { ok: true, message: 'Плеер уже играет.' };
    await advance();
    if (!state.currentId) return { ok: false, message: 'Очередь пуста — закажи трек: !sr <трек>' };
    return { ok: true, message: '▶️ Плеер запущен.' };
  }

  async function pause() {
    state.userPaused = true;
    if (state.status === 'waiting') {
      clearWait();
      state.status = 'stopped';
      emitState();
      return { ok: true, message: '⏸️ Плеер на паузе.' };
    }
    if (state.status !== 'playing') return { ok: true, message: 'Плеер уже на паузе.' };
    setPosition(livePosition(current()));
    state.status = 'paused';
    emitState();
    return { ok: true, message: '⏸️ Плеер на паузе.' };
  }

  async function skip(reason = 'skipped') {
    const request = current();
    if (!request) {
      if (state.status === 'waiting') { await advance(); return { ok: true, message: '⏭️ Следующий трек.' }; }
      return { ok: false, message: 'Сейчас ничего не играет.' };
    }
    finishCurrent('skipped', reason);
    await afterFinish({ immediate: true });
    return { ok: true, message: `⏭️ Трек «${request.title}» пропущен.` };
  }

  /** Перемотка: sec — абсолютная позиция в видео (с учётом startSec заявки). */
  function seek(sec) {
    const request = current();
    if (!request) return { ok: false, message: 'Сейчас ничего не играет.' };
    const target = Number(sec);
    if (!Number.isFinite(target)) return { ok: false, message: 'Неверная позиция.' };
    const start = request.startSec || 0;
    const end = start + effectiveDuration(request);
    setPosition(Math.max(start, Math.min(end > start ? end - 1 : start, target)));
    state.seekSeq += 1;
    emitState();
    return { ok: true };
  }

  function setVolume(value) {
    const s = settings();
    settingsStore.save({ ...s, player: { ...s.player, volume: Math.max(0, Math.min(100, Math.round(Number(value) || 0))) } });
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
    return { ok: true, message: 'Заявка удалена.' };
  }

  function reorder(ids) {
    const queued = new Set(repo.findQueued().map((item) => item._id));
    const ordered = (Array.isArray(ids) ? ids : []).map(String).filter((id) => queued.has(id));
    // Заявки, которых не было в списке (пришли во время перетаскивания), остаются в конце.
    for (const id of queued) if (!ordered.includes(id)) ordered.push(id);
    repo.applyOrder(ordered);
    emitQueue();
    return { ok: true };
  }

  async function blacklistRequest(id) {
    const request = repo.findById(id);
    if (!request) return { ok: false, message: 'Заявка не найдена.' };
    repo.addBlacklistedTrack({ provider: request.provider, externalId: request.externalId, title: request.title });
    if (request.status === 'playing') await skip('blacklisted');
    else if (request.status === 'queued') {
      repo.updateRequest(id, { status: 'removed', statusReason: 'blacklisted', finishedAt: now() });
      emitQueue();
    }
    return { ok: true, message: 'Трек добавлен в чёрный список.' };
  }

  // ---------- голосование ----------

  async function voteSkip({ login, tags }) {
    const request = current();
    if (!request) return { ok: false, message: 'Сейчас ничего не играет.' };
    const s = settings();
    if (!s.community.voteSkipEnabled) return { ok: false, message: 'Голосование за скип выключено.' };
    const key = String(login || '').toLowerCase();
    if (state.votes.has(key)) {
      const info = voteInfo();
      return { ok: false, message: `Ты уже проголосовал (${info.total}/${info.needed}).` };
    }
    const role = roleFromTags(tags);
    let weight = 1;
    if (['moderator', 'lead_moderator', 'broadcaster'].includes(role)) weight = s.community.modVoteWeight;
    else if (role === 'vip') weight = s.community.vipVoteWeight;
    state.votes.set(key, weight);
    const info = voteInfo();
    if (info.total >= info.needed) {
      await skip('vote');
      return withNowPlaying({ ok: true, message: `⏭️ Чат проголосовал: «${request.title}» пропущен.` });
    }
    emitState();
    return { ok: true, message: `Голос за скип принят: ${info.total}/${info.needed}.` };
  }

  /** !skip: с правами — мгновенный скип, без прав — голос. */
  async function skipCommand({ login, tags }) {
    if (await hasRoleAtLeast(tags, settings().community.skipRole, isFollower)) return withNowPlaying(await skip('skipped'));
    return voteSkip({ login, tags });
  }

  // После скипа из чата сообщаем, что заиграло; если трек стартует позже
  // (пауза между треками), объявление отправит startRequest.
  function withNowPlaying(result) {
    if (!result.ok) return result;
    const next = current();
    if (next) {
      if (settings().player.announce) return { ...result, message: `${result.message} Сейчас играет: ${trackLine(next)}` };
    } else if (state.status === 'waiting') {
      state.announceNext = true;
    }
    return result;
  }

  async function canControl(tags) {
    return hasRoleAtLeast(tags, settings().community.skipRole, isFollower);
  }

  // ---------- док-плеер ----------

  /**
   * Регистрирует док как активный плеер. Без takeover док не отбирает воспроизведение
   * у другого плеера, который сейчас онлайн (например, вкладка браузера и док в OBS).
   */
  function registerPlayer(playerId, { takeover = true } = {}) {
    const id = String(playerId).slice(0, 64);
    if (!takeover && state.player.online && state.player.id && state.player.id !== id) return getState();
    // Фиксируем позицию до смены статуса, чтобы время без плеера не засчиталось как проигранное.
    setPosition(livePosition(current()));
    state.errorStreak = 0;
    state.player = { id, lastSeenAt: now(), online: true, problem: null };
    emitState();
    return getState();
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

  /**
   * Отчёт дока. event: progress | ended | error.
   * Возвращает false, если док не активный (тогда он должен замолчать).
   */
  async function playerReport({ playerId, event, requestId, position, errorCode, seekSeq }) {
    if (!touchPlayer(String(playerId || ''))) return { ok: false, active: false };
    const request = current();
    if (!request || request._id !== requestId) return { ok: true, active: true };

    if (event === 'progress') {
      // Позицию док присылает только когда видео реально идёт; без неё это просто пинг.
      const hasPosition = position !== undefined && position !== null && position !== '';
      const pos = hasPosition ? Number(position) : NaN;
      // Прогресс, снятый до применения перемотки, игнорируем.
      const staleSeek = seekSeq !== undefined && seekSeq !== null && Number(seekSeq) !== state.seekSeq;
      if (Number.isFinite(pos) && state.status === 'playing' && !staleSeek) {
        if (state.errorStreak || state.player.problem) {
          clearPlayerProblem();
          emitState();
        }
        setPosition(pos);
        const endSec = (request.startSec || 0) + effectiveDuration(request);
        if (endSec > 0 && pos >= endSec - 0.3) {
          finishCurrent('played');
          await afterFinish();
        } else if (now() - state.lastProgressBroadcastAt >= PROGRESS_BROADCAST_MS) {
          emitState();
        }
      }
    } else if (event === 'ended') {
      clearPlayerProblem();
      finishCurrent('played');
      await afterFinish();
    } else if (event === 'error') {
      const code = Number(errorCode);
      state.errorStreak += 1;
      if (state.errorStreak >= PLAYER_ERROR_STREAK) {
        // Несколько треков подряд не играют — дело в плеере, а не в треках.
        // Не пролистываем очередь впустую, а ставим на паузу и показываем причину.
        setPosition(livePosition(request));
        state.status = 'paused';
        state.player.problem = `YouTube не даёт воспроизводить видео в этом плеере (ошибка ${errorCode}), очередь на паузе. Обычно так бывает, когда браузер не вошёл в YouTube и тот принимает его за бота.`;
        emitState();
        return { ok: true, active: true };
      }
      const reason = [101, 150].includes(code) ? 'YouTube запретил встроенное воспроизведение (автор отключил или плеер не вошёл в YouTube)' : (code === 100 ? 'видео удалено или скрыто' : `ошибка плеера ${errorCode}`);
      finishCurrent('failed', reason);
      if (request.source !== 'backup') say(`⚠️ Не удалось воспроизвести «${request.title}»: ${reason}. Пропускаю.`);
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

  /** Ищет в тексте доната заказ: ссылку YouTube, «!sr трек» или «sr: трек». */
  function parseDonationMessage(message, findUrl) {
    const text = String(message || '');
    const url = typeof findUrl === 'function' ? findUrl(text) : null;
    if (url) return url;
    const command = text.match(/(?:^|\s)!(?:sr|ык)\s+([^\n]+)/i) || text.match(/(?:^|[\s(])sr\s*:\s*([^\n]+)/i);
    return command ? command[1].trim() : null;
  }

  async function handleDonation(donation, { findUrl } = {}) {
    const input = parseDonationMessage(donation.message, findUrl);
    if (!input) return null;
    if (donation._id && repo.findByDonationId(donation._id)) return null;
    const display = String(donation.donorName || 'Anonymous').replace(/^❤️\s*/, '').trim() || 'Anonymous';
    let amountRub = null;
    try { amountRub = await getRubAmount(Number(donation.amount), donation.currency); } catch (_) { amountRub = null; }
    const result = await requestTrack({
      input: typeof input === 'string' ? input : input.url,
      requester: { login: display.toLowerCase().replace(/\s+/g, '_'), display },
      source: 'donation',
      payment: { amount: Number(donation.amount), currency: donation.currency || 'RUB', amountRub, donationId: donation._id ? String(donation._id) : null },
    });
    say(`@${display} ${result.ok ? '💸 ' : '⚠️ '}${result.message}`);
    return result;
  }

  // ---------- жизненный цикл ----------

  function init() {
    // После перезапуска восстанавливаем играющий трек на паузе.
    const playing = repo.findAllPlaying().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    playing.slice(1).forEach((item) => repo.updateRequest(item._id, { status: 'queued' }));
    if (playing[0]) {
      state.currentId = playing[0]._id;
      state.status = 'paused';
      setPosition(playing[0].startSec || 0);
    }
    if (!watchdog) watchdog = timers.setInterval(checkPlayerTimeout, 3000);
    if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
    loadBackup().catch(() => {});
  }

  function stop() {
    if (watchdog) timers.clearInterval(watchdog);
    watchdog = null;
    clearWait();
  }

  function onSettingsChanged() {
    loadBackup(true).catch(() => {});
    emitState();
    emitQueue();
  }

  function logError(error) {
    console.error('[Music]', error);
  }

  return {
    init,
    stop,
    getState,
    getQueue,
    requestTrack,
    play,
    pause,
    skip,
    seek,
    setVolume,
    removeRequest,
    reorder,
    blacklistRequest,
    voteSkip,
    skipCommand,
    canControl,
    registerPlayer,
    playerReport,
    handleDonation,
    parseDonationMessage,
    onSettingsChanged,
    onQueueChanged,
    reloadBackup: () => loadBackup(true),
    getBackupInfo: () => ({ url: backup.url, count: backup.items.length, loadedAt: backup.loadedAt }),
    _state: state,
  };
}

module.exports = { createMusicService };
