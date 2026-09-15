'use strict';
// حلقة المراقبة الحية للغرفة: بتجيب حالة الغرفة كل ٣ ثواني، تقارنها بالسابقة،
// وتطلق أحداث (رفع إيد جديد / دخول شخص جديد) + تطبّق الأوتوموديريشن (VIP / قايمة سوداء) + تحدّث الأرشيف.
const { EventEmitter } = require('events');
const { apiPost, apiGet, apiGetModernRoom, featureLimiter } = require('./chClient');
const { getList, appendAudit, saveArchive, getSchedule, removeSchedule, getSettings, pruneExpiredList } = require('./state');
const { getActiveProfile: getProfile } = require('./account');
const actions = require('./actions');

const bus = new EventEmitter();

let timer = null;
let presenceTimer = null;
let presencePingInFlight = false;
let currentChannel = null;
let generation = 0;
let tickInFlight = null;
let queueRetryAt = 0;
let queueLastError = null;
let lastSpeakerIds = new Set();
let lastListenerIds = new Set();
let lastRaiseIds = new Set();
let archiveRecord = null;
let lastArchiveSave = 0;
let lastState = { connected: false };
let consecutiveFailures = 0;
let lastTurnRotationAt = 0;
let quietHoursLockedToday = null; // بيحفظ تاريخ اليوم اللي اتقفل فيه رفع الإيد بالفعل - عشان مانقفلش كل تيك

// ---- جولة سابعة: حالة الميزات العشرين الجديدة (بتتصفّر مع كل اتصال جديد بغرفة) ----
let micCooldownMap = new Map();   // userId -> وقت انتهاء فترة التبريد (ms epoch)
let micTurnCounts = new Map();    // userId -> عدد مرات صعوده على المسرح الجلسة دي
let ghostMicLastActive = new Map(); // userId -> آخر وقت شفناه نشط على المسرح
let lastNonEmptyQueue = [];       // آخر نسخة غير فاضية من طابور رفع الإيد (نسخة احتياطية)
let capacityAlerted = false;
let loneModAlerted = false;
let welcomeReactionQueue = []; // طابور الترحيب التلقائي — واحد بس بيتبعت كل تيك (~3 ثواني) عشان الأمان
let welcomeReactionBackoffUntil = 0; // اتأكد حيًا إن حد الـ20/دقيقة النظري لسه بيتضرب فعليًا - لما Clubhouse يرفض بـ429 نوقف الإرسال تمامًا لفترة تبريد بدل ما نكمل نحاول كل تيك ونجمع رفض ورا رفض
let welcomeReactionBusy = false;

function normalizeChannelState(raw) {
  const users = Array.isArray(raw.users) ? raw.users : [];
  const speakers = users.filter((u) => u.is_speaker || u.role === 'speaker' || u.is_moderator);
  const listeners = users.filter((u) => !speakers.includes(u));

  // دور المستخدم الحالي في الغرفة دي بالذات (بتختلف من غرفة لغرفة) - عشان نعرض
  // له بس الأزرار اللي فعلاً عنده صلاحية لها، بدل ما نوريه أزرار مودريتور وهو مجرد سبيكر أو مستمع.
  const p = getProfile();
  const myId = p && (p.userId || (p.user && p.user.user_id));
  const me = users.find((u) => String(u.user_id) === String(myId));
  const isSpeaker = !!(me && (me.is_speaker || me.role === 'speaker' || me.is_moderator));
  const myRole = me ? (me.is_moderator ? 'moderator' : (isSpeaker ? 'speaker' : 'listener')) : 'listener';
  const capabilities = raw.user_capabilities || {};
  const isSocialMode = raw.is_social_mode === true || raw.is_social_club_lounge === true;
  const directSpeakAvailable = isSocialMode || raw.is_automatic_speaker_approval_available === true;

  return {
    channel: raw.channel || currentChannel,
    topic: raw.topic || raw.title || '',
    numAll: raw.num_all ?? users.length,
    numSpeakers: raw.num_speakers ?? speakers.length,
    speakers,
    listeners,
    myRole,
    roomMode: isSocialMode ? 'social' : (directSpeakAvailable ? 'auto-speaker' : 'regular'),
    directSpeakAvailable,
    self: {
      userId: myId || null,
      isInRoom: !!me,
      isSpeaker,
      isModerator: !!(me && me.is_moderator),
      isInvitedAsSpeaker: !!(me && me.is_invited_as_speaker),
      hasRaisedHand: !!(me && me.has_raised_hands),
      handraiseEnabled: raw.is_handraise_enabled !== false,
      handraisePermission: raw.handraise_permission ?? raw.handraise_permission_type ?? null,
      directSpeakAvailable,
    },
    capabilities,
    raw,
  };
}

