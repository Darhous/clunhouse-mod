'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// عشان الاختبار ميلمسش data/ الحقيقية اللي السيرفر الشغال ممكن يكون بيستخدمها،
// بنوجّه lib/state.js لمجلد مؤقت منفصل قبل ما نعمل require ليه.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modpanel-state-test-'));
process.env.MODPANEL_DATA_DIR = tmpDir;
const state = require('../lib/state');

test.after(() => {
  delete process.env.MODPANEL_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('appendNotification يحفظ الأحدث أول ويحدّ العدد لـ300', () => {
  state.clearNotifications();
  for (let i = 0; i < 305; i++) state.appendNotification({ message: `n${i}` });
  const list = state.getNotifications();
  assert.equal(list.length, 300);
  assert.equal(list[0].message, 'n304'); // الأحدث أول
});

test('markNotificationRead بـ id واحد أو all', () => {
  state.clearNotifications();
  const a = state.appendNotification({ message: 'a' });
  const b = state.appendNotification({ message: 'b' });
  state.markNotificationRead(a.id);
  let list = state.getNotifications();
  assert.equal(list.find((n) => n.id === a.id).read, true);
  assert.equal(list.find((n) => n.id === b.id).read, false);
  state.markNotificationRead('all');
  list = state.getNotifications();
  assert.ok(list.every((n) => n.read === true));
});

test('clearNotifications بيرجع مصفوفة فاضية', () => {
  state.appendNotification({ message: 'x' });
  state.clearNotifications();
  assert.deepEqual(state.getNotifications(), []);
});

test('recordFriendSighting بيعمل upsert بالـ user_id ويحدّث آخر ظهور', () => {
  const first = state.recordFriendSighting({ user_id: 42, name: 'Dar' }, { channel: 'room-a', topic: 'A' });
  assert.equal(first.userId, 42);
  assert.equal(first.lastRoom.channel, 'room-a');
  assert.equal(first.muted, false);

  const second = state.recordFriendSighting({ user_id: 42, name: 'Dar' }, { channel: 'room-b', topic: 'B' });
  assert.equal(second.lastRoom.channel, 'room-b');
  assert.ok(new Date(second.lastSeenOnline).getTime() >= new Date(first.lastSeenOnline).getTime());

  const sightings = state.getFriendSightings();
  assert.equal(Object.keys(sightings).length, 1);
  assert.equal(sightings['42'].lastRoom.channel, 'room-b');
});

test('setFriendMuted بيحافظ على الكتم عبر التحديثات الجديدة', () => {
  state.recordFriendSighting({ user_id: 7, name: 'Foo' }, null);
  state.setFriendMuted(7, true);
  const afterMute = state.getFriendSightings()['7'];
  assert.equal(afterMute.muted, true);

  state.recordFriendSighting({ user_id: 7, name: 'Foo' }, { channel: 'room-c', topic: 'C' });
  const afterResighting = state.getFriendSightings()['7'];
  assert.equal(afterResighting.muted, true, 'الكتم لازم يفضل محفوظ بعد أي تحديث جديد لنفس الصديق');
});
