'use strict';

const { randomUUID } = require('crypto');
const { createChatReceipts } = require('./chatReceipts');
const DEFAULT_TEMPLATE = 'ازيك يا {الاسم} منورنا ❤️';
const fail = (status, message) => Object.assign(new Error(message), { status, stopOperation: true });
const uniqueUsers = (users) => [...new Map(users.filter((u) => u?.user_id != null).map((u) => [String(u.user_id), u])).values()];

function validateTemplate(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 800 || !/\{(الاسم|name)\}/.test(value)) {
    throw fail(400, 'اكتب قالبًا حتى 800 حرف وفيه {الاسم} مكان اسم الشخص');
  }
  return value.trim();
}
function welcomeText(template, user) {
  return template.replace(/\{(الاسم|name)\}/g, () => String(user.name || user.username || user.user_id));
}
function normalizeMessage(m, member = {}) {
  const user = m.user_profile || m.user || m.sender || {};
  return {
    id: String(m.message_id ?? m.id ?? ''),
    text: String(m.message ?? m.message_body ?? ''),
    userId: String(m.user_id ?? user.user_id ?? ''),
    name: String(m.name ?? user.name ?? m.username ?? user.username ?? 'عضو'),
    username: String(m.username ?? user.username ?? member.username ?? ''),
    time: m.time_created ?? m.created_at ?? null,
    deleted: !!(m.is_deleted || m.deleted),
    likes: Number.isFinite(m.like_count) ? m.like_count : (Number.isFinite(m.num_likes) ? m.num_likes : 0),
    liked: m.viewer_has_liked === true,
  };
}

