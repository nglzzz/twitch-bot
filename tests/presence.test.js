const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresenceService, CHATTER_TTL_MS } = require('../src/services/presence.service');

function setup(names) {
  const sent = [];
  let clock = 10 * CHATTER_TTL_MS;
  const service = createPresenceService({
    fetchViewers: async () => names.slice(),
    broadcast: (payload) => sent.push(payload),
    ignoredLogins: ['nglzzzbot'],
    now: () => clock,
  });
  return { service, sent, names, tick: (ms) => { clock += ms; } };
}

test('poll publishes chatters list without bots', async () => {
  const { service, sent } = setup(['Alice', 'nglzzzbot', 'Bob']);
  await service.poll();
  assert.deepEqual(sent.at(-1).viewers.map((v) => v.login), ['alice', 'bob']);
});

test('a new chatter is published once and keeps its color', async () => {
  const { service, sent } = setup([]);
  assert.equal(service.noteChatter({ login: 'Carl', name: 'Carl', color: '#FF0000' }), true);
  assert.equal(service.noteChatter({ login: 'carl', name: 'Carl' }), false);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].viewers, [{ login: 'carl', name: 'Carl', color: '#FF0000' }]);
});

test('viewers who left the list and stopped chatting disappear', async () => {
  const { service, names, tick } = setup(['Dana']);
  await service.poll();
  names.length = 0;
  service.noteChatter({ login: 'eve', name: 'Eve' });
  await service.poll();
  assert.deepEqual(service.list().map((v) => v.login), ['eve']);
  tick(CHATTER_TTL_MS + 1);
  await service.poll();
  assert.deepEqual(service.list(), []);
});
