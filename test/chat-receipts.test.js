'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatReceipts } = require('../lib/chatReceipts');

test('receipt hashes survive restart, isolate account/room/text and expire locally', () => {
  let saved = [], clock = 100000;
  const options = { load: () => saved, save: (v) => { saved = v; }, now: () => clock, ttlMs: 1000, maxEntries: 3 };
  const first = createChatReceipts(options); first.remember(1, 'room', 'private welcome');
  assert.doesNotMatch(JSON.stringify(saved), /private welcome|room/);
  const second = createChatReceipts(options);
  assert.equal(second.has(1, 'room', 'private welcome'), true);
  assert.equal(second.has(2, 'room', 'private welcome'), false);
  assert.equal(second.has(1, 'other', 'private welcome'), false);
  clock += 1001; assert.equal(second.has(1, 'room', 'private welcome'), false);
  for (let i = 0; i < 100; i++) second.remember(1, 'room', String(i));
  assert.equal(saved.length, 3);
});
