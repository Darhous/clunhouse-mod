'use strict';
// كل أكشنات الموديريشن الفعلية (كتم / رفع / إنزال / رياكت) - نقطة واحدة يتسجل منها كل حاجة في سجل الأكشنات.
const { apiPost, apiPostModernRoom } = require('./chClient');
const { appendAudit, getSettings, addToList } = require('./state');

function requireSuccess(result) {
  if (result?.success === false) {
    const err = new Error(result.error_message || result.message || 'Clubhouse رفض تنفيذ العملية');
    err.body = result;
    throw err;
  }
  return result;
}

async function muteUser(channel, user) {
  await apiPost('/mute_speaker', { channel, user_id: user.user_id });
  appendAudit({ action: 'mute', channel, targetId: user.user_id, targetName: user.name });
}

async function inviteUser(channel, user) {
  await apiPost('/invite_speaker', { channel, user_id: user.user_id });
  appendAudit({ action: 'invite', channel, targetId: user.user_id, targetName: user.name });
}

async function lowerUser(channel, user) {
  await apiPost('/uninvite_speaker', { channel, user_id: user.user_id });
  appendAudit({ action: 'lower', channel, targetId: user.user_id, targetName: user.name });
}

async function joinChannel(channel) {
  const result = await apiPost('/join_channel', { channel });
  appendAudit({ action: 'join-channel', channel });
  return result;
}

// Clubhouse expects a lightweight heartbeat while this account is actually inside
// a room. Reading /get_channel is not enough to keep the membership alive.
async function keepChannelAlive(channel) {
  return apiPost('/active_ping', { channel });
}

async function audienceReply(channel, { raiseHands = false, unraiseHands = false } = {}) {
  const result = requireSuccess(await apiPostModernRoom('/audience_reply', {
    channel,
    raise_hands: !!raiseHands,
    unraise_hands: !!unraiseHands,
  }));
  appendAudit({ action: raiseHands ? 'raise-hand' : 'lower-hand', channel });
  return result;
}

async function becomeSpeaker(channel) {
  const result = requireSuccess(await apiPostModernRoom('/become_speaker', { channel }));
  appendAudit({ action: 'become-speaker', channel });
  return result;
}

async function setMicrophoneEnabled(channel, enabled) {
  const result = requireSuccess(await apiPostModernRoom('/update_microphone_enabled', { channel, microphone_enabled: !!enabled }));
  appendAudit({ action: enabled ? 'microphone-enable' : 'microphone-disable', channel });
  return result;
}

async function acceptSpeakerInvite(channel) {
  const result = await apiPost('/accept_speaker_invite', { channel });
  appendAudit({ action: 'accept-speaker-invite', channel });
  return result;
}

async function moveToAudience(channel, user) {
  const result = await apiPost('/uninvite_speaker', { channel, user_id: user.user_id });
  appendAudit({ action: 'move-self-to-audience', channel, targetId: user.user_id, targetName: user.name });
  return result;
}

async function sendReaction(channel, user, value) {
  // اسم الحقل الحقيقي اللي السيرفر بيقبله هو "emoji" مش "value" (اتأكدت بالاختبار الحي) -
  // وبيقبل نص حر (مش بس إيموجي) ويرجع success:true.
  const result = requireSuccess(await apiPostModernRoom('/emoji_reaction', { channel, user_id: user.user_id, emoji: value }));
  appendAudit({ action: 'reaction', channel, targetId: user.user_id, targetName: user.name, value });
  return result;
}

async function kickUser(channel, user) {
  await apiPost('/block_from_channel', { channel, user_id: user.user_id });
  appendAudit({ action: 'kick', channel, targetId: user.user_id, targetName: user.name });
  // إضافة تلقائية للقايمة السودة لأي مطرود - لو الخيار مفعّل بس (اختياري، افتراضياً قافل)
  if (getSettings().autoBlacklistOnKickEnabled) {
    addToList('blacklist', `${user.name || ''} ${user.username || ''}`.trim() || String(user.user_id));
  }
}

async function setHandraiseLock(channel, locked) {
  await apiPost('/change_handraise_settings', { channel, is_enabled: !locked });
  appendAudit({ action: locked ? 'lock-handraise' : 'unlock-handraise', channel });
}

async function setRoomTitle(channel, title) {
  await apiPost('/set_channel_title', { channel, title });
  appendAudit({ action: 'set-title', channel, value: title });
}

async function endRoom(channel) {
  await apiPost('/end_channel', { channel });
  appendAudit({ action: 'end-room', channel });
}

async function promoteModerator(channel, user) {
  await apiPost('/make_moderator', { channel, user_id: user.user_id });
  appendAudit({ action: 'promote-moderator', channel, targetId: user.user_id, targetName: user.name });
}

