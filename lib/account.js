'use strict';

// مدير حسابات ذاكرة الجلسة. لا تُكتب التوكنات أو أرقام الهاتف أو أكواد OTP على القرص.
const clubdeck = require('./clubdeckProfile');

let mode = 'clubdeck';
let activeAccountId = 'clubdeck';
let customProfile = null;
const sessionAccounts = new Map();

function getActiveProfile() {
  if (mode === 'custom' && customProfile) return customProfile;
  return clubdeck.getProfile();
}
function getMode() { return mode; }

function safeAccount(id, profile, source) {
  const user = profile?.user || null;
  return { id, source, active: id === activeAccountId, user: user ? { user_id: user.user_id, name: user.name, username: user.username, photo_url: user.photo_url } : null };
}
function listAccounts() {
  const accounts = [safeAccount('clubdeck', clubdeck.getProfile(), 'clubdeck')];
  for (const [id, profile] of sessionAccounts) accounts.push(safeAccount(id, profile, 'session'));
  return accounts;
}
function useClubdeck() {
  mode = 'clubdeck'; activeAccountId = 'clubdeck'; customProfile = null;
}
function activateProfile(profile) {
  const userId = profile.userId || profile.user?.user_id;
  const id = `session:${userId}`;
  sessionAccounts.set(id, profile);
  customProfile = profile; activeAccountId = id; mode = 'custom';
  return profile.user;
}

async function useCustomToken(token, userId) {
  if (!token || !String(token).trim()) throw new Error('التوكين مطلوب');
  if (!userId) throw new Error('تعذر تحديد صاحب التوكين');
  const base = clubdeck.getProfile() || getActiveProfile() || {};
  const candidate = { ...base, token: null, tokens: { auth: String(token).trim() }, userId: Number(userId) };
  const { apiPost } = require('./chClient');
  const result = await apiPost('/get_profile', { user_id: Number(userId) }, candidate);
  const user = result?.user_profile;
  if (!user?.user_id) throw new Error('التوكين مرفوض أو هوية الحساب غير صحيحة');
  candidate.user = { user_id: user.user_id, name: user.name, username: user.username, photo_url: user.photo_url };
  candidate.userId = user.user_id;
  return activateProfile(candidate);
}
async function useCustomTokenByUsername(token, username) {
  const normalized = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!normalized) throw new Error('اسم المستخدم مطلوب');
  const { apiPost } = require('./chClient');
  const resolverProfile = getActiveProfile();
  if (!resolverProfile) throw new Error('يلزم حساب نشط للبحث عن اسم المستخدم أولًا');
  const result = await apiPost('/search_users', { query: normalized }, resolverProfile);
  const match = (result?.users || []).find((user) => String(user.username || '').toLowerCase() === normalized);
  if (!match?.user_id) throw new Error('لم يتم العثور على اسم المستخدم بشكل مطابق');
  return useCustomToken(token, match.user_id);
}
function switchAccount(id) {
  if (id === 'clubdeck') { useClubdeck(); return getActiveIdentity(); }
  const profile = sessionAccounts.get(String(id));
  if (!profile) throw new Error('الحساب غير موجود في جلسة السيرفر الحالية');
  customProfile = profile; activeAccountId = String(id); mode = 'custom';
  return getActiveIdentity();
}
function unauthenticatedProfile() {
  const base = clubdeck.getProfile() || getActiveProfile();
  if (!base) throw new Error('يلزم توفر بصمة تطبيق Clubdeck لبدء تسجيل الهاتف');
  return { ...base, token: null, tokens: {}, userId: null, user: null };
}
async function startPhoneAuth(phoneNumber) {
  const phone = String(phoneNumber || '').replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('اكتب رقم الهاتف بصيغة دولية مثل +201xxxxxxxxx');
  const { apiPost } = require('./chClient');
  const result = await apiPost('/start_phone_number_auth', { phone_number: phone }, unauthenticatedProfile());
  return { sent: result?.success !== false, isBlocked: !!result?.is_blocked, retryAfter: result?.retry_after_seconds || null };
}
async function completePhoneAuth(phoneNumber, verificationCode) {
  const phone = String(phoneNumber || '').replace(/[\s()-]/g, '');
  const code = String(verificationCode || '').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('رقم الهاتف غير صالح');
  if (!/^\d{4,8}$/.test(code)) throw new Error('كود التحقق غير صالح');
  const { apiPost } = require('./chClient');
  const result = await apiPost('/complete_phone_number_auth', { phone_number: phone, verification_code: code }, unauthenticatedProfile());
  const token = result?.auth_token || result?.token || result?.access_token;
  const user = result?.user_profile || result?.user;
  if (!token || !user?.user_id) throw new Error(result?.error_message || 'لم يُرجع Clubhouse جلسة مكتملة');
  const base = clubdeck.getProfile() || {};
  const profile = { ...base, token: null, tokens: { auth: token }, userId: user.user_id, user: { user_id: user.user_id, name: user.name, username: user.username, photo_url: user.photo_url } };
  return activateProfile(profile);
}
function getActiveIdentity() {
  const p = getActiveProfile();
  const user = p?.user || null;
  return { id: activeAccountId, mode, user, userId: p?.userId || user?.user_id || null };
}

module.exports = { getActiveProfile, getMode, getActiveIdentity, listAccounts, useClubdeck, useCustomToken, useCustomTokenByUsername, switchAccount, startPhoneAuth, completePhoneAuth };