function isWithinQuietHours(settings) {
  if (!settings.quietHoursEnabled || !settings.quietHoursStart || !settings.quietHoursEnd) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = settings.quietHoursStart.split(':').map(Number);
  const [eh, em] = settings.quietHoursEnd.split(':').map(Number);
  const start = sh * 60 + sm, end = eh * 60 + em;
  if (Number.isNaN(start) || Number.isNaN(end) || start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end; // بيعدي نص الليل
}

async function fetchRaiseQueue(channel, room, epoch) {
  // Do not call a moderator-only queue from a listening/observing account.
  if (!room.self.isModerator) return [];
  if (Date.now() < queueRetryAt) return { error: queueLastError };
  try {
    // GET + channel matches the installed Clubdeck contract. The supplied log
    // disproves the earlier claim that modern headers alone fix HTTP 400.
    const res = await apiGetModernRoom('/get_handraise_queue', { channel });
    if (res.success === false) throw Object.assign(new Error(res.error_message || 'تعذر قراءة طابور رفع اليد'), { status: 400 });
    if (epoch === generation) { queueRetryAt = 0; queueLastError = null; }
    return res.handraises || res.users || res.queue || [];
  } catch (err) {
    if (epoch === generation) {
      queueLastError = `${err.message} — قراءة الطابور غير متاحة حاليًا؛ إعادة المحاولة لاحقًا`;
      queueRetryAt = Date.now() + (err.retryAfterMs || ([400, 403, 404, 405].includes(err.status) ? 300000 : 30000));
    }
    return { error: err.message };
  }
}

async function tick() {
  const epoch = generation;
  if (tickInFlight === epoch) return;
  tickInFlight = epoch;
  try { await tickOnce(epoch); }
  catch (err) { if (epoch === generation) bus.emit('auto-action-error', { type: 'room-poll', error: err.message }); }
  finally { if (tickInFlight === epoch) tickInFlight = null; }
}

async function tickOnce(epoch) {
  if (!currentChannel) return;
  let raw;
  try {
    raw = await apiPost('/get_channel', { channel: currentChannel });
  } catch (err) {
    if (epoch !== generation) return;
    lastState = { connected: false, error: err.message };
    bus.emit('state', lastState);
    consecutiveFailures += 1;
    // 404/410 = الغرفة خلصت فعلياً. أي خطأ تاني بيتكرر 3 مرات ورا بعض (~9 ثواني) معناه
    // إننا فقدنا الوصول للغرفة برضه (اتشلنا، الشبكة مقطوعة...) - منستناش لحد الأبد ونسيب
    // currentChannel معلّق وهو فعلياً مش شغال (كان بيسبب نداءات فاشلة متكررة لميزات تانية زي المقترحين).
    if (err.status === 404 || err.status === 410 || consecutiveFailures >= 3) {
      finishArchive();
      bus.emit('room-ended', { channel: currentChannel });
      stop();
    }
    return;
  }
  if (epoch !== generation) return;
  consecutiveFailures = 0;

  const state = normalizeChannelState(raw);
  const queue = await fetchRaiseQueue(currentChannel, state, epoch);
  if (epoch !== generation) return;
  state.raiseQueue = Array.isArray(queue) ? queue : [];
  state.raiseQueueError = Array.isArray(queue) ? null : queue.error;
  state.connected = true;
  const hadBaseline = !!lastState.connected;
  lastState = state;

  const speakerIds = new Set(state.speakers.map((u) => u.user_id));
  const listenerIds = new Set(state.listeners.map((u) => u.user_id));
  const raiseIds = new Set(state.raiseQueue.map((u) => u.user_id));

  // -- نسخة احتياطية من آخر طابور غير فاضي (لو الطابور اتقفل/فرغ فجأة) --
  if (state.raiseQueue.length) lastNonEmptyQueue = state.raiseQueue;

  // -- تنبيه رفع إيد جديد --
  const settingsNow = getSettings();
  for (const u of state.raiseQueue) {
    if (!lastRaiseIds.has(u.user_id)) {
      bus.emit('hand-raise', u);
      maybeAutoInvite(u);
      if (settingsNow.autoThankOnHandraise) maybeThankRaisedHand(u);
    }
  }

  // -- بلاك ليست بصلاحية انتهاء: نشيل أي بند أقدم من المدة المحددة --
  if (settingsNow.blacklistAutoExpireEnabled) {
    pruneExpiredList('blacklist', settingsNow.blacklistAutoExpireDays);
  }

  // -- مين لسه مودريتور وحيد في الغرفة؟ + تعيين مودريتور احتياطي تلقائي لو مفيش مودريتور خالص --
  const modCount = state.speakers.filter((u) => u.is_moderator).length;
  if (modCount <= 1 && !loneModAlerted) {
    loneModAlerted = true;
    bus.emit('mod-alert', { type: 'lone-moderator', count: modCount });
  } else if (modCount > 1) {
    loneModAlerted = false;
  }
  if (modCount === 0 && settingsNow.autoBackupModeratorEnabled) {
    maybeAutoBackupModerator([...state.speakers, ...state.listeners]);
  }

  // -- حد أقصى تلقائي لعدد الحضور (تنبيه فقط - مفيش API يمنع دخول الغرفة نفسها) --
  if (settingsNow.roomCapacityEnabled && settingsNow.roomCapacityMax > 0) {
    if (state.numAll >= settingsNow.roomCapacityMax && !capacityAlerted) {
      capacityAlerted = true;
      bus.emit('mod-alert', { type: 'capacity-reached', numAll: state.numAll, max: settingsNow.roomCapacityMax });
    } else if (state.numAll < settingsNow.roomCapacityMax) {
      capacityAlerted = false;
    }
  }

  // -- كشف "المايك الصامت": بيحتاج حقل is_speaking من رد Clubhouse (لو مش موجود، الميزة بتتدهور
  // لتنبيه واحد بعد أطول مدة بس بدل رصد نشاط حقيقي - موضّح في الواجهة) --
  if (settingsNow.ghostMicEnabled) trackGhostMic(state, settingsNow);

  // -- سقف وقت الكلام: أي سبيكر (مش مودريتور) اتكلم أكتر من الوقت المسموح ينزل تلقائي --
  if (settingsNow.speakingTimeLimitEnabled && settingsNow.speakingTimeLimitMinutes > 0) {
    for (const u of state.speakers) {
      if (u.is_moderator || !u.time_joined_as_speaker) continue;
      const minutes = (Date.now() - new Date(u.time_joined_as_speaker).getTime()) / 60000;
      if (minutes >= settingsNow.speakingTimeLimitMinutes) maybeEnforceTimeLimit(u);
    }
  }

  // -- دخول أعضاء جدد لمستمعين/متكلمين: فحص القايمة السودة + طابور ريأكت الترحيب --
  // 3 خيارات ترحيب مستقلة عن بعض حسب دور الشخص الداخل (مودريتور / متحدث / مستمع عادي) -
  // كل واحد بيتفعّل أو يتقفل لوحده من غير ما يأثر على التانيين.
  for (const u of [...state.speakers, ...state.listeners]) {
    if (!lastSpeakerIds.has(u.user_id) && !lastListenerIds.has(u.user_id)) {
      // تنبيه فوري لو حد من القايمة السودة دخل - حتى لو الأتمتة (الكتم/الإنزال التلقائي) قافلة
      checkBlacklistJoinAlert(u);
      const isSpeakerNow = state.speakers.some((s) => s.user_id === u.user_id);
      maybeAutoModerate(u, isSpeakerNow);
      // Opening/reconnecting the panel is not a new entrance; do not greet the
      // existing audience (or our own account) with a fresh reaction burst.
      if (!hadBaseline || String(u.user_id) === String(state.self.userId)) continue;
      if (u.is_moderator) {
        if (settingsNow.welcomeModeratorReactionEnabled) welcomeReactionQueue.push(u);
      } else if (isSpeakerNow) {
        if (settingsNow.welcomeSpeakerReactionEnabled) welcomeReactionQueue.push(u);
      } else if (settingsNow.welcomeReactionEnabled) {
        welcomeReactionQueue.push(u);
      }
    }
  }

  // -- أي حد جديد على المسرح دلوقتي (سواء دخل سبيكر أو اتصعد من الطابور): عداد مرات الصعود،
  // تهيئة تتبع المايك الصامت، وتنفيذ تجميد المايك (Cooldown) لو لسه في فترته --
  for (const u of state.speakers) {
    if (lastSpeakerIds.has(u.user_id)) continue;
    micTurnCounts.set(u.user_id, (micTurnCounts.get(u.user_id) || 0) + 1);
    ghostMicLastActive.set(u.user_id, Date.now());
    if (settingsNow.micCooldownEnabled && !u.is_moderator) {
      const until = micCooldownMap.get(u.user_id);
      if (until && Date.now() < until) maybeEnforceCooldown(u);
    }
    if (settingsNow.welcomeNewSpeakersEnabled) {
      bus.emit('mod-alert', { type: 'welcome-speaker', user: u });
    }
  }

  // -- أي حد نزل من المسرح: نبدأ له فترة تبريد (لو مفعّلة)، ولو "رفع تلقائي لأول واحد فور ما مكان
  // يفضى" مفعّل ومفيش سقف سبيكرز واصله، ندعو اللي بعده في الطابور --
  for (const id of lastSpeakerIds) {
    if (speakerIds.has(id)) continue;
    if (settingsNow.micCooldownEnabled) {
      micCooldownMap.set(id, Date.now() + settingsNow.micCooldownMinutes * 60000);
    }
    if (settingsNow.autoFillVacantSeatEnabled) maybeAutoFillVacantSeat();
  }

  // -- دعوة تلقائية لأي مستمع جديد دخل الغرفة (لو الخيار مفعّل، وبيحترم القايمة السودة) --
  if (settingsNow.autoInviteAllNewJoiners) {
    for (const u of state.listeners) {
      if (!lastSpeakerIds.has(u.user_id) && !lastListenerIds.has(u.user_id)) {
        maybeAutoInviteNewJoiner(u);
      }
    }
  }

  // -- أي حد بقى سبيكر جديد (سواء انضم كسبيكر أو اتصعد من مستمع) - كتم تلقائي لو الخيار مفعّل أو وقت هدوء --
  const inQuietHours = isWithinQuietHours(settingsNow);
  if (settingsNow.autoMuteNewSpeakers || inQuietHours) {
    for (const u of state.speakers) {
      if (!lastSpeakerIds.has(u.user_id)) maybeAutoMuteNewSpeaker(u);
    }
  }
  // -- ساعات هدوء: قفل رفع الإيد مرة واحدة لما ندخل الفترة (مش كل تيك) --
  if (inQuietHours) {
    const todayKey = new Date().toISOString().slice(0, 10) + '-' + settingsNow.quietHoursStart;
    if (quietHoursLockedToday !== todayKey) {
      quietHoursLockedToday = todayKey;
      actions.setHandraiseLock(currentChannel, true).catch(() => {});
    }
  }

  // -- وضع "دور تلقائي": أي سبيكر نزل (كان موجود قبل كده وخرج من قائمة السبيكرز) بيطلع اللي بعده من الطابور --
  if (settingsNow.turnRotationEnabled && state.raiseQueue.length) {
    for (const id of lastSpeakerIds) {
      if (!speakerIds.has(id)) { maybeRotateNextTurn(); break; }
    }
  }

  // -- وضع "دور تلقائي بتوقيت": كل X دقيقة، ينزل أطول سبيكر (مش مودريتور) ويطلع اللي بعده من الطابور --
  if (settingsNow.turnRotationTimerEnabled && settingsNow.turnRotationTimerMinutes > 0 && state.raiseQueue.length) {
    const dueMs = settingsNow.turnRotationTimerMinutes * 60000;
    if (Date.now() - lastTurnRotationAt >= dueMs) {
      lastTurnRotationAt = Date.now();
      maybeRotateTurnByTimer(state.speakers);
    }
  }

  lastSpeakerIds = speakerIds;
  lastListenerIds = listenerIds;
  lastRaiseIds = raiseIds;

  // -- ريأكت الترحيب التلقائي: واحد بس من الطابور كل تيك (~3 ثواني) — لكن اتأكد حيًا إن الحد الحقيقي
  // اللي Clubhouse بيقبله أقل من كده بكتير، فبيرفض بـ429 حتى مع معدل 20/دقيقة. عشان كده لو حصل رفض
  // منكملش نحاول كل تيك (ده كان بيراكم رفض ورا رفض من غير فايدة) - بنوقف الإرسال تمامًا لمدة تبريد.
  if (welcomeReactionQueue.length && !welcomeReactionBusy && Date.now() >= welcomeReactionBackoffUntil) {
    maybeSendWelcomeReaction(welcomeReactionQueue.shift());
  }

  updateArchiveSnapshot(state);
  runDueSchedules();

  // بيانات مساعدة للواجهة (بادچات تجميد المايك / عدد مرات الصعود) - مش لازمة لأي أكشن، عرض بس
  state.micTurnCounts = Object.fromEntries(micTurnCounts);
  state.micCooldowns = Object.fromEntries([...micCooldownMap].filter(([, until]) => until > Date.now()));
  state.reactionCooldownMs = featureLimiter?.remaining(`${state.self.userId}:room-engagement`) || 0;

  bus.emit('state', state);
}

function isBlacklisted(user) {
  if (!getSettings().blacklistAutoModEnabled) return false;
  const list = getList('blacklist');
  const name = `${user.name || ''} ${user.username || ''}`.toLowerCase();
  return list.some((entry) => name.includes(String(entry.value).toLowerCase()));
}

function isVip(user) {
  if (!getSettings().vipAutoInviteEnabled) return false;
  const list = getList('vip');
  const name = `${user.name || ''} ${user.username || ''}`.toLowerCase();
  return list.some((entry) => name.includes(String(entry.value).toLowerCase()));
}

function checkBlacklistJoinAlert(user) {
  const list = getList('blacklist');
  const name = `${user.name || ''} ${user.username || ''}`.toLowerCase();
  if (list.some((entry) => name.includes(String(entry.value).toLowerCase()))) {
    bus.emit('mod-alert', { type: 'blacklist-join', user });
  }
}

function reachedMaxMicTurns(userId) {
  const s = getSettings();
  if (!s.maxMicTurnsEnabled || s.maxMicTurns <= 0) return false;
  return (micTurnCounts.get(userId) || 0) >= s.maxMicTurns;
}

// أول واحد في الطابور لسه ماوصلش لحد مرات الصعود المسموحة (لو الميزة مفعّلة) - عشان نتخطى
// أي حد وصل لحده بدل ما نوقف الدور التلقائي كله.
function nextEligibleFromQueue(queue) {
  for (const u of queue) {
    if (!reachedMaxMicTurns(u.user_id)) return u;
  }
  return null;
}

function trackGhostMic(state, settingsNow) {
  const now = Date.now();
  for (const u of state.speakers) {
    if (u.is_moderator) continue;
    if (typeof u.is_speaking === 'boolean') {
      if (u.is_speaking) ghostMicLastActive.set(u.user_id, now);
    }
    const last = ghostMicLastActive.get(u.user_id) || now;
    const silentMinutes = (now - last) / 60000;
    if (silentMinutes >= settingsNow.ghostMicMinutes) {
      bus.emit('mod-alert', { type: 'ghost-mic', user: u, minutes: Math.round(silentMinutes) });
      ghostMicLastActive.set(u.user_id, now); // منكررش نفس التنبيه كل تيك
    }
  }
}

async function maybeEnforceCooldown(user) {
  try {
    await actions.lowerUser(currentChannel, user);
    appendAudit({ action: 'auto-cooldown-enforce', channel: currentChannel, targetId: user.user_id, targetName: user.name });
    bus.emit('auto-action', { type: 'cooldown-enforce', user });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'cooldown-enforce', user, error: err.message });
  }
}

