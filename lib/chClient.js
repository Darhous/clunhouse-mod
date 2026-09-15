'use strict';
// عميل خفيف لواجهة Clubhouse الخاصة (private API) - نفس الواجهة اللي Clubdeck نفسه بيستخدمها.
// ملاحظة: الواجهة غير موثّقة رسمياً، فأسماء الحقول هنا مبنية على ما تم رصده فعلياً
// داخل كود Clubdeck (main.prod.js / renderer.prod.js). أول اختبار حي هيأكد أو يصحح التفاصيل.
const { EventEmitter } = require('events');
const account = require('./account');
const { getSettings, getRequestLimits, saveRequestLimits } = require('./state');
const { createFeatureLimiter } = require('./featureLimiter');
const featureLimiter = createFeatureLimiter({ maxRequests: 3, windowMs: 60000, load: getRequestLimits, save: saveRequestLimits });
let requestSequence = 0;

const log = new EventEmitter();
function safeLogBody(value) {
  if (Array.isArray(value)) return value.map(safeLogBody);
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    safe[key] = /(token|authorization|phone|email|verification|otp|device.?id|access|refresh)/i.test(key) ? '[REDACTED]' : safeLogBody(child);
  }
  return safe;
}

// Clubhouse retired the old room-interaction build used by the installed Clubdeck
// profile. Keep the shared session untouched and override only the modern room
// actions that reject the legacy build. Verified live on 2026-08-22.
const MODERN_ROOM_CLIENT = Object.freeze({
  appBuild: '1038',
  appVersion: '26.08.18',
  userAgentStatic: 'clubhouse/1038 (Linux; Android 13; Scale/2.75)',
});

// أرقام الـ ID بتاعت الهاوسات (social_club_id) أكبر من أقصى رقم JS ممكن يمثّله بدقة
// (Number.MAX_SAFE_INTEGER)، فـ JSON.parse العادي كان بيقرّبها لرقم غلط بصمت.
// الحل: نلف أي رقم خام طويل (16+ رقم) بعلامات تنصيص قبل الـ parse عشان يفضل String بدقّته الكاملة.
function safeJsonParse(text) {
  const guarded = text.replace(/([:\[,]\s*)(-?\d{16,})(\s*[,}\]])/g, '$1"$2"$3');
  return JSON.parse(guarded);
}

function buildHeaders(profileOverride) {
  const p = profileOverride || account.getActiveProfile();
  if (!p) return null;
  const auth = (p.tokens && p.tokens.auth) || p.token;
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json',
    'User-Agent': p.userAgentStatic || p.userAgent || 'clubhouse/android',
    'CH-Languages': p.languages || 'en-US',
    'CH-Locale': p.locale || 'en_US',
    'CH-AppBuild': p.appBuild || '',
    'CH-AppVersion': p.appVersion || '',
    'CH-UserID': String(p.userId || (p.user && p.user.user_id) || ''),
    'CH-DeviceId': p.deviceId || '',
    'CH-TimeZone': p.timezone || 'UTC',
    'Accept-Language': p.acceptLanguages || 'en-US;q=1',
    'Authorization': auth ? `Token ${auth}` : '',
  };
}

async function requestNow(method, pathName, data, profileOverride) {
  if (getSettings().serverReadOnlyMode && method === 'POST' && !/^\/(get_|search_|active_ping$|replay_active_ping$)/.test(pathName)) {
    throw Object.assign(new Error('وضع القراءة فقط مفعل — تم منع الإرسال'), { status: 423, stopOperation: true });
  }
  const p = profileOverride || account.getActiveProfile();
  if (!p) throw new Error('مفيش بيانات جلسة — تأكد إن Clubdeck متثبت ومسجّل دخول');
  const apiRoot = p.apiRoot || 'https://www.clubhouseapi.com/api';
  const headers = buildHeaders(p);

  let url = `${apiRoot}${pathName}`;
  let body;
  if (method === 'GET') {
    const qs = new URLSearchParams(data || {}).toString();
    if (qs) url += `?${qs}`;
  } else {
    body = JSON.stringify(data || {});
  }

  const startedAt = Date.now();
  const requestId = `${startedAt.toString(36)}-${++requestSequence}`;
  log.emit('request', { requestId, time: new Date(startedAt).toISOString(), path: pathName, method, body: safeLogBody(data) });

  let res, json;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    try { json = text ? safeJsonParse(text) : {}; } catch { json = { raw: text }; }
  } catch (err) {
    if (log.listenerCount('error')) log.emit('error', { requestId, time: new Date().toISOString(), path: pathName, method, error: err.message });
    throw err;
  }

  const ms = Date.now() - startedAt;
  const retry = res.headers.get('retry-after');
  const retryAfterMs = retry ? (/^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : null;
  log.emit('response', { requestId, time: new Date().toISOString(), path: pathName, method, status: res.status, ms, retryAfterMs: res.status === 429 ? (retryAfterMs || 180000) : null, body: safeLogBody(json) });

  if (!res.ok) {
    const errMsg = (json && (json.error_message || json.message)) || `HTTP ${res.status}`;
    const err = new Error(errMsg);
    err.status = res.status;
    err.body = json;
    if (retryAfterMs) err.retryAfterMs = retryAfterMs;
    throw err;
  }
  return json;
}

function request(method, pathName, data, profileOverride, validate) {
  const base = account.getActiveProfile();
  const profile = profileOverride || base;
  // Chat welcomes and reactions share spacing even across tabs/manual/auto sources.
  const feature = ['/emoji_reaction', '/gif_reaction', '/send_channel_message'].includes(pathName) ? 'room-engagement'
    : ['/join_channel', '/leave_channel'].includes(pathName) ? 'room-membership'
      : ['/like_channel_message', '/unlike_channel_message'].includes(pathName) ? 'room-chat-likes' : null;
  if (!feature) { validate?.(); return requestNow(method, pathName, data, profile); }
  const key = `${profile?.userId || profile?.user?.user_id}:${feature}`;
  const channelContext = require('./poller').getContext();
  return featureLimiter.run(key, () => requestNow(method, pathName, data, profile), () => {
    validate?.();
    if (account.getActiveProfile() !== base || require('./poller').getContext() !== channelContext) {
      throw Object.assign(new Error('اتغير الحساب أو اتصال الغرفة — تم إلغاء الإرسال المنتظر'), { status: 409, stopOperation: true });
    }
  });
}

const apiPost = (pathName, body, profileOverride, validate) => request('POST', pathName, body, profileOverride, validate);
const apiGet = (pathName, query, profileOverride) => request('GET', pathName, query, profileOverride);
const apiPostModernRoom = (pathName, body, profileOverride) => {
  const base = profileOverride || account.getActiveProfile();
  return request('POST', pathName, body, { ...base, ...MODERN_ROOM_CLIENT });
};
const apiGetModernRoom = (pathName, query, profileOverride) => {
  const base = profileOverride || account.getActiveProfile();
  return request('GET', pathName, query, { ...base, ...MODERN_ROOM_CLIENT });
};

module.exports = { apiPost, apiGet, apiPostModernRoom, apiGetModernRoom, buildHeaders, MODERN_ROOM_CLIENT, log, safeLogBody, featureLimiter };
