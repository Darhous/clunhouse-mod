'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const stub = (name, exports) => { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let posts = [], queueCalls = 0, channelResult = null, saveReplayCalls = 0;
const profile = { userId: 1 };
stub('../lib/account', { getActiveProfile: () => profile });
stub('../lib/chClient', {
  apiPost: async (path, body) => {
    if (path === '/save_replay') saveReplayCalls++;
    if (path !== '/get_channel') return { success: true };
    posts.push(body.channel);
    if (channelResult) return channelResult(body.channel);
    return { channel: body.channel, users: [{ user_id: 1, name: 'Test', is_moderator: true }] };
  },
  apiGetModernRoom: async () => { queueCalls++; throw Object.assign(new Error('Invalid request.'), { status: 400 }); },
});
stub('../lib/state', { getSettings: () => ({}), getList: () => [], appendAudit: () => {}, saveArchive: () => {}, getSchedule: () => [], removeSchedule: () => {} });
const poller = require('../lib/poller');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('stopping live monitoring never tries to save a nonexistent replay', async () => {
  poller.start('live'); await settle(); poller.stop();
  assert.equal(saveReplayCalls, 0);
});

test('reselecting/joining the current room preserves generation and starts only one poll', async () => {
  const before = posts.length;
  poller.start('same'); await settle();
  const generation = poller.getContext();
  poller.start('same', { keepAlive: true }); poller.start('same');
  assert.equal(poller.getContext(), generation);
  assert.equal(posts.length, before + 1); poller.stop();
  posts = []; queueCalls = 0;
});

test('400 queue errors back off while room polling continues without overlap', async (t) => {
  const original = global.setInterval;
  let interval;
  global.setInterval = (fn) => { interval = fn; return null; };
  t.after(() => { poller.stop(); global.setInterval = original; });
  poller.start('a'); await settle();
  assert.equal(queueCalls, 1); assert.equal(poller.getState().connected, true);
  await interval(); await interval();
  assert.equal(posts.length, 3); assert.equal(queueCalls, 1);
  assert.match(poller.getState().raiseQueueError, /Invalid request/);
});
test('stale room responses cannot overwrite a new connection and parallel ticks are skipped', async (t) => {
  const original = global.setInterval;
  let interval, resolveA;
  global.setInterval = (fn) => { interval = fn; return null; };
  t.after(() => { poller.stop(); global.setInterval = original; channelResult = null; });
  posts = [];
  channelResult = (channel) => channel === 'a' ? new Promise(resolve => { resolveA = resolve; }) : { channel, users: [] };
  poller.start('a'); const oldTick = interval;
  await oldTick(); assert.deepEqual(posts, ['a']);
  poller.start('b'); await settle(); assert.equal(poller.getState().channel, 'b');
  resolveA({ channel: 'a', users: [] }); await settle();
  assert.equal(poller.getState().channel, 'b');
});
