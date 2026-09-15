'use strict';
// تخزين محلي بسيط (ملفات JSON) لكل حاجة البرنامج محتاج يفتكرها بين التشغيلات.
const fs = require('fs');
const path = require('path');

// قابل للتجاوز باختبارات الوحدة (MODPANEL_DATA_DIR) عشان الاختبارات متلمسش بيانات المستخدم الحقيقية.
const DATA_DIR = process.env.MODPANEL_DATA_DIR || path.join(__dirname, '..', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJSON(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

// ---- قوائم بسيطة (VIP / قايمة سوداء) ----
function getList(name) {
  return readJSON(name, []);
}
function addToList(name, entry) {
  const list = getList(name);
  const value = typeof entry === 'string' ? entry.trim() : entry;
  if (!value) return list;
  if (!list.some((x) => (x.value || x) === (value.value || value))) {
    list.push({ id: Date.now().toString(36), value, addedAt: new Date().toISOString() });
    writeJSON(name, list);
  }
  return getList(name);
}
function removeFromList(name, id) {
  const list = getList(name).filter((x) => x.id !== id);
  writeJSON(name, list);
  return list;
}

// بيشيل أي بند أقدم من days يوم (بناءً على addedAt) - مستخدم في انتهاء صلاحية القايمة السودة تلقائياً.
function pruneExpiredList(name, days) {
  if (!days || days <= 0) return getList(name);
  const cutoff = Date.now() - days * 86400000;
  const list = getList(name);
  const kept = list.filter((x) => new Date(x.addedAt).getTime() >= cutoff);
  if (kept.length !== list.length) writeJSON(name, kept);
  return kept;
}

// ---- سجل الأكشنات (Audit Log) ----
function appendAudit(entry) {
  const list = readJSON('audit-log', []);
  list.unshift({ id: Date.now().toString(36), time: new Date().toISOString(), ...entry });
  // نحتفظ بآخر 500 حركة بس عشان الملف ميكبرش أوي
  writeJSON('audit-log', list.slice(0, 500));
}
function getAudit() {
  return readJSON('audit-log', []);
}

// ---- إشعارات الأصدقاء/التنبيهات القابلة للنقر (منفصل عن audit-log اللي هو سجل أكشنات المودريتور) ----
function appendNotification(entry) {
  const list = readJSON('notifications', []);
  const withId = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time: new Date().toISOString(), read: false, ...entry };
  list.unshift(withId);
  writeJSON('notifications', list.slice(0, 300));
  return withId;
}
function getNotifications() {
  return readJSON('notifications', []);
}
function markNotificationRead(id) {
  const list = getNotifications();
  for (const n of list) {
    if (id === 'all' || n.id === id) n.read = true;
  }
  writeJSON('notifications', list);
  return list;
}
function clearNotifications() {
  writeJSON('notifications', []);
  return [];
}

// ---- رصد Clubhouse mod by Darhous المحلي لآخر ظهور أونلاين للأصدقاء (مش بيانات كلوبهاوس الرسمية — كلوبهاوس معندوش API لآخر ظهور) ----
function recordFriendSighting(user, room) {
  const sightings = readJSON('friend-sightings', {});
  const id = String(user.user_id);
  sightings[id] = {
    userId: user.user_id,
    name: user.name || user.username || '',
    username: user.username || '',
    lastSeenOnline: new Date().toISOString(),
    lastRoom: room || null,
    muted: sightings[id]?.muted || false,
  };
  writeJSON('friend-sightings', sightings);
  return sightings[id];
}
function getFriendSightings() {
  return readJSON('friend-sightings', {});
}
function setFriendMuted(userId, muted) {
  const sightings = readJSON('friend-sightings', {});
  const id = String(userId);
  if (!sightings[id]) return null;
  sightings[id].muted = !!muted;
  writeJSON('friend-sightings', sightings);
  return sightings[id];
}

// ---- الجدولة ----
function getSchedule() {
  return readJSON('schedule', []);
}
function addSchedule(entry) {
  const list = getSchedule();
  list.push({ id: Date.now().toString(36), createdAt: new Date().toISOString(), ...entry });
  writeJSON('schedule', list);
  return list;
}
function removeSchedule(id) {
  const list = getSchedule().filter((x) => x.id !== id);
  writeJSON('schedule', list);
  return list;
}

// ---- الأرشيف (لكل غرفة) ----
function archivePathFor(channel, startedAt) {
  const safe = String(channel).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(ARCHIVE_DIR, `${safe}_${startedAt}.json`);
}
function saveArchive(channel, data) {
  const startedAt = data.startedAt || new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(archivePathFor(channel, startedAt), JSON.stringify(data, null, 2), 'utf8');
}
function listArchives() {
  return fs.readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(ARCHIVE_DIR, f);
      const stat = fs.statSync(full);
      return { file: f, size: stat.size, modified: stat.mtime };
    })
    .sort((a, b) => b.modified - a.modified);
}
function readArchive(file) {
  const safe = path.basename(file); // منع الخروج بره مجلد الأرشيف
  return readJSON(path.join('archive', safe.replace(/\.json$/, '')), null);
}
function deleteArchive(file) {
  const safe = path.basename(file);
  const full = path.join(ARCHIVE_DIR, safe);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

// ---- قوالب رياكت افتراضية أول تشغيل (لو المستخدم لسه ما زودش/مسحش حاجة) ----
if (!fs.existsSync(filePath('presets'))) {
  writeJSON('presets', ['👏', '🔥', '❤️', 'تمام', 'يلا'].map((value, i) => ({
    id: `seed${i}`, value, addedAt: new Date().toISOString(),
  })));
}

// ---- إعدادات عامة (مفتاح/قيمة) - زي "كتم تلقائي لأي سبيكر جديد" ----
// كل ميزة أوتوماتيكية ليها مفتاح "Enabled" منفصل عن قيمتها - عشان تقدر توقفها مؤقتاً
// من غير ما تمسح القايمة/الرقم اللي ضبطته.
const DEFAULT_SETTINGS = {
  serverReadOnlyMode: false,
  autoMuteNewSpeakers: false,
  speakingTimeLimitEnabled: false,
  speakingTimeLimitMinutes: 5,
  speakerCapEnabled: false,
  speakerCap: 8,
  autoThankOnHandraise: false,
  vipAutoInviteEnabled: true,
  blacklistAutoModEnabled: true,
  protectedListEnabled: true,
  turnRotationEnabled: false,
  turnRotationTimerEnabled: false,
  turnRotationTimerMinutes: 5,
  autoInviteAllNewJoiners: false,
  quietHoursEnabled: false,
  quietHoursStart: '',
  quietHoursEnd: '',
  // ---- جولة سابعة: 20 ميزة مودريتور (2026-08-10) ----
  autoBackupModeratorEnabled: false,
  micCooldownEnabled: false,
  micCooldownMinutes: 10,
  maxMicTurnsEnabled: false,
  maxMicTurns: 3,
  ghostMicEnabled: false,
  ghostMicMinutes: 5,
  blacklistAutoExpireEnabled: false,
  blacklistAutoExpireDays: 7,
  autoBlacklistOnKickEnabled: false,
  roomCapacityEnabled: false,
  roomCapacityMax: 100,
  autoFillVacantSeatEnabled: false,
  welcomeNewSpeakersEnabled: false,
  // ---- ريأكت ترحيب تلقائي (اسمه + قلب) — بيتبعت واحد كل تيك كحد أقصى عشان الأمان.
  // 3 خيارات مستقلة حسب دور الداخل: مستمع عادي / متحدث / مودريتور ----
  welcomeReactionEnabled: false,
  welcomeSpeakerReactionEnabled: false,
  welcomeModeratorReactionEnabled: false,
  roomChatAutoWelcome: false,
  roomChatWelcomeTemplate: 'ازيك يا {الاسم} منورنا ❤️',
  // ---- مركز الإشعارات: تنبيه سطح مكتب مستقل لكل نوع تنبيه مشرفين ----
  desktopNotifyLoneModerator: false,
  desktopNotifyCapacity: false,
  desktopNotifyGhostMic: false,
  desktopNotifyBlacklistJoin: false,
  desktopNotifyWelcomeSpeaker: false,
  // ---- مراقب الأصدقاء في الخلفية (تاب الأصدقاء والإشعارات) ----
  friendsWatcherEnabled: true,
  friendsWatcherIntervalSeconds: 60,
  notifyOnFriendJoin: true,
  notifyOnModAlert: true,
};
function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJSON('settings', {}) };
}
function setSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  writeJSON('settings', s);
  return s;
}

// ---- أسرار محلية (مفاتيح API خارجية زي Giphy) — ملف منفصل عن الإعدادات العادية
// وعن settings.json عشان مايتحفظش في Git بالغلط (متسجّل في .gitignore).
function getSecrets() {
  return readJSON('secrets', {});
}
function setSecret(key, value) {
  const s = getSecrets();
  s[key] = value;
  writeJSON('secrets', s);
  return s;
}

module.exports = {
  getRequestLimits: () => readJSON('request-limits', []),
  saveRequestLimits: (entries) => writeJSON('request-limits', entries),
  getChatReceipts: () => readJSON('chat-receipts', []),
  saveChatReceipts: (entries) => writeJSON('chat-receipts', entries),
  getList, addToList, removeFromList, pruneExpiredList,
  appendAudit, getAudit,
  appendNotification, getNotifications, markNotificationRead, clearNotifications,
  recordFriendSighting, getFriendSightings, setFriendMuted,
  getSchedule, addSchedule, removeSchedule,
  saveArchive, listArchives, readArchive, deleteArchive,
  getSettings, setSetting,
  getSecrets, setSecret,
};
