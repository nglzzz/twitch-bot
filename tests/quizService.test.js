'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const servicePath = require.resolve('../src/services/quiz.service');
const dependencyPaths = {
  config: require.resolve('../src/config'),
  db: require.resolve('../src/app/db'),
  channelInfo: require.resolve('../src/twitchApi/channelInfo'),
  repository: require.resolve('../src/repositories/quiz.repo'),
  engine: require.resolve('../src/services/quizEngine'),
  questions: require.resolve('../src/services/quizQuestions.service'),
};

function loadService(options = {}) {
  const originalEntries = new Map();
  for (const filename of [servicePath, ...Object.values(dependencyPaths)]) {
    originalEntries.set(filename, require.cache[filename]);
    delete require.cache[filename];
  }

  const commands = [];
  const listeners = {};
  const sent = [];
  let ready = options.ready ?? true;
  let engineCreateCount = 0;
  let channelInfoCalls = 0;
  let engineOptions = null;
  let questionProviderCreateCount = 0;
  const engineCalls = { command: [], guess: [], tick: 0 };
  const engine = {
    command: async (...args) => {
      engineCalls.command.push(args);
      if (options.commandError) throw new Error('command failure');
    },
    guess: (...args) => engineCalls.guess.push(args),
    tick: async () => { engineCalls.tick += 1; },
  };
  const chat = {
    registerCommand: (...args) => commands.push(args),
    getClient: () => ({
      on: (event, listener) => { listeners[event] = listener; },
      say: (channel, message) => {
        sent.push([channel, message]);
        return options.sendError ? Promise.reject(new Error('send failure')) : Promise.resolve();
      },
    }),
  };

  require.cache[dependencyPaths.config] = {
    id: dependencyPaths.config,
    filename: dependencyPaths.config,
    loaded: true,
    exports: { CHANNEL: 'testchannel' },
  };
  require.cache[dependencyPaths.db] = {
    id: dependencyPaths.db,
    filename: dependencyPaths.db,
    loaded: true,
    exports: { isDbReady: () => ready },
  };
  require.cache[dependencyPaths.channelInfo] = {
    id: dependencyPaths.channelInfo,
    filename: dependencyPaths.channelInfo,
    loaded: true,
    exports: {
      getChannelInfo: async (...args) => {
        channelInfoCalls += 1;
        return options.getChannelInfo ? options.getChannelInfo(...args) : [];
      },
    },
  };
  require.cache[dependencyPaths.repository] = {
    id: dependencyPaths.repository,
    filename: dependencyPaths.repository,
    loaded: true,
    exports: {},
  };
  require.cache[dependencyPaths.engine] = {
    id: dependencyPaths.engine,
    filename: dependencyPaths.engine,
    loaded: true,
    exports: {
      createQuizEngine: (optionsArg) => {
        engineCreateCount += 1;
        engineOptions = optionsArg;
        return engine;
      },
    },
  };
  require.cache[dependencyPaths.questions] = {
    id: dependencyPaths.questions,
    filename: dependencyPaths.questions,
    loaded: true,
    exports: {
      createQuizQuestionProvider: () => {
        questionProviderCreateCount += 1;
        return { getQuestions: async () => [], markUsed: () => {} };
      },
    },
  };

  const service = require(servicePath);
  return {
    service,
    chat,
    commands,
    listeners,
    sent,
    engine,
    engineCalls,
    getEngineOptions: () => engineOptions,
    getEngineCreateCount: () => engineCreateCount,
    getQuestionProviderCreateCount: () => questionProviderCreateCount,
    getChannelInfoCalls: () => channelInfoCalls,
    setReady: (value) => { ready = value; },
    restore: () => {
      for (const filename of [servicePath, ...Object.values(dependencyPaths)]) {
        const original = originalEntries.get(filename);
        if (original) require.cache[filename] = original;
        else delete require.cache[filename];
      }
    },
  };
}

test('initialize is idempotent and registers quiz and three standalone game commands', () => {
  const fixture = loadService();
  try {
    fixture.service.initialize(fixture.chat);
    fixture.service.initialize(fixture.chat);

    assert.equal(fixture.getEngineCreateCount(), 1);
    assert.equal(fixture.getQuestionProviderCreateCount(), 1);
    assert.ok(fixture.getEngineOptions().questionProvider);
    assert.equal(fixture.commands.length, 4);
    assert.equal(fixture.commands[0][0], '!викторина');
    assert.equal(fixture.commands[0][2], '!в');
    assert.deepEqual(fixture.commands.slice(1).map(([name, , alias]) => [name, alias]), [
      ['!анаграммы', '!анаграмма'],
      ['!играэмодзи', '!эмодзиигра'],
      ['!фильмэмодзи', '!эмодзифильм'],
    ]);
    assert.ok(!fixture.commands.some(([name]) => name === '!фильм'));
    assert.equal(Object.keys(fixture.listeners).filter((event) => event === 'message').length, 1);
  } finally {
    fixture.restore();
  }
});