function createRoomChat({ getRoom, getGeneration, getProfile, getSettings, setSetting, apiGet, apiPost, operations, appendAudit = () => {}, emit = () => {}, now = Date.now, receipts = createChatReceipts({ now }) }) {
  let context = randomUUID(), generation, profile, channel;
  let seen = null, pending = [], autoBusy = false, manualId = null, autoError = null;
  let greeted = new Map();
  let reads = new Map();
  function reset() {
    if (manualId) operations.cancelOperation(manualId);
    context = randomUUID(); generation = getGeneration(); profile = getProfile(); channel = getRoom().channel;
    seen = null; pending = []; greeted = new Map(); reads = new Map(); manualId = null; autoError = null;
  }
  function sync() {
    if (generation !== getGeneration() || profile !== getProfile() || channel !== getRoom().channel) reset();
  }
  function users() { const r = getRoom(); return uniqueUsers([...(r.speakers || []), ...(r.listeners || [])]); }
  function settings() {
    const s = getSettings();
    return { autoWelcome: !!s.roomChatAutoWelcome, template: s.roomChatWelcomeTemplate || DEFAULT_TEMPLATE };
  }
  function status() {
    sync();
    const r = getRoom(), s = getSettings();
    const connected = !!r.connected;
    const canAct = connected && !!r.self?.isInRoom && !s.serverReadOnlyMode;
    const canSend = canAct && r.raw?.is_chat_enabled !== false && r.capabilities?.can_post_to_chat !== false;
    return {
      context, channel: r.channel || null, topic: r.topic || '', connected,
      chatEnabled: r.raw?.is_chat_enabled !== false,
      canSend, canDelete: canAct && !!r.self?.isModerator,
      canLike: canAct && r.raw?.is_room_chat_available !== false, mentionMode: 'username',
      limitation: 'المنشن يُرسل بصيغة @اسم المستخدم كما في التطبيق؛ وصول إشعار للطرف الآخر يعتمد على Clubhouse.',
      members: users().map((u) => ({ user_id: u.user_id, name: u.name || u.username || String(u.user_id), username: u.username || '', is_moderator: !!u.is_moderator })),
      settings: settings(), autoPending: pending.length, autoError,
      operation: manualId ? operations.getOperation(manualId) : null,
    };
  }
  function assertContext(expected, write = false, moderator = false) {
    const s = status();
    if (!expected || expected !== context || !s.connected) throw fail(409, 'اتغير اتصال الغرفة؛ حدّث الشات وحاول تاني');
    if (write && !s.canSend) throw fail(403, 'الإرسال غير متاح: تأكد من الانضمام وفتح الشات وإيقاف وضع القراءة فقط');
    if (moderator && !s.canDelete) throw fail(403, 'حذف الرسائل متاح للمودريتور فقط');
    return s;
  }
  async function messages(expected, cursor) {
    const s = assertContext(expected);
    if (cursor != null && (typeof cursor !== 'string' || cursor.length > 1024)) throw fail(400, 'مؤشر الرسائل غير صالح');
    const key = cursor || 'latest', cached = reads.get(key);
    if (cached && now() < cached.expires) return cached.promise;
    const request = (async () => {
      const query = { channel: s.channel, is_chronological_order: 0 };
      if (cursor) query.next_cursor = cursor;
      const result = await apiGet('/get_channel_messages', query, profile);
      assertContext(expected);
      if (result.success === false) throw fail(502, result.error_message || 'تعذر تحميل الشات');
      if (!Array.isArray(result.messages)) throw fail(502, 'رد شات الغرفة غير متوقع؛ راجع سجل العمليات');
      const accountId = profile?.userId || profile?.user?.user_id;
      for (const raw of result.messages) {
        const m = normalizeMessage(raw);
        if (m.userId === String(accountId) && m.text) receipts.remember(accountId, s.channel, m.text, Date.parse(m.time));
      }
      const members = new Map(users().map((u) => [String(u.user_id), u]));
      return { context: expected, messages: result.messages.map((m) => normalizeMessage(m, members.get(String(m.user_id ?? m.user_profile?.user_id ?? m.user?.user_id)))).filter((m) => m.id), nextCursor: result.next_cursor == null ? null : String(result.next_cursor), total: result.num_messages ?? null };
    })();
    // Coalesce concurrent tabs; failed requests also cool down instead of looping.
    const entry = { promise: request, expires: now() + 3000 };
    reads.set(key, entry);
    request.catch((error) => { entry.expires = now() + (error.retryAfterMs || ([400, 403, 404].includes(error.status) ? 60000 : 10000)); });
    if (reads.size > 100) reads.delete(reads.keys().next().value);
    return request;
  }
  async function send(expected, text, validate = () => {}, { welcome = false } = {}) {
    const s = assertContext(expected, true);
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw fail(400, 'اكتب رسالة بين 1 و1000 حرف');
    text = text.trim();
    const accountId = profile?.userId || profile?.user?.user_id;
    let result;
    try {
      const check = () => {
        assertContext(expected, true); validate();
        if (welcome && receipts.has(accountId, s.channel, text)) throw Object.assign(fail(409, 'سبق إرسال نفس الترحيب'), { duplicate: true });
      };
      check();
      result = await apiPost('/send_channel_message', { channel: s.channel, message: text }, profile, check);
      if (result.success !== true) throw Object.assign(fail(502, result.error_message || 'Clubhouse لم يؤكد إرسال الرسالة'), { body: result });
    } catch (error) {
      const duplicate = error.duplicate || /looks like that's been said already/i.test(error.body?.error_message || error.message || '');
      if (duplicate) {
        receipts.remember(accountId, s.channel, text);
        if (welcome) return { skipped: true, reason: 'duplicate', message: 'تم تخطي ترحيب سبق إرساله بنفس النص' };
        throw fail(409, 'سبق إرسال نفس الرسالة؛ Clubhouse يمنع تكرارها. راجع الشات قبل الإرسال مرة أخرى');
      }
      // Do not continue a welcome batch on auth, network or unknown rejections.
      if (welcome) error.stopOperation = true;
      throw error;
    }
    receipts.remember(accountId, s.channel, text);
    if (context === expected) reads.delete('latest');
    appendAudit({ action: 'room-chat-send', channel: s.channel });
    emit('room-chat-changed', { context: expected });
    return { ok: true, result };
  }
  async function remove(expected, id) {
    const s = assertContext(expected, false, true);
    if (typeof id !== 'string' || !id || id.length > 200) throw fail(400, 'معرف الرسالة غير صالح');
    const result = await apiPost('/delete_channel_message', { channel: s.channel, message_id: id }, profile);
    if (result.success !== true) throw fail(502, result.error_message || 'Clubhouse لم يؤكد حذف الرسالة');
    if (context === expected) reads.clear();
    appendAudit({ action: 'room-chat-delete', channel: s.channel, messageId: id });
    emit('room-chat-deleted', { context: expected, id });
    return { ok: true };
  }
  async function like(expected, id, liked) {
    const validate = () => {
      const s = assertContext(expected);
      if (!s.canLike) throw fail(403, 'التفاعل غير متاح: تأكد من انضمام الحساب وإيقاف وضع القراءة فقط');
      return s;
    };
    const s = validate();
    if (typeof id !== 'string' || !id || id.length > 200 || typeof liked !== 'boolean') throw fail(400, 'معرف الرسالة أو حالة اللايك غير صالحة');
    // Both endpoints and fields were verified in the user's Test room on 2026-09-13.
    const result = await apiPost(liked ? '/like_channel_message' : '/unlike_channel_message', { channel: s.channel, message_id: id }, profile, validate);
    if (result.success !== true) throw fail(502, result.error_message || 'Clubhouse لم يؤكد تغيير اللايك');
    if (context === expected) reads.clear();
    emit('room-chat-liked', { context: expected, id, liked });
    return { ok: true, liked };
  }
  function updateSettings(body) {
    if (body.template !== undefined) validateTemplate(body.template);
    if (body.autoWelcome !== undefined && typeof body.autoWelcome !== 'boolean') throw fail(400, 'خيار الترحيب غير صالح');
    if (body.template !== undefined) setSetting('roomChatWelcomeTemplate', validateTemplate(body.template));
    if (body.autoWelcome !== undefined) {
      setSetting('roomChatAutoWelcome', body.autoWelcome);
      pending = []; autoError = null;
      seen = new Set(users().map((u) => String(u.user_id)));
    }
    return settings();
  }
  function welcome(expected, scope) {
    assertContext(expected, true);
    if (!['all', 'moderators'].includes(scope)) throw fail(400, 'نوع الترحيب غير صالح');
    if (manualId && operations.getOperation(manualId)?.status === 'running') throw fail(409, 'في ترحيب شغال؛ استنى نهايته أو الغيه');
    const targets = users().filter((u) => scope === 'all' || u.is_moderator);
    if (!targets.length) throw fail(400, 'مفيش أشخاص مطابقين في الغرفة');
    const template = validateTemplate(settings().template);
    // One history read per batch seeds receipts from pre-upgrade messages.
    let history;
    pending = pending.filter((id) => !targets.some((u) => String(u.user_id) === id));
    const operation = operations.createOperation({
      kind: 'room-chat-welcome', label: scope === 'all' ? 'ترحيب بالكل في الشات' : 'ترحيب بالمودريتورز في الشات',
      intervalMs: 5000, metadata: { channel, context: expected, scope },
      items: targets.map((u) => ({ key: String(u.user_id), userId: u.user_id })),
      worker: async (item) => {
        assertContext(expected, true);
        if (operations.getOperation(manualId)?.cancelled) throw fail(409, 'تم إلغاء الترحيب');
        try { await (history ||= messages(expected)); }
        catch (error) { error.stopOperation = true; throw error; }
        assertContext(expected, true);
        const user = users().find((u) => String(u.user_id) === item.key);
        if (!user || (scope === 'moderators' && !user.is_moderator)) return { skipped: true };
        const result = await send(expected, welcomeText(template, user), () => {
          if (operations.getOperation(manualId)?.cancelled) throw fail(409, 'تم إلغاء الترحيب');
          const latest = users().find((u) => String(u.user_id) === item.key);
          if (!latest || (scope === 'moderators' && !latest.is_moderator)) throw fail(409, 'تغير الحضور أو صلاحية المستهدف؛ أعد بدء الترحيب');
        }, { welcome: true });
        if (context === expected) greeted.set(item.key, now());
        return result;
      },
    });
    manualId = operation.id;
    return operation;
  }
  function update() {
    const s = status();
    if (!s.connected) { pending = []; seen = null; return; }
    const current = new Set(users().map((u) => String(u.user_id)));
    if (seen && settings().autoWelcome && s.canSend && !autoError) {
      for (const id of current) {
        if (!seen.has(id) && !pending.includes(id) && (!greeted.has(id) || now() - greeted.get(id) > 600000)) pending.push(id);
      }
    }
    seen = current;
    pending = settings().autoWelcome ? pending.filter((id) => current.has(id)) : [];
    if (autoBusy || !pending.length || !s.canSend || autoError || operations.getOperation(manualId)?.status === 'running') return;
    const id = pending.shift(), user = users().find((u) => String(u.user_id) === id), expected = context;
    if (!user) return;
    autoBusy = true;
    void send(expected, welcomeText(settings().template, user), () => {
      if (!settings().autoWelcome || !users().some((u) => String(u.user_id) === id)) throw fail(409, 'اتوقف الترحيب أو غادر الشخص الغرفة');
    }, { welcome: true }).then(() => {
      if (context === expected) greeted.set(id, now());
    }).catch((error) => {
      if (context !== expected) return;
      pending = [];
      autoError = `${error.message} — راجع السبب ثم أعد تفعيل الترحيب التلقائي`;
      emit('room-chat-auto-error', { context: expected, error: autoError });
    }).finally(() => { autoBusy = false; });
  }
  return { status, messages, send, remove, like, welcome, update, reset, updateSettings };
}

module.exports = { createRoomChat, normalizeMessage, validateTemplate, welcomeText, DEFAULT_TEMPLATE, uniqueUsers };