// عكس الترقية - شكل الـ endpoint غير مؤكد لايف لحد دلوقتي (نفس /make_moderator بـ value:false،
// تخمين مبني على نمط Clubhouse المعتاد في التبديل بين حالتين). أول تجربة حية هتأكد أو تصحح.
async function demoteModerator(channel, user) {
  await apiPost('/make_moderator', { channel, user_id: user.user_id, value: false });
  appendAudit({ action: 'demote-moderator', channel, targetId: user.user_id, targetName: user.name });
}

async function bringToRoom(channel, userId) {
  await apiPost('/invite_to_existing_channel', { channel, user_id: Number(userId) });
  appendAudit({ action: 'bring-to-room', channel, targetId: userId });
}

// اسم الحقل والـendpoint اتلقوا في كود Clubdeck نفسه (set_user_channel_emoji /
// remove_user_channel_emoji) — لسه محتاجين تأكيد حي (عقد مرشح).
async function setChannelEmoji(channel, emoji) {
  const result = requireSuccess(await apiPost('/set_user_channel_emoji', { channel, emoji }));
  appendAudit({ action: 'set-channel-emoji', channel, value: emoji });
  return result;
}
async function clearChannelEmoji(channel) {
  const result = requireSuccess(await apiPost('/remove_user_channel_emoji', { channel }));
  appendAudit({ action: 'clear-channel-emoji', channel });
  return result;
}

// اسم الـendpoint (/gif_reaction) وحقل giphy_id اتلقوا في كود Clubdeck نفسه (عبر @giphy/js-fetch-api) —
// عقد مرشح، لسه محتاج تأكيد حي. Clubhouse mod by Darhous معندوش مفتاح Giphy API فمفيش بحث GIF داخلي؛
// المستخدم بيلصق معرّف أو رابط GIF من Giphy نفسه.
async function sendGifReaction(channel, user, giphyId) {
  const result = requireSuccess(await apiPostModernRoom('/gif_reaction', { channel, user_id: user.user_id, giphy_id: giphyId }));
  appendAudit({ action: 'gif-reaction', channel, targetId: user.user_id, targetName: user.name, value: giphyId });
  return result;
}

async function setRoomMessages(channel, enabled) {
  await apiPost(enabled ? '/enable_channel_messages' : '/disable_channel_messages', { channel });
  appendAudit({ action: enabled ? 'enable-room-chat' : 'disable-room-chat', channel });
}

async function addRoomLink(channel, link) {
  const result = await apiPost('/add_channel_link', { channel, link });
  appendAudit({ action: 'add-room-link', channel, value: link });
  return result;
}

async function removeRoomLink(channel) {
  await apiPost('/remove_channel_link', { channel });
  appendAudit({ action: 'remove-room-link', channel });
}

// Individual failures may continue; account/room changes and rate limits stop the batch.
async function bulk(users, fn, delayMs = 250) {
  const results = [];
  const poller = require('./poller');
  const account = require('./account');
  const context = poller.getContext();
  const profile = account.getActiveProfile();
  for (const [index, u] of users.entries()) {
    if (poller.getContext() !== context || account.getActiveProfile() !== profile || getSettings().serverReadOnlyMode) {
      results.push(...users.slice(index).map((user) => ({ user, ok: false, skipped: true, error: 'لم يُرسل: تغير اتصال الغرفة أو الحساب أو وضع القراءة فقط' })));
      break;
    }
    try {
      await fn(u);
      results.push({ user: u, ok: true });
    } catch (err) {
      results.push({ user: u, ok: false, error: err.message, status: err.status, retryAfterMs: err.retryAfterMs });
      if (err.status === 429 || err.stopOperation) {
        results.push(...users.slice(index + 1).map((user) => ({ user, ok: false, skipped: true, error: 'لم يُرسل: توقفت العملية بعد الرفض السابق' })));
        break;
      }
    }
    // فاصل بين كل نداء ونداء عشان منضربش السيرفر بسرعة عالية جداً — قابل للتخصيص لأن الرياكتس
    // الجماعية تحديدًا لقينا حيًا إن Clubhouse بيوقفها بسرعة أكبر من أكشنات الموديريشن العادية.
    if (index < users.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}

module.exports = { muteUser, inviteUser, lowerUser, joinChannel, keepChannelAlive, audienceReply, becomeSpeaker, setMicrophoneEnabled, acceptSpeakerInvite, moveToAudience, sendReaction, kickUser, setHandraiseLock, setRoomTitle, endRoom, bulk, promoteModerator, demoteModerator, bringToRoom, setRoomMessages, addRoomLink, removeRoomLink, setChannelEmoji, clearChannelEmoji, sendGifReaction };