async function maybeAutoBackupModerator(pool) {
  const list = getList('modbackup');
  if (!list.length) return;
  for (const entry of list) {
    const target = pool.find((u) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(String(entry.value).toLowerCase()));
    if (!target) continue;
    try {
      await actions.promoteModerator(currentChannel, target);
      appendAudit({ action: 'auto-backup-moderator', channel: currentChannel, targetId: target.user_id, targetName: target.name });
      bus.emit('auto-action', { type: 'backup-moderator', user: target });
    } catch (err) {
      bus.emit('auto-action-error', { type: 'backup-moderator', user: target, error: err.message });
    }
    return; // واحد بس يكفي
  }
}

async function maybeAutoFillVacantSeat() {
  const s = getSettings();
  if (s.speakerCapEnabled && s.speakerCap > 0 && (lastState.speakers || []).length >= s.speakerCap) return;
  const next = nextEligibleFromQueue(lastState.raiseQueue || []);
  if (!next) return;
  try {
    await actions.inviteUser(currentChannel, next);
    appendAudit({ action: 'auto-fill-vacant-seat', channel: currentChannel, targetId: next.user_id, targetName: next.name });
    bus.emit('auto-action', { type: 'fill-vacant-seat', user: next });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'fill-vacant-seat', user: next, error: err.message });
  }
}

