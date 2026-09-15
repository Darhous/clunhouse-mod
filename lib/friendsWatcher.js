'use strict';
// مراقب خلفية مستقل عن حالة الغرفة: بيتابع مين من متابعينك أونلاين (حتى من غير غرفة متصلة)،
// بيسجل "آخر ظهور رصدناه" محليًا (مش بيانات كلوبهاوس الرسمية - مفيش API بيرجعها)،
// وبيولّد إشعارات قابلة للنقر (صديق دخل غرفة + تنبيهات المشرفين الحقيقية) لتاب "الأصدقاء والإشعارات".
const { EventEmitter } = require('events');
const { apiPost } = require('./chClient');
const { getActiveProfile: getProfile } = require('./account');
const poller = require('./poller');
const state = require('./state');

const bus = new EventEmitter();

let timer = null;
let lastRoomByFriend = new Map(); // userId -> channel (null لو أونلاين بره غرفة معروفة)
let firstTick = true;
let modAlertListenerAttached = false;

const MOD_ALERT_LABELS = {
  'lone-moderator': (d) => `مودريتور وحيد متبقٍ في الغرفة (${d.count})`,
  'capacity-reached': (d) => `👥 الغرفة وصلت للحد الأقصى: ${d.numAll}/${d.max}`,
  'ghost-mic': (d) => `ميكروفون صامت: ${d.user?.name || d.user?.user_id} بلا نشاط منذ ${d.minutes} د`,
  'blacklist-join': (d) => `⛔ حد من القايمة السودة دخل الغرفة: ${d.user?.name || d.user?.user_id}`,
  'welcome-speaker': (d) => `👋 رحّب بسبيكر جديد: ${d.user?.name || d.user?.user_id}`,
};

// نفس منطق الـroute الحالي `/api/social/friends-online` — مستخرج هنا عشان الـroute والمراقب
// يستخدموا نفس الدالة بالظبط، صفر ازدواجية منطق.
async function getFriendsOnline() {
  const p = getProfile();
  const myId = p.userId || (p.user && p.user.user_id);
  const [followersRes, feedRes] = await Promise.all([
    apiPost('/get_followers', { user_id: myId }),
    apiPost('/get_feed_v3', {}),
  ]);
  const followerIds = new Set((followersRes.users || []).map((u) => String(u.user_id)));
  const rooms = (feedRes.items || []).map((it) => it.channel || it).filter((c) => c && c.channel);
  const found = new Map();
  for (const room of rooms) {
    for (const u of room.users || []) {
      if (followerIds.has(String(u.user_id)) && !found.has(u.user_id)) {
        found.set(u.user_id, { ...u, room: { channel: room.channel, topic: room.topic } });
      }
    }
  }
  return [...found.values()];
}

async function tick() {
  const settings = state.getSettings();
  if (!settings.friendsWatcherEnabled) return;
  try {
    const friends = await getFriendsOnline();
    const sightings = state.getFriendSightings();
    for (const u of friends) {
      state.recordFriendSighting(u, u.room);
      const muted = sightings[String(u.user_id)]?.muted;
      const prevChannel = lastRoomByFriend.get(u.user_id);
      if (!firstTick && prevChannel !== u.room.channel && settings.notifyOnFriendJoin && !muted) {
        const entry = state.appendNotification({
          source: 'friend-join',
          type: 'friend-join',
          actorId: u.user_id,
          actorName: u.name || u.username || `#${u.user_id}`,
          channel: u.room.channel,
          topic: u.room.topic,
          message: `👋 ${u.name || u.username || 'صديق'} دخل غرفة: ${u.room.topic || u.room.channel}`,
        });
        bus.emit('notification', entry);
      }
      lastRoomByFriend.set(u.user_id, u.room.channel);
    }
    firstTick = false;
  } catch (err) {
    bus.emit('watch-error', { error: err.message });
  }
}

function attachModAlertListener() {
  if (modAlertListenerAttached) return;
  modAlertListenerAttached = true;
  // مستمع إضافي — المستمع الحالي في server.js فاضل شغال زي ما هو، ده بس بيحفظ نفس التنبيهات
  // في فيد الإشعارات الجديد كمان عشان تبقى محفوظة وقابلة للنقر بدل توست مؤقت بس.
  poller.bus.on('mod-alert', (d) => {
    const settings = state.getSettings();
    if (!settings.notifyOnModAlert) return;
    const build = MOD_ALERT_LABELS[d.type];
    if (!build) return;
    const channel = poller.getChannel();
    const entry = state.appendNotification({
      source: 'mod-alert',
      type: d.type,
      actorId: d.user?.user_id || null,
      actorName: d.user?.name || d.user?.username || null,
      channel: channel || null,
      topic: poller.getState()?.topic || null,
      message: build(d),
    });
    bus.emit('notification', entry);
  });
}

function start() {
  attachModAlertListener();
  if (timer) return;
  const runAndReschedule = async () => {
    await tick();
    const settings = state.getSettings();
    const seconds = Math.max(15, Number(settings.friendsWatcherIntervalSeconds) || 60);
    timer = setTimeout(runAndReschedule, seconds * 1000);
  };
  runAndReschedule();
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { start, stop, getFriendsOnline, bus };
