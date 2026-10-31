'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createQuizEngine, normalizeAnswer } = require('../src/services/quizEngine');

const words = [
  { clue: 'Дерево с белой корой', answers: ['берёза', 'береза'] },
  { clue: 'Им открывают дверь', answers: ['ключ'] },
];
const birchWord = [{ clue: 'Дерево с белой корой', answers: ['берёза', 'береза'] }];

function setup(options = {}) {
  let time = options.now ?? 1_800_000_000_000;
  let stream = Object.prototype.hasOwnProperty.call(options, 'stream')
    ? options.stream
    : { id: 'stream-1', started_at: new Date(time - 3 * 60 * 60 * 1000).toISOString() };
  let streamStatusError = false;
  const messages = [];
  const streamRequests = [];
  const startedStreams = new Set(options.startedStreams || []);
  const scores = new Map();
  const repository = {
    hasStarted: (id) => startedStreams.has(id),
    markStarted: (id) => startedStreams.add(id),
    addPoint: ({ userId, username, displayName }) => {
      const row = scores.get(userId) || { username, displayName, points: 0 };
      row.username = username;
      row.displayName = displayName;
      row.points += 1;
      scores.set(userId, row);
      return row.points;
    },
    getScore: (userId) => (scores.get(userId) || { points: 0 }).points,
    getTop: () => Array.from(scores.values())
      .sort((left, right) => right.points - left.points)
      .map(({ username, points }) => ({ username, points })),
  };
  const engine = createQuizEngine({
    getStream: async (requestOptions) => {
      streamRequests.push(requestOptions || {});
      if (options.getStream) return options.getStream(requestOptions);
      if (streamStatusError) throw new Error('temporary Twitch API failure');
      return stream;
    },
    repository,
    send: (message) => messages.push(String(message)),
    now: () => time,
    words: options.words || words,
    questionProvider: options.questionProvider || null,
    roundCount: options.roundCount ?? 2,
    roundDurationMs: options.roundDurationMs ?? 60_000,
    hintAfterMs: options.hintAfterMs ?? 30_000,
    breakMs: options.breakMs ?? 5_000,
    autoDelayMs: options.autoDelayMs ?? 2 * 60 * 60 * 1000,
  });

  return {
    engine,
    messages,
    streamRequests,
    repository,
    startedStreams,
    scores,
    setTime: (value) => { time = value; },
    advance: (delta) => { time += delta; },
    setStream: (value) => { stream = value; },
    setStreamStatusError: (value) => { streamStatusError = value; },
    getTime: () => time,
  };
}

const viewer = (userId = 'user-1', username = 'viewer') => ({
  'user-id': userId,
  username,
  'display-name': username,
  badges: {},
});

const broadcaster = () => ({
  'user-id': 'broadcaster-1',
  username: 'streamer',
  'display-name': 'Streamer',
  badges: { broadcaster: '1' },
  streamer: true,
});

test('normalizes case, surrounding whitespace, and ё/е consistently', () => {
  assert.equal(normalizeAnswer('  БЕРЕЗА '), normalizeAnswer('берёза'));
});

test('a viewer can start only while live; broadcaster can start while offline', async () => {
  const offline = setup({ stream: null });
  await offline.engine.command(viewer(), '!викторина');
  assert.equal(offline.engine.getState(), null, 'offline viewer command should not start a game');
  assert.ok(offline.messages.some((message) => /только во время стрима/i.test(message)));

  await offline.engine.command(broadcaster(), '!в');
  assert.ok(offline.messages.some((message) => /викторин|загад|слово/i.test(message)));

  const live = setup();
  await live.engine.command(viewer(), '!викторина');
  assert.ok(live.messages.some((message) => /викторин|загад|слово/i.test(message)));
});

test('manual activation is recorded for the stream so an engine restart will not auto-start it again', async () => {
  const setupOne = setup();
  await setupOne.engine.command(viewer(), '!в');
  assert.ok(setupOne.startedStreams.has('stream-1'));

  const setupTwo = setup({ startedStreams: Array.from(setupOne.startedStreams) });
  await setupTwo.engine.tick();
  assert.equal(setupTwo.messages.length, 0);
});

test('automatic activation waits until two hours after Twitch started_at', async () => {
  const startedAt = Date.parse('2026-01-01T00:00:00.000Z');
  const fixture = setup({
    now: startedAt + 2 * 60 * 60 * 1000 - 1,
    stream: { id: 'auto-stream', started_at: '2026-01-01T00:00:00.000Z' },
  });

  await fixture.engine.tick();
  assert.equal(fixture.messages.length, 0);

  fixture.advance(1);
  await fixture.engine.tick();
  assert.ok(fixture.messages.some((message) => /викторин|загад|слово/i.test(message)));
  assert.ok(fixture.startedStreams.has('auto-stream'));
});

test('first matching answer wins, awards one point, and accepts е for ё', async () => {
  const fixture = setup({ roundCount: 1, words: birchWord });
  await fixture.engine.start(viewer());

  fixture.engine.guess(viewer('alice-id', 'alice'), 'БЕРЕЗА');
  fixture.engine.guess(viewer('bob-id', 'bob'), 'берёза');

  assert.equal(fixture.repository.getScore('alice-id'), 1);
  assert.equal(fixture.repository.getScore('bob-id'), 0);
  assert.ok(fixture.messages.some((message) => /alice/i.test(message) && /1/.test(message)));
});