async function maybeAutoMuteNewSpeaker(user) {
  try {
    await actions.muteUser(currentChannel, user);
    appendAudit({ action: 'auto-mute-new-speaker', channel: currentChannel, targetId: user.user_id, targetName: user.name });
    bus.emit('auto-action', { type: 'new-speaker', user });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'new-speaker', user, error: err.message });
  }
}

async function maybeAutoModerate(user, isSpeaker) {
  if (!isBlacklisted(user)) return;
  try {
    if (isSpeaker) {
      await actions.muteUser(currentChannel, user);
      await actions.lowerUser(currentChannel, user);
    }
    appendAudit({ action: 'auto-blacklist', channel: currentChannel, targetId: user.user_id, targetName: user.name });
    bus.emit('auto-action', { type: 'blacklist', user });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'blacklist', user, error: err.message });
  }
}

async function maybeAutoInvite(user) {
  if (!isVip(user)) return;
  if (reachedMaxMicTurns(user.user_id)) return; // وصل لحد أقصى مرات الصعود على المايك المسموح بيها
  const s = getSettings();
  if (s.speakerCapEnabled && s.speakerCap > 0 && (lastState.speakers || []).length >= s.speakerCap) return; // وصلنا لسقف عدد السبيكرز
  try {
    await actions.inviteUser(currentChannel, user);
    appendAudit({ action: 'auto-vip-invite', channel: currentChannel, targetId: user.user_id, targetName: user.name });
    bus.emit('auto-action', { type: 'vip', user });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'vip', user, error: err.message });
  }
}

