'use strict';
// يقرأ ملف profile.json الخاص بـ Clubdeck (قراءة فقط - لا يعدّل أي حاجة فيه أو في البرنامج الأصلي).
const fs = require('fs');
const path = require('path');

// بيتحدد أوتوماتيك لحساب Windows الحالي اللي البرنامج شغال عليه - مش مربوط بجهاز معيّن.
const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
const PROFILE_PATH = path.join(LOCAL_APPDATA, 'Programs', 'Clubdeck', 'profile.json');

let cached = null;
let lastError = null;

function load() {
  try {
    const raw = fs.readFileSync(PROFILE_PATH, 'utf8');
    cached = JSON.parse(raw);
    lastError = null;
  } catch (err) {
    lastError = err.message;
  }
  return cached;
}

// إعادة التحميل تلقائياً لو المستخدم عمل تسجيل دخول جديد في Clubdeck (توكن جديد)
try {
  fs.watch(path.dirname(PROFILE_PATH), { persistent: false }, (eventType, filename) => {
    if (filename === 'profile.json') {
      setTimeout(load, 300); // تأخير بسيط لضمان انتهاء الكتابة
    }
  });
} catch (err) {
  // مش قادرين نراقب الملف (مثلاً المسار مش موجود) - هيتم التحميل عند الطلب فقط
}

load();

function getProfile() {
  if (!cached) load();
  return cached;
}

function getError() {
  return lastError;
}

module.exports = { getProfile, getError, PROFILE_PATH };
