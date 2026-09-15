'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeatureLimiter } = require('../lib/featureLimiter');
const stub = (name, exports) => { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let clock = 0, fail = false, generation = 1;
const profile = { userId: 1, apiRoot: 'https://fixture.invalid/api' };
stub('../lib/featureLimiter', { createFeatureLimiter: (options) => createFeatureLimiter({ ...options, now: () => clock, sleep: async ms => { clock += ms; } }) });
stub('../lib/account', { getActiveProfile: () => profile });
stub('../lib/state', { getSettings: () => ({}) });
stub('../lib/poller', { getContext: () => generation });
const client = require('../lib/chClient');
const requests = [];
global.fetch = async (url) => {
  requests.push({ path: new URL(url).pathname, time: clock });
  return new Response(JSON.stringify(fail ? { success: false, error_message: 'Too many requests.' } : { success: true }), { status: fail ? 429 : 200, headers: fail ? { 'retry-after': '120' } : {} });
};

test('actual client shares a five-second queue across chat, GIF and manual/automatic reactions', async () => {
  await Promise.all(Array.from({ length: 60 }, (_, i) => i % 3 === 0
    ? client.apiPost('/send_channel_message', { channel: 'room', message: `fixture ${i}` })
    : client.apiPostModernRoom(i % 3 === 1 ? '/emoji_reaction' : '/gif_reaction', { channel: 'room', user_id: i })));
  assert.equal(requests.length, 60);
  assert.ok(requests.slice(1).every((r, i) => r.time - requests[i].time >= 5000));
  assert.ok(requests.every(r => requests.filter(other => other.time <= r.time && other.time > r.time - 60000).length <= 3));
});

test('429 on chat blocks queued reactions and manual retries without another upstream call', async () => {
  const before = requests.length; fail = true;
  const results = await Promise.allSettled([
    client.apiPost('/send_channel_message', { channel: 'room', message: 'fixture' }),
    client.apiPostModernRoom('/emoji_reaction', { channel: 'room', user_id: 1 }),
    client.apiPostModernRoom('/gif_reaction', { channel: 'room', user_id: 2 }),
  ]);
  assert.equal(requests.length, before + 1);
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.status === 429 && r.reason.retryAfterMs === 120000));
  fail = false; clock += 120001;
});

test('joining is spaced and respects membership Retry-After', async () => {
  const before = requests.length;
  await client.apiPost('/join_channel', { channel: 'a' });
  fail = true;
  await assert.rejects(client.apiPost('/join_channel', { channel: 'b' }), { status: 429 });
  await assert.rejects(client.apiPost('/join_channel', { channel: 'c' }), { status: 429 });
  assert.equal(requests.length, before + 2);
  assert.ok(requests[before + 1].time - requests[before].time >= 5000);
  fail = false;
});