async function maybeAutoInviteNewJoiner(user) {
  if (isBlacklisted(user)) return; // القايمة السودة أولوية أعلى من الدعوة التلقائية
  if (reachedMaxMicTurns(user.user_id)) return;
  try {
    await actions.inviteUser(currentChannel, user);
    appendAudit({ action: 'auto-invite-new-joiner', channel: currentChannel, targetId: user.user_id, targetName: user.name });
    bus.emit('auto-action', { type: 'new-joiner', user });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'new-joiner', user, error: err.message });
  }
}

async function maybeSendWelcomeReaction(user) {
  const epoch = generation;
  welcomeReactionBusy = true;
  try {
    await actions.sendReaction(currentChannel, user, `${user.name || user.username || 'صديق'} ❤️`);
    appendAudit({ action: 'auto-welcome-reaction', channel: currentChannel, targetId: user.user_id, targetName: user.name });
    bus.emit('auto-action', { type: 'welcome-reaction', user });
  } catch (err) {
    if (epoch !== generation) return;
    // 429 معناه Clubhouse قافل ميزة الرياكت مؤقتًا على الحساب - أي محاولة تانية دلوقتي هتترفض
    // برضه، فبنوقف كل الطابور لمدة تبريد بدل ما نضيّع باقي الأعضاء الجداد في محاولات فاشلة.
    if (err.status === 429) {
      welcomeReactionBackoffUntil = Date.now() + (err.retryAfterMs || 3 * 60 * 1000);
      welcomeReactionQueue = []; // لا تعاود الحملة المرفوضة تلقائيًا.
    }
    bus.emit('auto-action-error', { type: 'welcome-reaction', user, error: err.message });
  } finally { if (epoch === generation) welcomeReactionBusy = false; }
}

