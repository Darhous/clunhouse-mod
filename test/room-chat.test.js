'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomChat, validateTemplate, welcomeText, normalizeMessage, DEFAULT_TEMPLATE } = require('../lib/roomChat');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const f = {
    generation: 1, profile: { userId: 1 }, settings: {}, calls: [], reads: [], jobs: new Map(),
    room: { connected: true, channel: 'room-a', self: { isInRoom: true, isModerator: true }, raw: { is_chat_enabled: true },
      speakers: [{ user_id: 1, name: 'أحمد', is_moderator: true }, { user_id: 2, name: 'نور', is_moderator: true }],
      listeners: [{ user_id: 3, name: 'علي' }, { user_id: 2, name: 'نور', is_moderator: true }] },
  };
  f.operations = {
    createOperation(job) { const id = `op-${f.jobs.size}`; const op = { ...job, id, status: 'running' }; f.jobs.set(id, op); return op; },
    getOperation(id) { return f.jobs.get(id); },
    cancelOperation(id) { if (f.jobs.has(id)) f.jobs.get(id).cancelled = true; },
  };
  f.chat = createRoomChat({
    getRoom: () => f.room, getGeneration: () => f.generation, getProfile: () => f.profile,
    getSettings: () => f.settings, setSetting: (key, value) => { f.settings[key] = value; }, operations: f.operations,
    apiGet: async (path, query) => { f.reads.push({ path, query }); return f.readResult || { messages: [{ message_id: '9007199254740993123', message: 'أهلاً', user_profile: { name: 'نور', user_id: 2 } }], next_cursor: 'cursor-2' }; },
    apiPost: async (path, body, profile, validate) => { validate?.(); f.calls.push({ path, body }); if (f.error) throw f.error; return { success: true }; },
  });
  f.context = f.chat.status().context;
  return f;
}

test('welcome template keeps the name slot and uses a literal replacement', () => {
  assert.equal(welcomeText(DEFAULT_TEMPLATE, { name: '$& <script>' }), 'ازيك يا $& <script> منورنا ❤️');
  assert.throws(() => validateTemplate('بدون اسم'), { status: 400 });
  assert.throws(() => validateTemplate('x'.repeat(801) + '{name}'), { status: 400 });
  assert.equal(welcomeText('أهلًا {name}', { user_id: 123 }), 'أهلًا 123');
});
test('all welcome sends one separate message per unique present person', async () => {
  const f = fixture(), op = f.chat.welcome(f.context, 'all');
  assert.equal(op.items.length, 3);
  assert.equal(op.intervalMs, 5000);
  for (const item of op.items) await op.worker(item);
  assert.deepEqual(f.calls.map((c) => c.body.message), ['ازيك يا أحمد منورنا ❤️', 'ازيك يا نور منورنا ❤️', 'ازيك يا علي منورنا ❤️']);
  assert.ok(f.calls.every((c) => c.path === '/send_channel_message' && c.body.channel === 'room-a'));
});

test('welcome skips server duplicates, continues other targets, and remembers across reconnects', async () => {
  const f = fixture(), op = f.chat.welcome(f.context, 'all');
  f.error = Object.assign(new Error("Looks like that's been said already!"), { status: 400 });
  const first = await op.worker(op.items[0]);
  assert.equal(first.skipped, true); assert.equal(first.reason, 'duplicate');
  f.error = null;
  await op.worker(op.items[1]); await op.worker(op.items[2]);
  assert.equal(f.calls.length, 3);
  f.generation++; const nextContext = f.chat.status().context;
  const next = f.chat.welcome(nextContext, 'all');
  for (const item of next.items) assert.equal((await next.worker(item)).skipped, true);
  assert.equal(f.calls.length, 3);
});

test('history from before upgrade prevents resending own welcome without skipping another author', async () => {
  const f = fixture();
  f.readResult = { messages: [
    { message_id: 'a', message: 'ازيك يا أحمد منورنا ❤️', user_profile: { user_id: 1 }, time_created: new Date().toISOString() },
    { message_id: 'b', message: 'ازيك يا نور منورنا ❤️', user_profile: { user_id: 2 }, time_created: new Date().toISOString() },
  ] };
  const op = f.chat.welcome(f.context, 'all');
  assert.equal((await op.worker(op.items[0])).skipped, true);
  await op.worker(op.items[1]); assert.equal(f.calls.length, 1);
});