test('a correct answer starts the next round after the short break', async () => {
  const fixture = setup({ roundCount: 2 });
  await fixture.engine.start(viewer());
  const firstAnswer = fixture.engine.getState().answer;

  fixture.engine.guess(viewer(), firstAnswer);
  fixture.advance(5_000);
  await fixture.engine.tick();

  assert.equal(fixture.engine.getState().round, 2);
  assert.notEqual(fixture.engine.getState().answer, firstAnswer);
});

test('adds a hint after 30 seconds, reveals an unanswered word at 60 seconds, then finishes', async () => {
  const fixture = setup({ roundCount: 1, words: birchWord });
  await fixture.engine.start(viewer());
  const beforeHintCount = fixture.messages.length;

  fixture.advance(30_000);
  await fixture.engine.tick();
  assert.ok(fixture.messages.length > beforeHintCount);

  fixture.advance(30_000);
  await fixture.engine.tick();
  assert.ok(fixture.messages.some((message) => /бер[её]з/i.test(message)));
  assert.ok(fixture.messages.some((message) => /заверш|итог|спасибо|викторин законч/i.test(message)));
});

test('does not accept a correct guess after the round deadline', async () => {
  const fixture = setup({ roundCount: 1, words: birchWord });
  await fixture.engine.start(viewer());
  fixture.advance(60_001);

  fixture.engine.guess(viewer(), 'берёза');

  assert.equal(fixture.repository.getScore('user-1'), 0);
});

test('score and leaderboard commands return persisted score data', async () => {
  const fixture = setup({ roundCount: 1, words: birchWord });
  await fixture.engine.start(viewer());
  fixture.engine.guess(viewer('alice-id', 'alice'), 'берёза');
  await fixture.engine.command(viewer('alice-id', 'alice'), '!викторина очки');
  await fixture.engine.command(viewer(), '!в топ');

  assert.ok(fixture.messages.some((message) => /alice/i.test(message) && /1/.test(message)));
});

test('an offline broadcaster game still receives hints, times out, and advances rounds', async () => {
  const fixture = setup({ stream: null, roundCount: 2 });
  await fixture.engine.command(broadcaster(), '!викторина');

  fixture.advance(30_000);
  await fixture.engine.tick();
  assert.ok(fixture.messages.some((message) => /подсказка/i.test(message)));

  fixture.advance(30_000);
  await fixture.engine.tick();
  assert.ok(fixture.messages.some((message) => /время вышло/i.test(message)));
  fixture.advance(5_000);
  await fixture.engine.tick();
  assert.equal(fixture.engine.getState().round, 2);
});

test('a transient stream API failure does not pause an active round deadline', async () => {
  const fixture = setup({ roundCount: 1, words: birchWord });
  await fixture.engine.start(viewer());
  fixture.setStreamStatusError(true);
  fixture.advance(60_000);

  await fixture.engine.tick();
  assert.equal(fixture.repository.getScore('user-1'), 0);
  assert.ok(fixture.messages.some((message) => /время вышло/i.test(message)));
});

test('a broadcaster can start when the Twitch status API is unavailable', async () => {
  const fixture = setup({ getStream: async () => { throw new Error('temporary Twitch API failure'); } });

  await fixture.engine.command(broadcaster(), '!викторина');

  assert.ok(fixture.engine.getState());
  assert.equal(fixture.engine.getState().source, 'streamer-offline');
});

test('does not award a point when Twitch did not provide a stable user id', async () => {
  const fixture = setup({ roundCount: 1, words: birchWord });
  await fixture.engine.start(viewer());

  fixture.engine.guess({ username: 'anonymous', 'display-name': 'Anonymous' }, 'берёза');

  assert.equal(fixture.repository.getTop().length, 0);
});

test('concurrent manual starts and auto ticks create one game for a stream', async () => {
  const fixture = setup({
    now: Date.parse('2026-01-01T02:00:00.000Z'),
    stream: { id: 'race-stream', started_at: '2026-01-01T00:00:00.000Z' },
  });

  await Promise.all([
    fixture.engine.command(viewer('a', 'a'), '!в'),
    fixture.engine.command(viewer('b', 'b'), '!викторина'),
    fixture.engine.tick(),
    fixture.engine.tick(),
  ]);

  assert.equal(fixture.messages.filter((message) => /запускаем викторину/i.test(message)).length, 1);
  assert.equal(fixture.engine.getState().streamId, 'race-stream');
});

test('only the broadcaster may stop a running game', async () => {
  const fixture = setup();
  await fixture.engine.start(viewer());

  await fixture.engine.command(viewer(), '!викторина стоп');
  assert.ok(fixture.engine.getState());

  await fixture.engine.command(broadcaster(), '!в стоп');
  assert.equal(fixture.engine.getState(), null);
});