async function maybeThankRaisedHand(user) {
  try {
    await actions.sendReaction(currentChannel, user, '👋');
  } catch (err) {
    bus.emit('auto-action-error', { type: 'thank-raise', user, error: err.message });
  }
}

async function maybeEnforceTimeLimit(user) {
  try {
    await actions.lowerUser(currentChannel, user);
    appendAudit({ action: 'auto-time-limit', channel: currentChannel, targetId: user.user_id, targetName: user.name });
    bus.emit('auto-action', { type: 'time-limit', user });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'time-limit', user, error: err.message });
  }
}

async function maybeRotateNextTurn() {
  const next = nextEligibleFromQueue(lastState.raiseQueue || []);
  if (!next) return;
  try {
    await actions.inviteUser(currentChannel, next);
    appendAudit({ action: 'auto-turn-rotation', channel: currentChannel, targetId: next.user_id, targetName: next.name });
    bus.emit('auto-action', { type: 'turn-rotation', user: next });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'turn-rotation', user: next, error: err.message });
  }
}

async function maybeRotateTurnByTimer(speakers) {
  const nonModSpeakers = speakers.filter((u) => !u.is_moderator && u.time_joined_as_speaker);
  if (!nonModSpeakers.length) return maybeRotateNextTurn();
  const longest = nonModSpeakers.sort((a, b) => new Date(a.time_joined_as_speaker) - new Date(b.time_joined_as_speaker))[0];
  try {
    await actions.lowerUser(currentChannel, longest);
    appendAudit({ action: 'auto-turn-rotation-timer', channel: currentChannel, targetId: longest.user_id, targetName: longest.name });
    bus.emit('auto-action', { type: 'turn-rotation-timer', user: longest });
  } catch (err) {
    bus.emit('auto-action-error', { type: 'turn-rotation-timer', user: longest, error: err.message });
  }
  await maybeRotateNextTurn();
}

