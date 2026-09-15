'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomConnection } = require('../lib/roomConnection');
function fixture() {
  const f = { profile: {}, generation: 1, room: {}, calls: 0, starts: 0, fail: null };
  f.poller = {
    getState: () => f.room, getContext: () => f.generation,
    start: (channel) => { if (f.room.channel !== channel) { f.starts++; f.generation++; } f.room = { channel, connected: true, self: { isInRoom: true } }; },
    stop: () => { f.generation++; f.room = {}; },
  };
  f.service = createRoomConnection({ poller: f.poller, getProfile: () => f.profile,
    join: async () => { f.calls++; await Promise.resolve(); if (f.fail) throw f.fail; return { success: true }; },
    leave: async () => ({ success: true }),
  });
  return f;
}
test('200 concurrent join clicks create one upstream join and one polling start', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 200 }, () => f.service.join('room')));
  assert.equal(f.calls, 1); assert.equal(f.starts, 1);
  assert.equal((await f.service.join('room')).alreadyJoined, true); assert.equal(f.calls, 1);
});
test('conflicting room transitions and account changes cannot overwrite connection', async () => {
  const f = fixture();
  const first = f.service.join('room');
  await assert.rejects(f.service.select('other'), { status: 409 }); await first;
  const g = fixture(); const pending = g.service.join('room'); g.profile = {};
  await assert.rejects(pending, { status: 409 }); assert.equal(g.starts, 0);
});
test('429 is preserved for all coalesced join callers', async () => {
  const f = fixture(); f.fail = Object.assign(new Error('Too many requests'), { status: 429, retryAfterMs: 120000 });
  const results = await Promise.allSettled([f.service.join('room'), f.service.join('room')]);
  assert.equal(f.calls, 1); assert.equal(f.starts, 0);
  assert.ok(results.every(r => r.reason.status === 429 && r.reason.retryAfterMs === 120000));
});