test('an online game stops when its stream goes offline or changes id', async () => {
  const offlineFixture = setup();
  await offlineFixture.engine.start(viewer());
  offlineFixture.setStream(null);
  await offlineFixture.engine.tick();
  assert.equal(offlineFixture.engine.getState(), null);

  const changedFixture = setup();
  await changedFixture.engine.start(viewer());
  changedFixture.setStream({ id: 'stream-2', started_at: new Date(changedFixture.getTime()).toISOString() });
  await changedFixture.engine.tick();
  assert.equal(changedFixture.engine.getState(), null);
});

function makeQuestionProvider(getQuestions) {
  return {
    getQuestions,
  };
}

test('uses generated questions, reveals only the clue before the answer, and awards normally', async () => {
  const generatedQuestion = {
    id: 'generated-1',
    clue: 'Сгенерированная загадка',
    answers: ['секретное слово'],
    source: 'ai',
  };
  const requests = [];
  const provider = makeQuestionProvider(async ({ streamId, count }) => {
    requests.push({ streamId, count });
    assert.equal(streamId, 'stream-1');
    assert.equal(count, 2);
    return [generatedQuestion];
  });
  const fixture = setup({ roundCount: 2, questionProvider: provider });

  await fixture.engine.start(viewer());

  assert.ok(fixture.engine.getState());
  assert.ok(fixture.messages.some((message) => message.includes(generatedQuestion.clue)));
  assert.ok(fixture.messages.every((message) => !message.includes('секретное слово')));
  assert.deepEqual(requests, [{ streamId: 'stream-1', count: 2 }]);
  assert.deepEqual(fixture.streamRequests, [{}, { force: true }]);

  fixture.engine.guess(viewer(), 'СЕКРЕТНОЕ СЛОВО');
  assert.equal(fixture.repository.getScore('user-1'), 1);
});

test('aborts generated questions if the live stream changes before generation completes', async () => {
  let finishGeneration;
  let reservedStreamId;
  const provider = makeQuestionProvider(() => new Promise((resolve) => { finishGeneration = resolve; }));
  const originalGetQuestions = provider.getQuestions;
  provider.getQuestions = async (request) => {
    reservedStreamId = request.streamId;
    return originalGetQuestions(request);
  };
  const fixture = setup({ questionProvider: provider });

  const starting = fixture.engine.start(viewer());
  await new Promise((resolve) => setImmediate(resolve));
  fixture.setStream({ id: 'stream-2', started_at: new Date(fixture.getTime()).toISOString() });
  finishGeneration([{ id: 'q1', clue: 'Загадка', answers: ['ответ'] }]);
  await starting;

  assert.equal(fixture.engine.getState(), null);
  assert.equal(fixture.startedStreams.has('stream-1'), false);
  assert.equal(fixture.startedStreams.has('stream-2'), false);
  assert.equal(reservedStreamId, 'stream-1');
  assert.deepEqual(fixture.streamRequests, [{}, { force: true }]);
});

test('generation errors do not poison the queue and a later manual start can retry', async () => {
  let attempts = 0;
  const provider = makeQuestionProvider(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('provider unavailable');
    return [{ id: 'q1', clue: 'Повторная попытка', answers: ['успех'] }];
  });
  const fixture = setup({ questionProvider: provider });

  await assert.rejects(fixture.engine.start(viewer()), /provider unavailable/);
  assert.equal(fixture.engine.getState(), null);
  await fixture.engine.start(viewer());

  assert.equal(attempts, 2);
  assert.ok(fixture.engine.getState());
  assert.equal(fixture.engine.getState().clue, 'Повторная попытка');
});

test('empty generated batches leave the stream unmarked and automatic retries wait one minute', async () => {
  let attempts = 0;
  const provider = makeQuestionProvider(async () => {
    attempts += 1;
    return [];
  });
  const stream = {
    id: 'empty-questions-stream',
    started_at: new Date(1_800_000_000_000 - 2 * 60 * 60 * 1000).toISOString(),
  };
  const fixture = setup({ now: 1_800_000_000_000, stream, questionProvider: provider });

  await fixture.engine.tick();
  assert.equal(fixture.engine.getState(), null);
  assert.equal(fixture.startedStreams.has(stream.id), false);
  assert.equal(attempts, 1);

  fixture.advance(59_999);
  await fixture.engine.tick();
  assert.equal(attempts, 1);

  fixture.advance(1);
  await fixture.engine.tick();
  assert.equal(attempts, 2);
  assert.equal(fixture.startedStreams.has(stream.id), false);
});

test('concurrent manual starts invoke generation once and limit rounds to the generated batch', async () => {
  let calls = 0;
  const provider = makeQuestionProvider(async () => {
    calls += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return [{ id: 'q1', clue: 'Вопрос', answers: ['ответ'] }];
  });
  const fixture = setup({ roundCount: 5, questionProvider: provider });

  await Promise.all([
    fixture.engine.start(viewer('viewer-one')),
    fixture.engine.start(viewer('viewer-two')),
  ]);

  assert.equal(calls, 1);
  assert.equal(fixture.engine.getState().roundCount, 1);
  assert.equal(fixture.messages.filter((message) => /запускаем викторину/i.test(message)).length, 1);
});