test('unknown welcome error stops the batch; manual duplicate gets clear Arabic error', async () => {
  const f = fixture(), op = f.chat.welcome(f.context, 'all');
  f.error = Object.assign(new Error('Forbidden'), { status: 403 });
  await assert.rejects(op.worker(op.items[0]), { stopOperation: true, status: 403 });
  f.error = Object.assign(new Error("Looks like that's been said already!"), { status: 400 });
  await assert.rejects(f.chat.send(f.context, 'hi'), (e) => e.status === 409 && /سبق إرسال/.test(e.message));
});

test('auto duplicate does not poison the remaining automatic welcome queue', async () => {
  const f = fixture(); f.settings.roomChatAutoWelcome = true; f.chat.update();
  f.room.listeners.push({ user_id: 4, name: 'سارة' }, { user_id: 5, name: 'ندى' });
  f.error = Object.assign(new Error("Looks like that's been said already!"), { status: 400 });
  f.chat.update(); await settle();
  assert.equal(f.chat.status().autoError, null);
  f.error = null; f.chat.update(); await settle();
  assert.equal(f.calls.length, 2); assert.equal(f.chat.status().autoPending, 0);
});
test('moderator welcome selects present moderators and rechecks their role', async () => {
  const f = fixture(), op = f.chat.welcome(f.context, 'moderators');
  assert.deepEqual(op.items.map((x) => x.userId), [1, 2]);
  await op.worker(op.items[0]);
  f.room.speakers[1].is_moderator = false;
  f.room.listeners = f.room.listeners.filter((u) => u.user_id !== 2);
  assert.deepEqual(await op.worker(op.items[1]), { skipped: true });
  assert.equal(f.calls.length, 1);
});
test('welcome prevents overlapping batches and respects cancellation', async () => {
  const f = fixture(), op = f.chat.welcome(f.context, 'all');
  assert.throws(() => f.chat.welcome(f.context, 'all'), { status: 409 });
  f.operations.cancelOperation(op.id);
  await assert.rejects(op.worker(op.items[0]), { status: 409 });
  assert.equal(f.calls.length, 0);
});
test('room/account switches and read-only mode stop pending messages', async () => {
  for (const change of [(f) => { f.generation++; }, (f) => { f.profile = { userId: 2 }; }, (f) => { f.settings.serverReadOnlyMode = true; }]) {
    const f = fixture(), op = f.chat.welcome(f.context, 'all'); change(f);
    await assert.rejects(op.worker(op.items[0])); assert.equal(f.calls.length, 0);
  }
});
test('automatic welcome establishes a baseline, then welcomes only new entrants once', async () => {
  const f = fixture(); f.settings.roomChatAutoWelcome = true; f.chat.update(); await settle();
  assert.equal(f.calls.length, 0);
  f.room.listeners.push({ user_id: 4, name: 'سارة' }); f.chat.update(); await settle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.message, 'ازيك يا سارة منورنا ❤️');
  f.chat.update(); await settle(); assert.equal(f.calls.length, 1);
  f.room.listeners.pop(); f.chat.update(); f.room.listeners.push({ user_id: 4, name: 'سارة' }); f.chat.update(); await settle();
  assert.equal(f.calls.length, 1);
  f.generation++; f.chat.update(); await settle(); assert.equal(f.calls.length, 1);
});
test('enabling auto welcome does not greet people already in the room', async () => {
  const f = fixture(); f.chat.updateSettings({ autoWelcome: true, template: 'أهلًا {الاسم}' });
  f.chat.update(); await settle(); assert.equal(f.calls.length, 0);
  f.room.listeners.push({ user_id: 4, name: 'ندى' }); f.chat.update(); await settle();
  assert.equal(f.calls[0].body.message, 'أهلًا ندى');
});
test('automatic failure stops queued welcomes without silently retrying', async () => {
  const f = fixture(); f.settings.roomChatAutoWelcome = true; f.chat.update();
  f.error = Object.assign(new Error('rate limited'), { status: 429 });
  f.room.listeners.push({ user_id: 4, name: 'سارة' }, { user_id: 5, name: 'ندى' });
  f.chat.update(); await settle(); f.chat.update(); await settle();
  assert.equal(f.calls.length, 1); assert.match(f.chat.status().autoError, /rate limited/);
});
test('messages use GET, preserve large IDs, pagination and coalesce reads', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.chat.messages(f.context), f.chat.messages(f.context)]);
  assert.equal(f.reads.length, 1); assert.deepEqual(a, b); assert.equal(a.messages[0].id, '9007199254740993123');
  await f.chat.messages(f.context, a.nextCursor);
  assert.deepEqual(f.reads[1], { path: '/get_channel_messages', query: { channel: 'room-a', is_chronological_order: 0, next_cursor: 'cursor-2' } });
});
test('deletion requires moderator and message IDs are not rounded', async () => {
  const f = fixture(); f.room.self.isModerator = false;
  await assert.rejects(f.chat.remove(f.context, '123'), { status: 403 });
  f.room.self.isModerator = true;
  await f.chat.remove(f.context, '9007199254740993123');
  assert.equal(f.calls[0].body.message_id, '9007199254740993123');
  assert.equal(f.chat.status().canLike, true);
  assert.equal(f.chat.status().mentionMode, 'username');
});
test('like and unlike use live-verified endpoints and reject stale/readonly actions', async () => {
  const f = fixture();
  await f.chat.like(f.context, 'message-uuid', true);
  await f.chat.like(f.context, 'message-uuid', false);
  assert.deepEqual(f.calls, [
    { path: '/like_channel_message', body: { channel: 'room-a', message_id: 'message-uuid' } },
    { path: '/unlike_channel_message', body: { channel: 'room-a', message_id: 'message-uuid' } },
  ]);
  await assert.rejects(f.chat.like(f.context, 'message-uuid', 'false'), { status: 400 });
  f.settings.serverReadOnlyMode = true;
  await assert.rejects(f.chat.like(f.context, 'message-uuid', true), { status: 403 });
  f.settings.serverReadOnlyMode = false; f.generation++;
  await assert.rejects(f.chat.like(f.context, 'message-uuid', true), { status: 409 });
});
test('live message schema exposes like_count and enriches mention username from room members', async () => {
  assert.deepEqual(normalizeMessage({ message_id: 'uuid', message: 'hi', like_count: 3, viewer_has_liked: true }, { username: 'person.name' }), {
    id: 'uuid', text: 'hi', userId: '', name: 'عضو', username: 'person.name', time: null, deleted: false, likes: 3, liked: true,
  });
  const f = fixture(); f.room.speakers[1].username = 'nour'; f.room.listeners = [];
  const result = await f.chat.messages(f.context);
  assert.equal(result.messages[0].username, 'nour');
});
test('post-to-chat permission controls send independently of moderator deletion', async () => {
  const f = fixture(); f.room.capabilities = { can_post_to_chat: false };
  assert.equal(f.chat.status().canSend, false); assert.equal(f.chat.status().canDelete, true);
  await assert.rejects(f.chat.send(f.context, 'blocked'), { status: 403 });
  await f.chat.remove(f.context, 'id');
});
test('message input rejects empty/oversized text and unjoined/disabled rooms', async () => {
  const f = fixture();
  for (const text of ['', '  ', 'x'.repeat(1001), {}]) await assert.rejects(f.chat.send(f.context, text), { status: 400 });
  f.room.self.isInRoom = false; await assert.rejects(f.chat.send(f.context, 'hi'), { status: 403 });
  f.room.self.isInRoom = true; f.room.raw.is_chat_enabled = false;
  await assert.rejects(f.chat.send(f.context, 'hi'), { status: 403 }); assert.equal(f.calls.length, 0);
  assert.equal(normalizeMessage({ id: 'a', message: '<img onerror=alert(1)>', user: { name: 'X' } }).text, '<img onerror=alert(1)>');
});