function updateArchiveSnapshot(state) {
  if (!archiveRecord) {
    archiveRecord = {
      channel: currentChannel,
      topic: state.topic,
      startedAt: new Date().toISOString().replace(/[:.]/g, '-'),
      startTime: new Date().toISOString(),
      attendees: {},
      peakListeners: 0,
      peakSpeakers: 0,
    };
  }
  for (const u of [...state.speakers, ...state.listeners]) {
    if (!archiveRecord.attendees[u.user_id]) {
      archiveRecord.attendees[u.user_id] = { name: u.name, username: u.username, firstSeen: new Date().toISOString() };
    }
  }
  archiveRecord.peakListeners = Math.max(archiveRecord.peakListeners, state.listeners.length);
  archiveRecord.peakSpeakers = Math.max(archiveRecord.peakSpeakers, state.speakers.length);

  const now = Date.now();
  if (now - lastArchiveSave > 30000) {
    lastArchiveSave = now;
    saveArchive(currentChannel, archiveRecord);
  }
}

function finishArchive() {
  if (archiveRecord) {
    archiveRecord.endTime = new Date().toISOString();
    saveArchive(currentChannel, archiveRecord);
    // Local archives do not imply a recording exists. Do not mutate a live room
    // or request a nonexistent replay merely because monitoring stopped.
    if (lastState.raw?.is_replay === true && lastState.raw?.can_save === true && !getSettings().serverReadOnlyMode) {
      apiPost('/save_replay', { channel: currentChannel }).catch((err) => bus.emit('auto-action-error', { type: 'save-replay', error: err.message }));
    }
  }
  archiveRecord = null;
}

