'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeatureLimiter } = require('../lib/featureLimiter');
const { createLogBuffer } = require('../lib/logBuffer');
const operations = require('../lib/operationManager');

test('rolling request budget and Retry-After survive recreation of the limiter', async () => {
  let clock = 1000, saved = []; const starts = [];
  const options = { maxRequests: 3, windowMs: 60000, now: () => clock, sleep: async ms => { clock += ms; }, load: () => saved, save: value => { saved = value; } };
  let limiter = createFeatureLimiter(options);
  for (let i = 0; i < 3; i++) await limiter.run('account', () => { starts.push(clock); });
  limiter = createFeatureLimiter(options);
  await limiter.run('account', () => { starts.push(clock); });
  assert.deepEqual(starts, [1000, 6000, 11000, 61000]);
  await assert.rejects(limiter.run('account', () => { throw Object.assign(new Error('limit'), { status: 429, retryAfterMs: 180000 }); }));
  limiter = createFeatureLimiter(options);
  let dispatched = false;
  await assert.rejects(limiter.run('account', () => { dispatched = true; }), { status: 429 });
  assert.equal(dispatched, false); assert.equal(limiter.remaining('account'), 180000);
});

test('a queued request cancelled during the long rolling-window pause never dispatches', async () => {
  let clock = 0, valid = true;
  const limiter = createFeatureLimiter({ maxRequests: 1, windowMs: 60000, now: () => clock, sleep: async ms => { clock += ms; valid = false; } });
  await limiter.run('account', () => {});
  let calls = 0;
  await assert.rejects(limiter.run('account', () => { calls++; }, () => { if (!valid) throw new Error('cancelled'); }), /cancelled/);
  assert.equal(calls, 0);
});

test('1000 queued requests respect default five-second spacing without parallel dispatch', async () => {
  let clock = 0; const starts = [];
  const limiter = createFeatureLimiter({ now: () => clock, sleep: async (ms) => { clock += ms; } });
  await Promise.all(Array.from({ length: 1000 }, () => limiter.run('same-account', async () => { starts.push(clock); clock += 200; })));
  assert.equal(starts.length, 1000);
  assert.ok(starts.slice(1).every((start, i) => start - starts[i] === 5200));
});

test('skipped welcome is not counted as sent or failed', async () => {
  const op = operations.createOperation({ kind: 'skip-test', items: [{ key: 1 }], worker: async () => ({ skipped: true, reason: 'duplicate' }) });
  await new Promise(resolve => setImmediate(resolve));
  const result = operations.getOperation(op.id);
  assert.equal(result.succeeded, 0); assert.equal(result.failed, 0); assert.equal(result.skipped, 1); assert.equal(result.status, 'completed');
});

test('feature queue serializes mixed sources and honors spacing', async () => {
  let clock = 0, active = 0, peak = 0;
  const starts = [];
  const limiter = createFeatureLimiter({ intervalMs: 2000, now: () => clock, sleep: async (ms) => { clock += ms; } });
  await Promise.all([1, 2, 3].map(() => limiter.run('account:reactions', async () => { starts.push(clock); peak = Math.max(peak, ++active); await Promise.resolve(); active--; })));
  assert.equal(peak, 1); assert.deepEqual(starts, [0, 2000, 4000]);
});
test('429 halts queued requests and respects server Retry-After across sources', async () => {
  let clock = 0, calls = 0;
  const limiter = createFeatureLimiter({ now: () => clock, sleep: async (ms) => { clock += ms; } });
  const results = await Promise.allSettled([
    limiter.run('user:reactions', () => { calls++; throw Object.assign(new Error('slow down'), { status: 429, retryAfterMs: 60000 }); }),
    limiter.run('user:reactions', () => { calls++; }),
  ]);
  assert.equal(calls, 1); assert.ok(results.every((r) => r.status === 'rejected' && r.reason.status === 429));
  assert.equal(limiter.remaining('user:reactions'), 60000);
  clock = 60001; await limiter.run('user:reactions', () => { calls++; }); assert.equal(calls, 2);
});
test('queue validation runs at dispatch, after waiting', async () => {
  let valid = true, calls = 0;
  const limiter = createFeatureLimiter({ intervalMs: 0 });
  const first = limiter.run('x', async () => { valid = false; });
  const second = limiter.run('x', () => { calls++; }, () => { if (!valid) throw new Error('cancelled'); });
  await first; await assert.rejects(second, /cancelled/); assert.equal(calls, 0);
});
test('operation manager stops at the first 429 rather than processing more targets', async () => {
  let calls = 0;
  const op = operations.createOperation({ kind: 'limit-test', label: 'test', items: [{ key: 1 }, { key: 2 }], worker: async () => { calls++; throw Object.assign(new Error('rate limit'), { status: 429, retryAfterMs: 12000 }); } });
  await new Promise((resolve) => setImmediate(resolve));
  const result = operations.getOperation(op.id);
  assert.equal(calls, 1); assert.equal(result.completed, 1); assert.equal(result.status, 'failed'); assert.equal(result.retryAfterMs, 12000);
});
test('log export retains complete records and discloses evictions', () => {
  const buffer = createLogBuffer({ maxRecords: 2 });
  const body = 'أ'.repeat(1000);
  buffer.add({ id: 1 }); buffer.add({ id: 2, body }); buffer.add({ id: 3 });
  const lines = buffer.export().split('\n').map(JSON.parse);
  assert.equal(lines[0].droppedRecords, 1); assert.equal(lines[1].body, body); assert.equal(lines[2].id, 3);
});
