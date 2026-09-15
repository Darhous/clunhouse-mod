const $ = (id) => document.getElementById(id);
const defaultTemplate = 'ازيك يا {الاسم} منورنا ❤️';
let status = null, active = false, busy = false, sending = false, dirty = false, revision = 0;
let nextCursor = null, nextRetryAt = 0, latestIds = new Set(), operation = null;
const messages = new Map();

function notice(text, error = false) {
  $('roomChatNotice').textContent = text;
  $('roomChatNotice').dataset.error = String(error);
}
async function request(path, body) {
  const response = await fetch(`/api${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, retryAfterMs: data.retryAfterMs });
  return data;
}
function resetMessages() {
  revision++; messages.clear(); latestIds.clear(); nextCursor = null; nextRetryAt = 0;
  $('roomChatMessages').replaceChildren(); $('roomChatOlder').hidden = true; $('roomChatBottom').hidden = true;
  $('roomChatEmpty').hidden = false; $('roomChatEmpty').textContent = 'جاري تجهيز شات الغرفة…';
  $('roomChatMessage').value = ''; updateChars();
  operation = null; renderOperation();
}
function updateChars() { $('roomChatChars').textContent = `${$('roomChatMessage').value.length} / 1000`; }
function preview() {
  $('roomChatPreview').textContent = $('roomChatTemplate').value.replace(/\{(الاسم|name)\}/g, 'أحمد');
}
function renderControls() {
  const ready = !!status?.canSend;
  $('roomChatSend').disabled = !ready || sending;
  $('roomChatMessage').disabled = !ready;
  $('roomChatMention').disabled = !ready;
  $('roomChatWelcomeAll').disabled = !ready || operation?.status === 'running';
  $('roomChatWelcomeMods').disabled = !ready || operation?.status === 'running' || !status.members.some((u) => u.is_moderator);
  $('roomChatTopic').textContent = status?.connected ? (status.topic || status.channel) : 'اختار غرفة علشان تعرض الشات';
  $('roomChatConnection').textContent = !status?.connected ? 'غير متصل' : !status.chatEnabled ? 'الشات مقفول' : ready ? 'متصل' : 'عرض فقط';
  const count = status?.members.length || 0, mods = status?.members.filter((u) => u.is_moderator).length || 0;
  $('roomChatAudience').textContent = status?.connected ? `${count} شخص متاح في قائمة الحضور · ${mods} مودريتور` : 'مفيش غرفة متصلة';
  $('roomChatSend').textContent = sending ? 'جاري الإرسال…' : 'إرسال';
  $('roomChatMessages').querySelectorAll('[data-action="delete"]').forEach((b) => { b.hidden = !status?.canDelete; });
  $('roomChatMessages').querySelectorAll('[data-action="mention"]').forEach((b) => { b.disabled = !ready; });
  $('roomChatMessages').querySelectorAll('[data-action="like"]').forEach((b) => { b.disabled = !status?.canLike || b.dataset.pending === 'true'; });
}
function applyStatus(value) {
  if (status?.context !== value.context) resetMessages();
  status = value;
  if (!dirty) {
    $('roomChatTemplate').value = value.settings.template;
    $('roomChatAutoWelcome').checked = value.settings.autoWelcome;
    preview();
  }
  const memberSignature = JSON.stringify(value.members);
  if ($('roomChatMention').dataset.members !== memberSignature) {
    const select = $('roomChatMention'), choice = select.value;
    select.replaceChildren(new Option('@ منشن لشخص', ''));
    value.members.forEach((u) => select.add(new Option(`${u.name}${u.is_moderator ? ' · مودريتور' : ''}`, String(u.user_id))));
    select.value = choice; select.dataset.members = memberSignature;
  }
  operation = value.operation;
  renderControls(); renderOperation();
  if (value.autoError) notice(value.autoError, true);
  if (!value.connected) {
    $('roomChatEmpty').hidden = false;
    $('roomChatEmpty').textContent = 'اختار غرفة من الغرف المباشرة أو التحكم السريع. الرسائل هتظهر هنا.';
  }
}
function timestamp(message) { return Date.parse(message.time) || 0; }
function compareMessages(a, b) {
  const timeDiff = timestamp(a) - timestamp(b);
  if (timeDiff) return timeDiff;
  if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) return BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0;
  return a.id.localeCompare(b.id);
}
function renderMessages() {
  const list = $('roomChatMessages');
  const rows = new Map([...list.children].map((node) => [node.dataset.id, node]));
  const ordered = [...messages.values()].filter((m) => !m.deleted).sort(compareMessages);
  for (const [index, message] of ordered.entries()) {
    let row = rows.get(message.id);
    if (!row) {
      row = document.createElement('article'); row.className = 'room-chat-message'; row.dataset.id = message.id;
      const head = document.createElement('header'), author = document.createElement('strong'), time = document.createElement('time'), body = document.createElement('p'), actions = document.createElement('div');
      actions.className = 'room-chat-message-actions'; head.append(author, time); row.append(head, body, actions);
      for (const [action, label] of [['like', '♡ لايك'], ['mention', '@ منشن'], ['delete', 'حذف']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn--ghost'; button.dataset.action = action; button.textContent = label;
        actions.append(button);
      }
    }
    const signature = JSON.stringify(message);
    if (row.dataset.signature !== signature) {
      row.querySelector('strong').textContent = message.name;
      row.querySelector('p').textContent = message.text;
      const time = row.querySelector('time'), date = timestamp(message);
      time.textContent = date ? new Date(date).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '';
      if (date) time.dateTime = new Date(date).toISOString();
      row.dataset.signature = signature;
      const like = row.querySelector('[data-action="like"]');
      like.textContent = `${message.liked ? '♥' : '♡'} ${message.likes || 0}`;
      like.setAttribute('aria-pressed', String(!!message.liked));
      like.setAttribute('aria-label', message.liked ? 'إلغاء اللايك' : 'إعجاب بالرسالة');
      like.title = message.liked ? 'إلغاء اللايك' : 'إعجاب بالرسالة';
    }
    // insertBefore only when ordering changes: retain focus on existing buttons.
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    rows.delete(message.id);
  }
  rows.forEach((node) => node.remove());
  $('roomChatEmpty').hidden = list.childElementCount > 0;
  if (!list.childElementCount && status?.connected) $('roomChatEmpty').textContent = 'لسه مفيش رسائل متاحة في شات الغرفة.';
  $('roomChatCount').textContent = `${list.childElementCount} رسالة محمّلة`;
  $('roomChatOlder').hidden = !nextCursor;
  renderControls();
}
async function loadMessages(older = false) {
  if (!status?.connected || (older && !nextCursor)) return;
  const expected = status.context, currentRevision = revision, cursor = older ? nextCursor : null;
  const data = await request(`/room-chat/messages?context=${encodeURIComponent(expected)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  if (currentRevision !== revision || data.context !== status?.context) return;
  const scroll = $('roomChatScroll'), nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 70;
  const oldHeight = scroll.scrollHeight, oldTop = scroll.scrollTop, wasEmpty = !messages.size;
  if (!older) {
    const ids = new Set(data.messages.map((m) => m.id));
    const boundary = Math.min(...data.messages.map(timestamp).filter(Boolean));
    if (data.nextCursor == null) {
      // A complete newest page is authoritative for the whole room, including
      // deletions at the oldest edge (whose timestamp falls below boundary).
      for (const id of messages.keys()) if (!ids.has(id)) messages.delete(id);
      nextCursor = null;
    }
    // Reconcile deletions in the refreshed window without dropping older pages.
    for (const id of latestIds) if (!ids.has(id) && (!data.messages.length || (timestamp(messages.get(id) || {}) >= boundary))) messages.delete(id);
    latestIds = ids;
  }
  data.messages.forEach((m) => m.deleted ? messages.delete(m.id) : messages.set(m.id, m));
  if (older || wasEmpty) nextCursor = data.nextCursor && data.nextCursor !== cursor ? data.nextCursor : null;
  renderMessages();
  if (older) scroll.scrollTop = oldTop + scroll.scrollHeight - oldHeight;
  else if (wasEmpty || nearBottom) scroll.scrollTop = scroll.scrollHeight;
  else $('roomChatBottom').hidden = false;
}
async function refresh({ force = false, older = false } = {}) {
  if (busy || (!force && (!active || document.hidden))) return;
  busy = true; $('roomChatRefresh').disabled = true; $('roomChatOlder').disabled = true;
  try {
    const before = revision;
    const value = await request('/room-chat');
    if (before !== revision) return;
    applyStatus(value);
    if (force || Date.now() >= nextRetryAt) await loadMessages(older);
  } catch (error) {
    nextRetryAt = Date.now() + (error.retryAfterMs || ([400, 403, 404].includes(error.status) ? 60000 : 10000));
    notice(error.message, true);
    if (!messages.size) $('roomChatEmpty').textContent = 'تعذر تحميل الشات. التفاصيل موضحة أسفل التاب.';
  } finally { busy = false; $('roomChatRefresh').disabled = false; $('roomChatOlder').disabled = false; }
}
function insertMention(user) {
  if (!user || !status?.canSend) return;
  if (!user.username) return notice('اسم المستخدم مش متاح للشخص ده حاليًا؛ اختاره من قائمة الحضور أو اكتب @اسم_المستخدم بنفسك', true);
  const field = $('roomChatMessage'), text = `@${user.username} `;
  if (field.value.length - (field.selectionEnd - field.selectionStart) + text.length > 1000) return notice('الرسالة وصلت للحد الأقصى', true);
  field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end'); field.focus(); updateChars();
}
function renderOperation() {
  $('roomChatOperation').hidden = !operation;
  if (!operation) return;
  const labels = { running: 'جاري الترحيب', completed: 'اكتمل الترحيب', cancelled: 'اتلغى باقي الترحيب', failed: 'توقف الترحيب', partial: 'توقف بعد إرسال جزء' };
  $('roomChatProgress').textContent = `${labels[operation.status] || operation.status} · ${operation.succeeded} من ${operation.total} اتبعت${operation.skipped ? ` · ${operation.skipped} تم تخطيه (مكرر أو لم يعد ضمن المستهدفين)` : ''}${operation.failed ? ` · ${operation.failed} فشل` : ''}${operation.stopReason ? ` — ${operation.stopReason}` : ''}`;
  $('roomChatProgressBar').max = operation.total || 1; $('roomChatProgressBar').value = operation.completed;
  $('roomChatCancel').hidden = operation.status !== 'running';
  $('roomChatCancel').disabled = !!operation.cancelled;
  renderControls();
}
$('roomChatSendForm').addEventListener('submit', async (event) => {
  event.preventDefault(); if (sending || !status?.canSend) return;
  const message = $('roomChatMessage').value, expected = status.context;
  if (!message.trim()) return;
  sending = true; renderControls(); notice('جاري إرسال الرسالة…');
  try {
    await request('/room-chat/send', { context: expected, message });
    if (expected !== status?.context) return;
    if ($('roomChatMessage').value === message) { $('roomChatMessage').value = ''; updateChars(); }
    notice('اترسلت الرسالة في شات الغرفة'); await refresh({ force: true });
  } catch (error) {
    if (expected === status?.context) notice(`${error.message} — النص محفوظ. لو حصل انقطاع اتصال، حدّث الشات قبل إعادة الإرسال لتجنب التكرار.`, true);
  } finally { sending = false; renderControls(); }
});
$('roomChatMessage').addEventListener('input', updateChars);
$('roomChatMessage').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('roomChatSendForm').requestSubmit(); }
});
$('roomChatMention').addEventListener('change', (event) => {
  insertMention(status?.members.find((u) => String(u.user_id) === event.target.value)); event.target.value = '';
});
$('roomChatMessages').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]'), row = button?.closest('[data-id]'), message = row && messages.get(row.dataset.id);
  if (!message || button.disabled) return;
  if (button.dataset.action === 'mention') return insertMention(message);
  if (button.dataset.action === 'like') {
    const expected = status.context, liked = !message.liked;
    button.dataset.pending = 'true'; button.disabled = true;
    try {
      await request('/room-chat/like', { context: expected, messageId: message.id, liked });
      if (expected === status?.context) { updateLike(message.id, liked); notice(liked ? 'اتعمل لايك للرسالة' : 'اتلغى اللايك'); }
    } catch (error) { notice(error.message, true); }
    finally { delete button.dataset.pending; renderControls(); }
    return;
  }
  if (button.dataset.action !== 'delete' || !status?.canDelete) return;
  if (!window.confirm(`حذف رسالة ${message.name} من شات الغرفة؟`)) return;
  const expected = status.context; button.disabled = true;
  try {
    await request('/room-chat/delete', { context: expected, messageId: message.id });
    if (expected === status?.context) { messages.delete(message.id); renderMessages(); notice('اتحذفت الرسالة'); }
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
$('roomChatTemplate').addEventListener('input', () => { dirty = true; preview(); });
$('roomChatAutoWelcome').addEventListener('change', () => { dirty = true; });
$('roomChatDefault').addEventListener('click', () => { $('roomChatTemplate').value = defaultTemplate; dirty = true; preview(); });
$('roomChatSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('roomChatSave').disabled = true;
  try {
    await request('/room-chat/settings', { template: $('roomChatTemplate').value, autoWelcome: $('roomChatAutoWelcome').checked });
    dirty = false; notice('اتحفظ نص الترحيب وخيار الترحيب التلقائي'); await refresh({ force: true });
  } catch (error) { notice(error.message, true); }
  finally { $('roomChatSave').disabled = false; }
});
async function welcome(scope) {
  if (!status?.canSend || operation?.status === 'running') return;
  if (dirty) return notice('احفظ تعديلات نص الترحيب الأول', true);
  const expected = status.context;
  $('roomChatWelcomeAll').disabled = true; $('roomChatWelcomeMods').disabled = true;
  try {
    const result = await request('/room-chat/welcome', { context: expected, scope });
    if (expected === status?.context) { operation = result.operation; renderOperation(); notice('بدأ إرسال الترحيب، رسالة مستقلة لكل شخص'); }
  } catch (error) { notice(error.message, true); }
  finally { renderControls(); }
}
$('roomChatWelcomeAll').addEventListener('click', () => welcome('all'));
$('roomChatWelcomeMods').addEventListener('click', () => welcome('moderators'));
$('roomChatCancel').addEventListener('click', async () => {
  if (!operation) return;
  try { await request(`/operations/${encodeURIComponent(operation.id)}/cancel`, {}); notice('تم طلب الإلغاء. الطلب الجاري قد يكون وصل بالفعل؛ لن يبدأ إرسال جديد.'); await refresh({ force: true }); }
  catch (error) { notice(error.message, true); }
});
$('roomChatRefresh').addEventListener('click', () => refresh({ force: true }));
$('roomChatOlder').addEventListener('click', () => refresh({ force: true, older: true }));
$('roomChatBottom').addEventListener('click', () => { $('roomChatScroll').scrollTop = $('roomChatScroll').scrollHeight; $('roomChatBottom').hidden = true; });
window.addEventListener('modpanel:workspace', (event) => { active = event.detail.name === 'roomchat'; if (active) void refresh(); });
window.addEventListener('modpanel:room-state', (event) => {
  if (!event.detail.connected || (status?.channel && event.detail.channel !== status.channel)) {
    resetMessages(); status = null; renderControls();
  }
  if (active) void refresh();
});
window.addEventListener('modpanel:operation', (event) => {
  if (event.detail.kind !== 'room-chat-welcome' || event.detail.metadata?.context !== status?.context) return;
  operation = event.detail; renderOperation();
});
window.addEventListener('modpanel:room-chat-deleted', (event) => {
  if (event.detail.context !== status?.context) return;
  messages.delete(event.detail.id); renderMessages();
});
window.addEventListener('modpanel:room-chat-changed', (event) => { if (event.detail.context === status?.context && active) void refresh(); });
function updateLike(id, liked) {
  const message = messages.get(id);
  if (!message || message.liked === liked) return;
  message.likes = Math.max(0, (message.likes || 0) + (liked ? 1 : -1)); message.liked = liked;
  renderMessages();
}
window.addEventListener('modpanel:room-chat-liked', (event) => { if (event.detail.context === status?.context) updateLike(event.detail.id, event.detail.liked); });
window.addEventListener('modpanel:room-chat-auto-error', (event) => { if (event.detail.context === status?.context) notice(event.detail.error, true); });
document.addEventListener('visibilitychange', () => { if (active && !document.hidden) void refresh(); });
setInterval(() => { if (active && !document.hidden) void refresh(); }, 3500);
active = $('tab-roomchat').classList.contains('active');
if (active) void refresh();
