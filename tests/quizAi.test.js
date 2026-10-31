'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');

const axiosPath = require.resolve('axios');
const clientPath = require.resolve('../src/utils/ChatGPT/AbstractChatGPT');
const configPath = require.resolve('../src/config');
const originalEnv = {
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.CHAT_GPT_MODEL,
  openRouterModel: process.env.OPENROUTER_MODEL,
};
const originalModules = new Map([axiosPath, clientPath, configPath]
  .map((filename) => [filename, require.cache[filename]]));
const requests = [];
let responseContent = '{"questions":[]}';
let requestError = null;

process.env.OPENROUTER_API_KEY = 'test-quiz-api-key';
process.env.CHAT_GPT_MODEL = 'openrouter';
process.env.OPENROUTER_MODEL = 'test/free-model';

require.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: async (request) => {
    requests.push(request);
    if (requestError) throw requestError;
    return { data: { choices: [{ message: { content: responseContent } }] } };
  },
};
delete require.cache[configPath];
delete require.cache[clientPath];
const ChatGPTClient = require(clientPath);

after(() => {
  for (const [filename, original] of originalModules.entries()) {
    if (original) require.cache[filename] = original;
    else delete require.cache[filename];
  }

  if (originalEnv.apiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalEnv.apiKey;
  if (originalEnv.model === undefined) delete process.env.CHAT_GPT_MODEL;
  else process.env.CHAT_GPT_MODEL = originalEnv.model;
  if (originalEnv.openRouterModel === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = originalEnv.openRouterModel;
});

test('generateJson makes one isolated request and returns the raw response', async () => {
  const client = new ChatGPTClient('openrouter');
  client._context.viewer = [{ role: 'user', content: 'private chat history' }];
  responseContent = '```json\n{"questions":[]}\n```';
  requests.length = 0;

  const messages = [
    { role: 'system', content: 'Return JSON only.' },
    { role: 'user', content: 'Generate 10 questions.' },
  ];
  const result = await client.generateJson(messages, { maxTokens: 2400, timeoutMs: 8000 });

  assert.equal(result, responseContent);
  assert.equal(requests.length, 1, 'generation must not walk the fallback model chain');
  assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(requests[0].timeout, 8000);
  assert.equal(requests[0].data.model, 'test/free-model');
  assert.equal(requests[0].data.max_tokens, 2400);
  assert.deepEqual(requests[0].data.messages, messages);
  assert.equal(requests[0].headers.Authorization, 'Bearer test-quiz-api-key');
  assert.equal(client._context.viewer[0].content, 'private chat history');
  assert.equal(client._context['quiz-generator'], undefined);
});

test('generateJson validates message shape and bounded request options before sending', async () => {
  const client = new ChatGPTClient('openrouter');
  requests.length = 0;

  await assert.rejects(client.generateJson([], {}), TypeError);
  await assert.rejects(client.generateJson([{ role: 'system', content: '' }]), TypeError);
  await assert.rejects(client.generateJson([{ role: 'developer', content: 'text' }]), TypeError);
  await assert.rejects(client.generateJson([{ role: 'user', content: 'text' }], { maxTokens: 0 }), RangeError);
  await assert.rejects(client.generateJson([{ role: 'user', content: 'text' }], { timeoutMs: 500 }), RangeError);

  assert.equal(requests.length, 0);
});

test('generateJson fails without falling back when credentials or response are missing', async () => {
  const client = new ChatGPTClient('openrouter');
  const config = require('../src/config');
  const originalKey = config.OPENROUTER_API_KEY;
  delete config.OPENROUTER_API_KEY;

  requests.length = 0;
  await assert.rejects(
    client.generateJson([{ role: 'user', content: 'Generate JSON.' }]),
    /Missing API key/
  );
  assert.equal(requests.length, 0);

  config.OPENROUTER_API_KEY = originalKey;
  responseContent = '   ';
  requests.length = 0;
  await assert.rejects(
    client.generateJson([{ role: 'user', content: 'Generate JSON.' }]),
    /empty response/
  );
  assert.equal(requests.length, 1);
});

test('generateJson propagates provider errors after a single request', async () => {
  const client = new ChatGPTClient('openrouter');
  requests.length = 0;
  requestError = new Error('provider unavailable');

  try {
    await assert.rejects(
      client.generateJson([{ role: 'user', content: 'Generate JSON.' }]),
      /provider unavailable/
    );
    assert.equal(requests.length, 1);
  } finally {
    requestError = null;
  }
});