test('standalone commands select their matching game mode without taking over !фильм', async () => {
  const fixture = loadService();
  try {
    fixture.service.initialize(fixture.chat);
    const commandsByName = new Map(fixture.commands.map(([name, handler, alias]) => [name, handler]));

    await commandsByName.get('!анаграммы')('#channel', {}, '!анаграммы');
    await commandsByName.get('!играэмодзи')('#channel', {}, '!играэмодзи');
    await commandsByName.get('!фильмэмодзи')('#channel', {}, '!фильмэмодзи');

    assert.deepEqual(fixture.engineCalls.command.map(([, , mode]) => mode), ['anagram', 'game', 'movie']);
    assert.equal(commandsByName.has('!фильм'), false);
  } finally {
    fixture.restore();
  }
});

test('command handler reports unavailable database without calling quiz engine', async () => {
  const fixture = loadService({ ready: false });
  try {
    fixture.service.initialize(fixture.chat);
    const handler = fixture.commands[0][1];

    const response = await handler('#testchannel', {}, '!викторина');

    assert.match(response, /базой очков/i);
    assert.equal(fixture.engineCalls.command.length, 0);
  } finally {
    fixture.restore();
  }
});

test('guess listener ignores bot messages and forwards ordinary chat guesses', () => {
  const fixture = loadService();
  try {
    fixture.service.initialize(fixture.chat);
    const onMessage = fixture.listeners.message;
    onMessage('#testchannel', { username: 'bot' }, 'answer', true);
    assert.equal(fixture.engineCalls.guess.length, 0);

    onMessage('#testchannel', { username: 'viewer' }, 'answer', false);
    assert.equal(fixture.engineCalls.guess.length, 1);
    assert.deepEqual(fixture.engineCalls.guess[0], [{ username: 'viewer' }, 'answer']);

    fixture.setReady(false);
    onMessage('#testchannel', { username: 'viewer' }, 'answer', false);
    assert.equal(fixture.engineCalls.guess.length, 1);
  } finally {
    fixture.restore();
  }
});

test('quiz timer ticks immediately, continues periodically, and starts only once', async () => {
  const fixture = loadService();
  const originalSetInterval = global.setInterval;
  const intervals = [];
  global.setInterval = (callback, delay) => {
    const timer = { callback, delay };
    intervals.push(timer);
    return timer;
  };

  try {
    fixture.service.initialize(fixture.chat);
    fixture.service.startQuizTimer();
    fixture.service.startQuizTimer();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].delay, 1_000);
    assert.equal(fixture.engineCalls.tick, 1);

    await intervals[0].callback();
    assert.equal(fixture.engineCalls.tick, 2);
  } finally {
    global.setInterval = originalSetInterval;
    fixture.restore();
  }
});

test('command send failures are caught and returned as a retry message', async () => {
  const fixture = loadService({ commandError: true });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    fixture.service.initialize(fixture.chat);
    const response = await fixture.commands[0][1]('#testchannel', {}, '!в');

    assert.match(response, /попробуйте/i);
  } finally {
    console.error = originalConsoleError;
    fixture.restore();
  }
});

test('quiz chat send handles rejected chat client promises', async () => {
  const fixture = loadService({ sendError: true });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    fixture.service.initialize(fixture.chat);
    fixture.getEngineOptions().send('quiz message');
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(fixture.sent, [['testchannel', 'quiz message']]);
  } finally {
    console.error = originalConsoleError;
    fixture.restore();
  }
});

test('forced stream checks bypass both a cached online result and a cached offline result', async () => {
  const streams = [
    [{ id: 'stream-one' }],
    [{ id: 'stream-two' }],
  ];
  const fixture = loadService({ getChannelInfo: async () => streams.shift() });
  try {
    fixture.service.initialize(fixture.chat);
    const getStream = fixture.getEngineOptions().getStream;

    assert.deepEqual(await getStream(), { id: 'stream-one' });
    assert.deepEqual(await getStream(), { id: 'stream-one' });
    assert.equal(fixture.getChannelInfoCalls(), 1);

    assert.deepEqual(await getStream({ force: true }), { id: 'stream-two' });
    assert.equal(fixture.getChannelInfoCalls(), 2);
  } finally {
    fixture.restore();
  }
});

test('failed stream status checks are negatively cached for 30 seconds', async () => {
  const fixture = loadService({
    getChannelInfo: async () => {
      if (fixture.getChannelInfoCalls() === 1) throw new Error('offline API');
      return [];
    },
  });
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    fixture.service.initialize(fixture.chat);
    const getStream = fixture.getEngineOptions().getStream;

    await assert.rejects(getStream(), /offline API/);
    await assert.rejects(getStream(), /offline API/);
    assert.equal(fixture.getChannelInfoCalls(), 1);

    now += 30_000;
    assert.equal(await getStream(), null);
    assert.equal(fixture.getChannelInfoCalls(), 2);
  } finally {
    Date.now = originalNow;
    fixture.restore();
  }
});