function runDueSchedules() {
  if (getSettings().serverReadOnlyMode) return;
  const now = Date.now();
  for (const item of getSchedule()) {
    if (item.channel !== currentChannel) continue;
    if (new Date(item.at).getTime() > now) continue;
    executeScheduled(item);
    removeSchedule(item.id);
  }
}

async function executeScheduled(item) {
  try {
    if (item.type === 'mute-all') await actions.bulk(lastState.speakers || [], (u) => actions.muteUser(currentChannel, u));
    if (item.type === 'lower-all') await actions.bulk(lastState.speakers || [], (u) => actions.lowerUser(currentChannel, u));
    if (item.type === 'end-room') await apiPost('/end_channel', { channel: currentChannel });
    if (item.type === 'unlock-handraise') await actions.setHandraiseLock(currentChannel, false); // نهاية وضع الهدوء
    if (item.type === 'lock-handraise') await actions.setHandraiseLock(currentChannel, true);
    if (item.type === 'reaction-all') {
      const everyone = [...(lastState.speakers || []), ...(lastState.listeners || [])];
      await actions.bulk(everyone, (u) => actions.sendReaction(currentChannel, u, item.value || '🎉'));
    }
    appendAudit({ action: `scheduled:${item.type}`, channel: currentChannel });
    bus.emit('schedule-executed', item);
  } catch (err) {
    bus.emit('schedule-error', { item, error: err.message });
  }
}

async function pingPresence() {
  if (!currentChannel || presencePingInFlight) return;
  const channel = currentChannel;
  presencePingInFlight = true;
  try {
    const result = await actions.keepChannelAlive(channel);
    if (currentChannel === channel && result?.should_leave) {
      finishArchive();
      bus.emit('room-ended', { channel, reason: 'presence-ended' });
      stop();
    }
  } catch (err) {
    // get_channel remains the source of truth for disconnect detection. A single
    // heartbeat failure must not tear down an otherwise healthy room session.
    bus.emit('auto-action-error', { type: 'presence-ping', error: err.message });
  } finally {
    presencePingInFlight = false;
  }
}

function start(channel, { keepAlive = false } = {}) {
  if (currentChannel === channel && timer) {
    if (keepAlive && !presenceTimer) presenceTimer = setInterval(pingPresence, 20000);
    return;
  }
  stop();
  currentChannel = channel;
  lastSpeakerIds = new Set();
  lastListenerIds = new Set();
  lastRaiseIds = new Set();
  archiveRecord = null;
  lastArchiveSave = 0;
  consecutiveFailures = 0;
  lastTurnRotationAt = Date.now();
  micCooldownMap = new Map();
  micTurnCounts = new Map();
  ghostMicLastActive = new Map();
  lastNonEmptyQueue = [];
  capacityAlerted = false;
  loneModAlerted = false;
  welcomeReactionQueue = [];
  welcomeReactionBusy = false;
  welcomeReactionBackoffUntil = 0;
  tick();
  timer = setInterval(tick, 3000);
  if (keepAlive) presenceTimer = setInterval(pingPresence, 20000);
}

function stop() {
  generation++;
  queueRetryAt = 0;
  queueLastError = null;
  require('./operationManager').cancelAllOperations();
  if (timer) clearInterval(timer);
  if (presenceTimer) clearInterval(presenceTimer);
  timer = null;
  presenceTimer = null;
  presencePingInFlight = false;
  if (currentChannel) finishArchive();
  currentChannel = null;
  lastState = { connected: false };
  bus.emit('reset', { context: generation });
  bus.emit('state', lastState);
}

function getState() {
  return lastState;
}

function getChannel() {
  return currentChannel;
}

// نسخة احتياطية من آخر طابور غير فاضي - تستخدم لاسترجاع/دعوة اللي كانوا فيه لو الطابور اتقفل فجأة
function getQueueBackup() {
  return lastNonEmptyQueue;
}

module.exports = { start, stop, getState, getChannel, getQueueBackup, bus, getContext: () => generation };
