'use strict';

const EMOJIS = [
  '👏','😂','❤️','🔥','🎉','👍','😮','😢','🙌','💯','🤝','⭐',
  '😍','🥳','😅','😎','🤔','😴','👀','💀','😭','🙏','👌','✌️',
  '💪','😡','🤯','😱','🥰','😏','🤣','😳','🫡','🤩','😬','🫶',
  '👋','🙌🏽','💔','✨','🎊','🎶','🎤','🔊','📣','⚡','💥','🌟',
  '☕','🍿','🍾','🎂','🏆','💡','⏰','📌','✅','❌','❓','❗',
];
const FIFTY_HEARTS_REACTION = Array.from({ length: 50 }, () => '❤️').join(' ');
const EMOJI_COMBO_SIDE = 10;
const COMBO_PRESET_EMOJIS = ['🔥', '❤️', '💀', '❌', '💥', '⚡', '💯', '👏', '🎉', '🫶'];

function buildEmojiCombo(emoji) {
  const row = Array.from({ length: EMOJI_COMBO_SIDE }, () => emoji).join(' ');
  return Array.from({ length: EMOJI_COMBO_SIDE }, () => row).join('\n');
}

const el = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
function clearNode(node) { if (node) node.replaceChildren(); return node; }
const SAFE_HTML_TAGS = new Set(['DIV', 'SPAN', 'P', 'SMALL', 'B', 'STRONG', 'EM', 'IMG', 'BUTTON', 'INPUT', 'LABEL', 'UL', 'LI', 'BR', 'H3', 'H4', 'FORM', 'TABLE', 'TBODY', 'TR', 'TD', 'SECTION', 'HR']);
const SAFE_HTML_ATTRIBUTES = new Set(['class', 'id', 'title', 'alt', 'src', 'type', 'value', 'hidden', 'style', 'dir', 'role', 'tabindex', 'placeholder', 'name', 'autocomplete', 'spellcheck', 'disabled', 'checked']);
function setSafeHTML(node, html) {
  if (!node) return null;
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  for (const element of [...template.content.querySelectorAll('*')]) {
    if (!SAFE_HTML_TAGS.has(element.tagName)) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const allowed = SAFE_HTML_ATTRIBUTES.has(name) || name.startsWith('aria-') || name.startsWith('data-');
      if (!allowed || name.startsWith('on')) { element.removeAttribute(attribute.name); continue; }
      if (name === 'src' && !/^(https:\/\/|data:image\/|\/)/i.test(attribute.value)) element.removeAttribute(attribute.name);
      if (name === 'style' && /(url\s*\(|expression\s*\(|javascript:|@import)/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
  }
  node.replaceChildren(template.content);
  return node;
}
function uiIcon(name, className = 'ui-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const use = document.createElementNS(SVG_NS, 'use');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  use.setAttribute('href', `/icons.svg#i-${name}`);
  svg.appendChild(use);
  return svg;
}
function setButtonIconLabel(button, icon, label, { iconOnly = false } = {}) {
  if (!button) return;
  button.replaceChildren(uiIcon(icon));
  if (!iconOnly) button.appendChild(document.createTextNode(label));
  if (iconOnly) button.setAttribute('aria-label', label);
}
async function confirmAction(options) {
  if (window.ModPanelUI?.confirmAction) return window.ModPanelUI.confirmAction(options);
  toast('تعذّر فتح حوار التأكيد الآمن؛ لم يتم تنفيذ الإجراء', 'err');
  return false;
}
async function inputAction(options) {
  if (window.ModPanelUI?.inputAction) return window.ModPanelUI.inputAction(options);
  toast('تعذّر فتح حوار الإدخال الآمن', 'err');
  return null;
}
const state = {
  channel: null, lastState: null, history: [], currentReactionUser: null, presets: [],
  selectedUsers: new Map(), connectedAt: null, peakAll: 0, myRole: null, capabilities: {}, activeWorkspace: 'hallway',
  inspectedMemberId: null, platformEndpoints: [], operationPreview: null, activeOperationId: null,
  quickReactionsInFlight: new Set(),
  emojiComboMode: false,
};

// ---------------- تبويبات ----------------
function switchTab(name) {
  state.activeWorkspace = name;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  syncPollingActivity();
  window.dispatchEvent(new CustomEvent('modpanel:workspace', { detail: { name } }));
}
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

// ---------------- API helper ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status, retryAfterMs: json.retryAfterMs });
  return json;
}

function toast(msg, kind = '') {
  const cleanMessage = String(msg).replace(/^\s*[\p{Extended_Pictographic}\uFE0F\u200D✕]+\s*/u, '');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = cleanMessage;
  t.title = 'دوس عشان تثبته (يوقف الاختفاء التلقائي)';
  el('toastStack').appendChild(t);
  const duration = (Number(localStorage.getItem('toastDuration')) || 4) * 1000;
  let dismissTimer = setTimeout(() => t.remove(), duration);
  t.addEventListener('click', () => {
    if (t.classList.toggle('pinned')) {
      clearTimeout(dismissTimer);
    } else {
      dismissTimer = setTimeout(() => t.remove(), duration);
    }
  });
  (state.toastHistory || (state.toastHistory = [])).unshift({ text: cleanMessage, kind, time: Date.now() });
  bumpNotifUnread();
}

// عداد "غير مقروء" على جرس الإشعارات — بيتصفّر لما المستخدم يفتح الدرج بنفسه
function bumpNotifUnread() {
  const badge = el('notifUnreadBadge');
  if (!badge || el('historyDrawer')?.hidden === false) return;
  badge.hidden = false;
  badge.textContent = String((Number(badge.textContent) || 0) + 1);
}

// ---------------- حارس وضع القراءة فقط - نقطة واحدة كل الأكشنات الحقيقية بتتفحص فيها ----------------
function blockedByReadOnly() {
  if (state.readOnlyMode) {
    toast('وضع القراءة فقط شغال — افتحه من الإعدادات الأول عشان تقدر تنفّذ أكشن حقيقي', 'err');
    return true;
  }
  return false;
}

// ---------------- الحساب ----------------
async function loadProfile() {
  try {
    const { user } = await api('/api/profile');
    el('accountName').textContent = user ? `${user.name} @${user.username}` : 'مفيش حساب';
    if (user) myUserId = user.user_id;
  } catch (err) {
    el('accountName').textContent = 'تعذّر قراءة جلسة Clubdeck';
  }
}

// ---------------- الغرف ----------------
async function loadChannels() {
  const sel = el('channelSelect');
  try {
    const { channels } = await api('/api/channels');
    while (sel.options.length > 1) sel.remove(1); // نسيب الاختيار الافتراضي بس، ونمسح أي قايمة قديمة قبل ما نملاها تاني
    for (const ch of channels) {
      const opt = document.createElement('option');
      opt.value = ch.channel;
      opt.textContent = `${ch.topic || ch.channel} (${ch.num_all ?? '?'})`;
      sel.appendChild(opt);
    }
  } catch (err) { /* المستخدم يقدر يلصق كود الغرفة يدوي */ }
}

function extractChannel(text) {
  const m = text.match(/room\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : text.trim();
}

// ---------------- الهالواي ----------------
let lastHallwayRooms = [];
let lastFriendsOnlineRooms = new Set();
async function loadHallway() {
  el('hallwayEmpty').textContent = 'بنجيب الغرف المباشرة…';
  el('hallwayEmpty').style.display = 'block';
  try {
    const { rooms } = await api('/api/hallway');
    lastHallwayRooms = rooms;
    el('hallwayLastUpdate').textContent = new Date().toLocaleTimeString('ar-EG');
    checkWatchedKeywords(rooms);
    renderHallway();
    renderHouses(); // نحدّث شارة "شغالة دلوقتي" في تبويب الهاوسات لو فاتح
    loadFriendsOnline(); // نحدّث شريط "أونلاين دلوقتي" فوق الهالواي (بيستخدم نفس مصدر بيانات تبويب اجتماعي)
  } catch (err) {
    el('hallwayEmpty').textContent = `تعذّر تحميل الهالواي: ${err.message}`;
  }
}
function renderHallway() {
  let rooms = lastHallwayRooms.slice();
  const q = (el('hallwayFilterInput')?.value || '').trim().toLowerCase();
  if (q) rooms = rooms.filter((r) => `${r.topic || ''} ${r.club?.name || ''}`.toLowerCase().includes(q));
  if (el('hallwayHousesOnlyToggle')?.checked) rooms = rooms.filter((r) => !!r.club);
  if (el('hallwayFriendsOnlyToggle')?.checked) rooms = rooms.filter((r) => lastFriendsOnlineRooms.has(r.channel));
  const sortBy = el('hallwaySortSelect')?.value;
  if (sortBy === 'popular') rooms.sort((a, b) => (b.numAll || 0) - (a.numAll || 0));
  if (sortBy === 'speakers') rooms.sort((a, b) => (b.numSpeakers || 0) - (a.numSpeakers || 0));
  el('hallwayCount').textContent = rooms.length;
  const grid = clearNode(el('hallwayGrid'));
  el('hallwayEmpty').style.display = rooms.length ? 'none' : 'block';
  el('hallwayEmpty').textContent = 'مفيش غرف تطابق الفلتر دلوقتي.';
  rooms.forEach((r) => grid.appendChild(roomCard(r)));
}
['hallwayFilterInput', 'hallwaySortSelect', 'hallwayHousesOnlyToggle', 'hallwayFriendsOnlyToggle'].forEach((id) => {
  el(id)?.addEventListener('input', renderHallway);
  el(id)?.addEventListener('change', renderHallway);
});
el('hallwayViewToggle')?.addEventListener('click', () => {
  const grid = el('hallwayGrid');
  const isList = grid.classList.toggle('list-view');
  setButtonIconLabel(el('hallwayViewToggle'), isList ? 'dashboard' : 'menu', isList ? 'عرض شبكي' : 'عرض قائمة');
  localStorage.setItem('hallwayListView', isList ? '1' : '');
});
let hallwayRefreshTimer = null;
let hallwayRefreshMs = 30000;
function setHallwayRefreshRate(ms) {
  if (hallwayRefreshTimer) clearInterval(hallwayRefreshTimer);
  hallwayRefreshMs = ms;
  hallwayRefreshTimer = !document.hidden && state.activeWorkspace === 'hallway' && ms > 0 ? setInterval(loadHallway, ms) : null;
  localStorage.setItem('hallwayRefreshRate', ms);
}
el('hallwayRefreshRate')?.addEventListener('change', (e) => setHallwayRefreshRate(Number(e.target.value)));

// ---------------- تنبيه لكلمات في عنوان الغرفة ----------------
function getWatchedKeywords() { try { return JSON.parse(localStorage.getItem('watchedKeywords') || '[]'); } catch { return []; } }
function renderWatchedKeywords() {
  const ul = el('watchKeywordList'); if (!ul) return;
  clearNode(ul);
  getWatchedKeywords().forEach((kw) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = kw;
    li.appendChild(label);
    const btn = document.createElement('button');
    setButtonIconLabel(btn, 'close', `حذف ${kw}`, { iconOnly: true });
    btn.addEventListener('click', () => {
      const list = getWatchedKeywords().filter((k) => k !== kw);
      localStorage.setItem('watchedKeywords', JSON.stringify(list));
      renderWatchedKeywords();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}
el('watchKeywordForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = el('watchKeywordInput').value.trim();
  if (!v) return;
  const list = getWatchedKeywords();
  if (!list.includes(v)) { list.push(v); localStorage.setItem('watchedKeywords', JSON.stringify(list)); }
  el('watchKeywordInput').value = '';
  renderWatchedKeywords();
});
let alertedRoomChannels = new Set();
function checkWatchedKeywords(rooms) {
  const keywords = getWatchedKeywords();
  if (!keywords.length) return;
  rooms.forEach((r) => {
    if (alertedRoomChannels.has(r.channel)) return;
    const hit = keywords.find((kw) => (r.topic || '').toLowerCase().includes(kw.toLowerCase()));
    if (hit) {
      alertedRoomChannels.add(r.channel);
      toast(`غرفة جديدة فيها "${hit}": ${r.topic}`, 'ok');
      beep();
      desktopNotify('غرفة تطابق تنبيهك', r.topic || r.channel);
    }
  });
}
function roomCard(r) {
  const card = document.createElement('div');
  card.className = 'room-card';
  setSafeHTML(card, `
    ${r.club ? `<div class="room-card-club">${r.club.photo ? `<img src="${r.club.photo}">` : ''}<span>${r.club.name}</span></div>` : ''}
    <button class="hide-room-btn" title="إخفاء الغرفة دي من الهالواي">✕</button>
    <button class="room-card-topic room-card-topic-button" type="button" title="دخول الغرفة بالحساب">${lastFriendsOnlineRooms.has(r.channel) ? '👋 ' : ''}${r.topic || 'بدون عنوان'}</button>
    <div class="room-card-avatars">${r.speakers.filter((s) => s.photo_url).map((s) => `<img src="${s.photo_url}" title="${s.name || ''}">`).join('')}</div>
    <div class="room-card-meta"><span class="live">مباشر</span>${r.directSpeakAvailable ? '<span class="pill pill--good">صعود مباشر للمايك</span>' : ''}<span>${r.numSpeakers ?? '?'} متحدث · ${r.numAll ?? '?'} حاضر</span></div>
    <div class="room-card-actions">
      <button class="btn btn--accent btn--sm join-live-room-btn" type="button">دخول الغرفة</button>
      <button class="btn btn--ghost btn--sm monitor-live-room-btn" type="button">مراقبة فقط</button>
      <button class="btn btn--ghost btn--sm room-preview-toggle-btn" type="button" title="شوف مين جوه من غير ما تدخل أو تراقب">👁 مين جوه؟</button>
    </div>
  `);
  setButtonIconLabel(card.querySelector('.hide-room-btn'), 'close', 'إخفاء الغرفة', { iconOnly: true });
  const join = () => joinRoomFromHallway(r.channel, r.topic, card);
  card.querySelector('.room-card-topic-button').addEventListener('click', join);
  card.querySelector('.join-live-room-btn').addEventListener('click', join);
  card.querySelector('.monitor-live-room-btn').addEventListener('click', () => connectToChannel(r.channel, r.topic));
  card.querySelector('.room-preview-toggle-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleRoomPreviewPopover(card, r);
  });
  card.querySelector('.hide-room-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await api('/api/hallway/hide', { method: 'POST', body: { channel: r.channel } });
      card.remove();
      toast('اتخفت الغرفة من الهالواي', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
  return card;
}
// معاينة الحاضرين في غرفة من غير دخول أو حتى مراقبة — من نفس عينة الأعضاء اللي get_feed_v3
// بيرجعها أصلاً مع كل غرفة (مفيش نداء API إضافي)، عشان كده هي عينة (لغاية 8) مش القائمة الكاملة.
function toggleRoomPreviewPopover(card, r) {
  const existing = card.querySelector('.room-preview-pop');
  if (existing) { existing.remove(); return; }
  document.querySelectorAll('.room-preview-pop').forEach((p) => p.remove());
  const pop = document.createElement('div');
  pop.className = 'room-preview-pop';
  const shown = (r.speakers || []).slice(0, 8);
  setSafeHTML(pop, `
    <div class="rp-head"><span>داخل الغرفة الآن</span><b class="ltr-num">${r.numAll ?? shown.length}</b></div>
    <div class="rp-grid">${shown.map((s) => s.photo_url ? `<img src="${s.photo_url}" title="${s.name || ''}">` : `<span title="${s.name || ''}">${(s.name || '?').trim().slice(0, 1).toUpperCase()}</span>`).join('') || '<span class="rp-hint">مفيش بيانات أعضاء متاحة للغرفة دي.</span>'}</div>
    <p class="rp-hint">عينة من ${shown.length} عضو زي ما بيرجعها فيد Clubhouse — مش القائمة الكاملة، ومفيش تفرقة مؤكدة بين متحدث ومستمع فيها.</p>
  `);
  card.appendChild(pop);
  document.addEventListener('click', function closeOnce(e) {
    if (pop.contains(e.target) || e.target.closest('.room-preview-toggle-btn')) return;
    pop.remove();
    document.removeEventListener('click', closeOnce);
  });
}
el('refreshHallwayBtn').addEventListener('click', loadHallway);

// ---------------- الهاوسات ----------------
let lastHouses = [];
async function loadHouses() {
  el('housesEmpty').textContent = 'بنجيب الهاوسات…';
  el('housesEmpty').style.display = 'block';
  try {
    const { houses } = await api('/api/houses');
    lastHouses = houses;
    renderHouses();
    el('housesEmpty').style.display = houses.length ? 'none' : 'block';
    el('housesEmpty').textContent = 'مفيش هاوسات لقيناها على حسابك.';
  } catch (err) {
    el('housesEmpty').textContent = `تعذّر تحميل الهاوسات: ${err.message}`;
  }
}
function renderHouses() {
  const grid = clearNode(el('housesGrid'));
  let houses = lastHouses.slice();
  const q = (el('housesFilterInput')?.value || '').trim().toLowerCase();
  if (q) houses = houses.filter((h) => (h.name || '').toLowerCase().includes(q));
  if (el('housesSortSelect')?.value === 'members') houses.sort((a, b) => (b.num_members || 0) - (a.num_members || 0));
  houses.forEach((h) => {
    const liveRoom = lastHallwayRooms.find((r) => r.club && r.club.id === h.social_club_id);
    const card = document.createElement('div');
    card.className = 'house-card';
    setSafeHTML(card, `
      <img class="house-photo" src="${h.photo_url || ''}">
      <div class="house-info">
        <div class="house-name">${h.name}</div>
        <div class="house-meta">${h.num_members ?? '?'} عضو</div>
      </div>
      ${liveRoom ? '<span class="house-live-badge">غرفة شغالة الآن</span>' : ''}
    `);
    card.addEventListener('click', (e) => {
      if (liveRoom && e.target.closest('.house-live-badge')) return connectToChannel(liveRoom.channel);
      openHouseDetail(h);
    });
    grid.appendChild(card);
  });
}
el('housesFilterInput')?.addEventListener('input', renderHouses);
el('housesSortSelect')?.addEventListener('change', renderHouses);
el('createHouseBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  const name = await inputAction({ title: 'إنشاء هاوس جديد', description: 'سيُنشأ الهاوس عبر حساب Clubhouse النشط.', label: 'اسم الهاوس', placeholder: 'اسم واضح ومميز' });
  if (!name || !name.trim()) return;
  try {
    await api('/api/houses', { method: 'POST', body: { name: name.trim() } });
    toast('اتعمل الهاوس', 'ok');
    loadHouses();
  } catch (err) { toast(`فشل: ${err.message}`, 'err'); }
});

let currentHouse = null;
async function openHouseDetail(house) {
  currentHouse = house;
  el('houseDetailPanel').hidden = false;
  el('houseDetailName').textContent = house.name;
  showHouseView('members');
  loadHouseMembers(house);
}
function showHouseView(view) {
  document.querySelectorAll('#houseDetailPanel [data-hview]').forEach((b) => b.classList.toggle('active', b.dataset.hview === view));
  el('houseMembersView').hidden = view !== 'members';
  el('houseReplaysView').hidden = view !== 'replays';
  el('houseDescView').hidden = view !== 'desc';
  if (view === 'replays' && currentHouse) loadHouseReplays(currentHouse);
  if (view === 'desc' && currentHouse) el('houseDescInput').value = currentHouse.description || '';
}
document.querySelectorAll('#houseDetailPanel [data-hview]').forEach((b) => b.addEventListener('click', () => showHouseView(b.dataset.hview)));
el('closeHouseDetail').addEventListener('click', () => { el('houseDetailPanel').hidden = true; currentHouse = null; });
el('leaveHouseBtn')?.addEventListener('click', async () => {
  if (!currentHouse || blockedByReadOnly()) return;
  if (!(await confirmAction({ title: 'مغادرة الهاوس', description: 'ستتم إزالة عضويتك من هذا الهاوس عبر Clubhouse.', target: currentHouse.name, result: 'مغادرة العضوية الحالية', confirmLabel: 'مغادرة الهاوس' }))) return;
  try {
    await api(`/api/houses/${currentHouse.social_club_id}/leave`, { method: 'POST' });
    toast('اتغادرت الهاوس', 'ok');
    el('houseDetailPanel').hidden = true;
    currentHouse = null;
    loadHouses();
  } catch (err) { toast(`فشل: ${err.message}`, 'err'); }
});
el('exportHouseMembersBtn')?.addEventListener('click', () => {
  if (!lastHouseMembers.length) return toast('مفيش أعضاء متحملين لسه', 'err');
  const rows = [['الاسم', 'اليوزرنيم', 'أدمن'], ...lastHouseMembers.map((m) => [m.name || '', m.username || '', m.is_admin ? 'أيوه' : ''])];
  downloadBlob(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'house-members.csv', 'text/csv');
  toast('اتصدّر CSV', 'ok');
});
el('houseDescSaveBtn').addEventListener('click', async () => {
  if (!currentHouse || blockedByReadOnly()) return;
  try {
    await api(`/api/houses/${currentHouse.social_club_id}/description`, { method: 'POST', body: { description: el('houseDescInput').value } });
    toast('اتحفظ وصف الهاوس', 'ok');
  } catch (err) { toast(err.message, 'err'); }
});

let lastHouseMembers = [];
async function loadHouseMembers(house) {
  const list = clearNode(el('houseMembersList'));
  const adminsList = clearNode(el('houseAdminsList'));
  el('houseMembersEmpty').style.display = 'none';
  el('houseMembersEmpty').textContent = 'بنجيب الأعضاء…';
  el('houseMembersEmpty').style.display = 'block';
  try {
    const { members } = await api(`/api/houses/${house.social_club_id}/members`);
    lastHouseMembers = members;
    el('houseMembersEmpty').style.display = members.length ? 'none' : 'block';
    const admins = members.filter((m) => m.is_admin);
    el('houseAdminsSection').hidden = admins.length === 0;
    admins.forEach((m) => adminsList.appendChild(houseMemberRow(house, m)));
    members.slice(0, 100).forEach((m) => list.appendChild(houseMemberRow(house, m)));
  } catch (err) {
    el('houseMembersEmpty').textContent = `تعذّر تحميل الأعضاء: ${err.message}`;
  }
}
function houseMemberRow(house, m) {
  const row = document.createElement('div');
  row.className = 'user-row';
  setSafeHTML(row, `
    <div class="user-avatar">${(m.name || '?').slice(0, 1).toUpperCase()}</div>
    <div class="user-name">${m.name || m.username}${m.is_admin ? ' <span class="pill pill--good">أدمن</span>' : ''}</div>
    <div class="user-actions"></div>
  `);
  const btn = document.createElement('button');
  btn.className = 'icon-btn'; btn.title = m.is_admin ? 'شيل من الأدمنز' : 'خليه أدمن';
  btn.textContent = m.is_admin ? '➖ أدمن' : '➕ أدمن';
  btn.addEventListener('click', async () => {
    if (blockedByReadOnly()) return;
    try {
      await api(`/api/houses/${house.social_club_id}/admin/${m.user_id}`, { method: m.is_admin ? 'DELETE' : 'POST' });
      toast('تم', 'ok');
      loadHouseMembers(house);
    } catch (err) { toast(err.message, 'err'); }
  });
  row.querySelector('.user-actions').appendChild(btn);
  return row;
}

async function loadHouseReplays(house) {
  const list = clearNode(el('houseReplaysList'));
  el('houseReplaysEmpty').style.display = 'none';
  try {
    const { replays } = await api(`/api/houses/${house.social_club_id}/replays`);
    el('houseReplaysEmpty').style.display = replays.length ? 'none' : 'block';
    el('houseReplaysEmpty').textContent = 'مفيش ريبلايز محفوظة للهاوس ده.';
    replays.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'archive-item';
      setSafeHTML(div, `<span>${r.topic || r.channel || 'ريبلاي'}</span><span class="meta">${r.time_created ? new Date(r.time_created).toLocaleDateString('ar-EG') : ''}</span>`);
      list.appendChild(div);
    });
  } catch (err) {
    el('houseReplaysEmpty').textContent = `تعذّر تحميل الريبلايز: ${err.message}`;
    el('houseReplaysEmpty').style.display = 'block';
  }
}

function syncRoomPickerAction(s = {}) {
  const joined = !!s.connected && !!s.self?.isInRoom;
  const joinButton = el('connectBtn');
  const leaveButton = el('disconnectBtn');
  if (joinButton) {
    joinButton.hidden = joined;
    joinButton.disabled = !!state.readOnlyMode || roomJoinPending;
    setButtonIconLabel(joinButton, 'join', 'انضمام');
  }
  if (leaveButton) {
    leaveButton.hidden = !joined;
    leaveButton.disabled = !!state.readOnlyMode;
    setButtonIconLabel(leaveButton, 'stop', 'مغادرة');
  }
}

async function connectToChannel(channel, topic) {
  if (!channel) return toast('اختار غرفة أو الصق رابطها الأول', 'err');
  try {
    const resolved = await api('/api/channel/select', { method: 'POST', body: { channel } });
    channel = resolved.channel || channel;
    state.channel = channel;
    state.roomReady = false;
    state.connectedAt = Date.now();
    state.peakAll = 0;
    state.seenUserIds = null;
    queueFirstSeen.clear(); queueRaiseCounts.clear(); manualQueueOrder = []; waitTimeSamples = [];
    setActionButtonsEnabled(false);
    syncRoomPickerAction({ connected: true, self: { isInRoom: false } });
    el('roomName').textContent = 'بيجهّز بيانات الغرفة…';
    toast('اتصلنا — بنجهّز بيانات الغرفة (~3 ثواني)', 'ok');
    switchTab('currentroom');
    rememberRecentRoom(channel, topic);
  } catch (err) {
    toast(`فشل الاتصال: ${err.message}`, 'err');
  }
}

function prepareConnectedRoom(channel, topic) {
  state.channel = channel;
  state.roomReady = false;
  state.connectedAt = Date.now();
  state.peakAll = 0;
  state.seenUserIds = null;
  queueFirstSeen.clear(); queueRaiseCounts.clear(); manualQueueOrder = []; waitTimeSamples = [];
  setActionButtonsEnabled(false);
  syncRoomPickerAction({ connected: true, self: { isInRoom: true } });
  el('roomName').textContent = 'بيجهّز بيانات الغرفة…';
  switchTab('currentroom');
  rememberRecentRoom(channel, topic);
}

let roomJoinPending = false;
async function joinRoomFromHallway(channel, topic, card) {
  if (!channel || blockedByReadOnly()) return;
  if (roomJoinPending) return;
  roomJoinPending = true;
  el('connectBtn').disabled = true;
  const buttons = [...(card?.querySelectorAll('button') || [])];
  buttons.forEach((button) => { button.disabled = true; });
  card?.setAttribute('aria-busy', 'true');
  try {
    const resolved = await api('/api/channel/join', { method: 'POST', body: { channel } });
    prepareConnectedRoom(resolved.channel || channel, topic);
    toast(`دخلت الغرفة: ${topic || channel}`, 'ok');
    burstSuccess();
  } catch (err) {
    toast(`تعذر دخول الغرفة: ${err.message}`, 'err');
  } finally {
    roomJoinPending = false;
    syncRoomPickerAction(state.lastState);
    buttons.forEach((button) => { button.disabled = false; });
    card?.removeAttribute('aria-busy');
  }
}

el('connectBtn').addEventListener('click', () => {
  const picked = el('channelSelect').value;
  const typed = el('channelInput').value;
  const channel = picked || extractChannel(typed) || state.channel;
  if (!channel) return toast('اختار غرفة مباشرة أو الصق رابطها الأول', 'err');
  const selectedText = el('channelSelect').selectedOptions[0]?.textContent || '';
  const topic = selectedText.replace(/\s+\([^)]*\)\s*$/, '') || state.lastState?.topic || channel;
  joinRoomFromHallway(channel, topic);
});

el('disconnectBtn').addEventListener('click', leaveCurrentRoom);

function setConnDot(on) {
  el('connDot').classList.toggle('dot--on', on);
}

const ACTION_BUTTON_IDS = ['muteAllBtn', 'inviteAllBtn', 'lowerAllBtn', 'reactAllBtn', 'reactCurrentBtn', 'inviteAllBtn2', 'endRoomBtn', 'quietModeBtn', 'inviteNextBtn'];
function setActionButtonsEnabled(enabled) {
  for (const id of ACTION_BUTTON_IDS) {
    const b = el(id);
    b.disabled = !enabled;
    b.classList.toggle('is-disabled', !enabled);
  }
}
setActionButtonsEnabled(false); // معطّلة لحد ما نتوصّل بغرفة وتوصل أول بيانات فعلية

// ---------------- عرض الدور (مستمع/متكلم/مودريتور) وإخفاء أزرار مش من صلاحيتك ----------------
const ROLE_LABELS = { moderator: 'مودريتور', speaker: 'متكلم', listener: 'مستمع' };
function applyRoleGating(role, caps) {
  el('roleBanner').hidden = false;
  const badge = el('roleBadge');
  badge.textContent = ROLE_LABELS[role] || role;
  badge.className = `pill pill--${role === 'moderator' ? 'mod' : role}`;
  el('roleExplain').textContent = role === 'moderator'
    ? 'معاك كل صلاحيات الموديريشن في الغرفة دي.'
    : role === 'speaker'
      ? 'إنت متكلم بس مش مودريتور هنا — أزرار التحكم في الآخرين متقفلة.'
      : 'إنت مستمع هنا — تقدر بس ترفع إيدك وتعمل رياكت.';

  const capMap = {
    muteAllBtn: caps.can_mute_speakers,
    lowerAllBtn: caps.can_remove_speakers,
    inviteAllBtn: caps.can_edit_handraise_queue,
    inviteAllBtn2: caps.can_edit_handraise_queue,
    inviteNextBtn: caps.can_edit_handraise_queue,
    endRoomBtn: caps.can_end_room,
    quietModeBtn: caps.can_mute_speakers,
  };
  for (const [id, allowed] of Object.entries(capMap)) {
    const b = el(id);
    b.disabled = !allowed;
    b.classList.toggle('is-disabled', !allowed);
    b.title = allowed ? '' : 'محتاج تكون مودريتور في الغرفة دي';
  }
  const titleBtn = document.querySelector('#roomTitleForm button');
  titleBtn.disabled = !caps.can_edit_room_title;
  el('roomTitleInput').disabled = !caps.can_edit_room_title;
  el('handraiseLockToggle').disabled = !caps.can_edit_handraise_queue;
}

// ---------------- مركز قيادة الغرفة: أوامر الحساب نفسه بتظهر حسب الحالة الفعلية ----------------
function setStageCommand(id, visible, disabled = false) {
  const button = el(id);
  if (!button) return;
  button.hidden = !visible;
  button.disabled = !!disabled || !!state.readOnlyMode;
}

function updateLiveRoomStage(s = {}) {
  const connected = !!s.connected;
  const self = s.self || {};
  const speakers = s.speakers || [];
  const listeners = s.listeners || [];
  const queue = s.raiseQueue || [];
  const moderators = speakers.filter((u) => u.is_moderator);
  const title = s.topic || state.channel || 'اختر غرفة وابدأ المراقبة';
  const stage = el('liveRoomStage');
  if (!stage) return;

  stage.dataset.roomState = !connected ? 'idle' : self.isInvitedAsSpeaker ? 'invited' : 'connected';
  el('currentRoomNavIndicator')?.classList.toggle('is-live', connected);
  el('liveRoomTitle').textContent = title;
  el('liveAllCount').textContent = connected ? (s.numAll ?? speakers.length + listeners.length) : '0';
  el('liveSpeakerCount').textContent = connected ? speakers.length : '0';
  el('liveQueueCount').textContent = connected ? queue.length : '0';
  el('liveModCount').textContent = connected ? moderators.length : '0';
  el('liveRoleLabel').textContent = connected ? (ROLE_LABELS[s.myRole] || s.myRole || 'مراقب') : 'غير متصل';
  el('liveRoomEyebrow').textContent = connected ? 'الاتصال بالغرفة نشط' : 'حالة الاتصال بالغرفة';
  const connectionState = el('stageConnectionState');
  connectionState.replaceChildren(document.createElement('span'), document.createTextNode(connected ? ' البيانات الحية متصلة' : ' في انتظار اختيار غرفة'));
  const monitoring = el('monitoringExplainer');
  const monitoringCopy = monitoring?.querySelector('span:last-child');
  if (monitoringCopy) {
    const titleNode = monitoringCopy.querySelector('b');
    const detailNode = monitoringCopy.querySelector('small');
    titleNode.textContent = connected ? 'المراقبة نشطة' : 'وضع المراقبة';
    detailNode.textContent = connected
      ? (self.isInRoom ? 'الحساب داخل الغرفة فعليًا؛ الأوامر الشخصية تتبع موضعه الحالي.' : 'البيانات الحية متصلة، لكن حسابك لم ينضم إلى الغرفة.')
      : 'لا يدخل حسابك إلى الغرفة ولا يغيّر موضعه.';
  }

  if (!connected) {
    el('liveRoomSummary').textContent = 'المراقبة تقرأ حالة الغرفة فقط. الانضمام الحقيقي إجراء منفصل سيظهر هنا بعد نجاح الاتصال.';
  } else if (!self.isInRoom) {
    el('liveRoomSummary').textContent = 'أنت تراقب الغرفة من لوحة التحكم، لكن الحساب نفسه لم ينضم إليها بعد.';
  } else if (self.isInvitedAsSpeaker && !self.isSpeaker) {
    el('liveRoomSummary').textContent = 'وصلتك دعوة للتحدث — يمكنك قبولها الآن والانتقال إلى المسرح.';
  } else if (self.isModerator) {
    el('liveRoomSummary').textContent = 'أنت مودريتور: إدارة المسرح والأعضاء متاحة حسب صلاحيات الغرفة الفعلية.';
  } else if (self.isSpeaker) {
    el('liveRoomSummary').textContent = 'أنت على المسرح كمتحدث، ويمكنك الرجوع إلى الجمهور من هنا.';
  } else if (self.hasRaisedHand) {
    el('liveRoomSummary').textContent = 'طلب التحدث مرفوع وفي انتظار موافقة أحد المودريتورز.';
  } else if (s.directSpeakAvailable || self.directSpeakAvailable) {
    el('liveRoomSummary').textContent = 'الغرفة تسمح بصعود مباشر: زر الانضمام للمايك ينقلك إلى المسرح من غير انتظار طابور.';
  } else {
    el('liveRoomSummary').textContent = 'أنت ضمن الجمهور؛ يمكنك رفع يدك لطلب الانتقال إلى المسرح.';
  }

  const canRaise = connected && self.isInRoom && !self.isSpeaker && !self.isInvitedAsSpeaker;
  const directSpeak = !!(s.directSpeakAvailable || self.directSpeakAvailable);
  const eligibleForPromotion = speakers.filter((u) => !u.is_moderator && String(u.user_id) !== String(self.userId));
  setStageCommand('joinRoomBtn', connected && !self.isInRoom);
  setStageCommand('acceptSpeakerInviteBtn', connected && self.isInRoom && self.isInvitedAsSpeaker && !self.isSpeaker);
  setStageCommand('raiseHandBtn', canRaise, canRaise && !self.hasRaisedHand && !self.handraiseEnabled && !directSpeak);
  setStageCommand('moveToAudienceBtn', connected && self.isInRoom && self.isSpeaker);
  setStageCommand('promoteAllBtn', connected && self.isModerator, eligibleForPromotion.length === 0);

  el('raiseHandLabel').textContent = self.hasRaisedHand ? 'سحب طلب التحدث' : directSpeak ? 'الانضمام للمايك' : 'طلب التحدث';
  el('raiseHandHint').textContent = self.hasRaisedHand
    ? 'إزالة طلبك من طابور التحدث'
    : directSpeak ? 'صعود مباشر بدون انتظار؛ بث الصوت الفعلي يمر عبر Clubdeck' : self.handraiseEnabled ? 'إرسال طلب صعود للمايك' : 'طلبات الصعود للمايك مغلقة';
  el('promoteAllBtn').dataset.eligible = String(eligibleForPromotion.length);
}

el('joinRoomBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  const button = el('joinRoomBtn');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    await api('/api/channel/join', { method: 'POST', body: { channel: state.channel } });
    toast('انضم الحساب للغرفة — بنحدّث حالتك الآن', 'ok');
    switchTab('currentroom');
  } catch (err) {
    toast(`تعذر دخول الغرفة: ${err.message}`, 'err');
    button.disabled = !!state.readOnlyMode;
  } finally {
    button.removeAttribute('aria-busy');
  }
});

el('acceptSpeakerInviteBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  try {
    await api('/api/action/accept-speaker-invite', { method: 'POST' });
    toast('تم قبول دعوة التحدث', 'ok');
    burstSuccess();
  } catch (err) { toast(`تعذر قبول الدعوة: ${err.message}`, 'err'); }
});

el('raiseHandBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  const raised = !!state.lastState?.self?.hasRaisedHand;
  try {
    const response = await api('/api/action/audience-reply', { method: 'POST', body: { action: raised ? 'unraise' : 'raise' } });
    if (raised) toast('تم سحب طلب التحدث', 'ok');
    else if (response.mode === 'direct-speaker') {
      toast(response.microphone?.enabled ? 'تم الصعود وتحديث حالة المايك — بث الصوت عبر Clubdeck' : 'تم الصعود للمسرح — افتح الصوت من Clubdeck', 'ok');
      burstSuccess();
    } else toast('تم رفع إيدك', 'ok');
  } catch (err) { toast(`تعذر تحديث طلب التحدث: ${err.message}`, 'err'); }
});

el('moveToAudienceBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  const isModerator = !!state.lastState?.self?.isModerator;
  if (isModerator && !(await confirmAction({
    title: 'الانتقال من المسرح إلى الجمهور',
    description: 'أنت مودريتور حاليًا. هذا الإجراء ينقلك من المسرح وقد يغيّر صلاحية الإشراف الفعلية داخل الغرفة.',
    target: 'حسابك في الغرفة الحالية',
    result: 'البقاء داخل الغرفة كمستمع بدلًا من متحدث',
    confirmLabel: 'الانتقال إلى الجمهور',
    tone: 'warning',
  }))) return;
  try {
    await api('/api/action/move-to-audience', { method: 'POST' });
    toast('تم نقلك إلى الجمهور', 'ok');
  } catch (err) { toast(`تعذر الرجوع للجمهور: ${err.message}`, 'err'); }
});

el('promoteAllBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  const count = Number(el('promoteAllBtn').dataset.eligible || 0);
  if (!count) return toast('كل الموجودين المؤهلين مودريتورز بالفعل', 'ok');
  if (!(await confirmAction({
    title: 'ترقية كل المتحدثين المؤهلين',
    description: `سيتم إرسال أمر ترقية إلى ${count} متحدث. المستمعون غير مؤهلين قبل قبول دعوة التحدث.`,
    target: `${count} متحدث غير مودريتور`,
    result: 'منح صلاحية مودريتور داخل الغرفة الحالية',
    confirmLabel: 'ترقية المؤهلين',
    tone: 'warning',
  }))) return;
  try {
    const { results, skippedListeners } = await api('/api/action/promote-all', { method: 'POST' });
    const ok = results.filter((r) => r.ok).length;
    toast(`ترقية المودريتورز: نجح ${ok}/${results.length}${skippedListeners ? ` — ${skippedListeners} مستمع غير مؤهل قبل الصعود` : ''}`, ok === results.length ? 'ok' : 'err');
    if (ok) burstSuccess();
  } catch (err) { toast(`تعذرت الترقية الجماعية: ${err.message}`, 'err'); }
});

// ---------------- أكشنات جماعية ----------------
async function runBulk(path, label, body) {
  if (blockedByReadOnly()) return;
  try {
    const { results } = await api(path, { method: 'POST', body });
    if (!results.length) return toast(`${label}: مفيش حد يتطبق عليه الأكشن دلوقتي`, 'err');
    const ok = results.filter((r) => r.ok).length;
    toast(`${label}: نجح ${ok}/${results.length}`, ok === results.length ? 'ok' : 'err');
  } catch (err) {
    toast(`${label} فشل: ${err.message}`, 'err');
  }
}
el('muteAllBtn').addEventListener('click', () => runBulk('/api/action/mute-all', 'كتم الكل'));
el('lowerAllBtn').addEventListener('click', () => runBulk('/api/action/lower-all', 'إنزال الجميع'));
el('inviteAllBtn').addEventListener('click', () => runBulk('/api/action/invite-all', 'رفع الكل'));
el('inviteAllBtn2').addEventListener('click', () => runBulk('/api/action/invite-all', 'رفع الكل'));
el('reactAllBtn').addEventListener('click', () => openReaction({ isAll: true }));
el('reactAllRow').addEventListener('dblclick', () => openReaction({ isAll: true }));

el('reactCurrentBtn').addEventListener('click', () => {
  const speakers = (state.lastState && state.lastState.speakers) || [];
  if (!speakers.length) return toast('مفيش سبيكرز دلوقتي', 'err');
  // ملحوظة: مفيش بيانات "نشاط صوتي حي" في الـ API المتاح، فده تخمين تقريبي (أول سبيكر في القايمة)
  openReaction(speakers[0]);
});

// ---------------- تبديل الكتم التلقائي للسبيكر الجديد ----------------
async function loadSettings() {
  const s = await api('/api/settings');
  applyReadOnlyMode(!!s.serverReadOnlyMode, { announce: false });
  el('autoMuteNewToggle').checked = !!s.autoMuteNewSpeakers;
  el('speakingLimitInput').value = s.speakingTimeLimitMinutes || 5;
  el('speakingLimitToggle').checked = !!s.speakingTimeLimitEnabled;
  el('speakingLimitInput').disabled = !s.speakingTimeLimitEnabled;
  el('speakerCapInput').value = s.speakerCap || 8;
  el('speakerCapToggle').checked = !!s.speakerCapEnabled;
  el('speakerCapInput').disabled = !s.speakerCapEnabled;
  el('autoThankToggle').checked = !!s.autoThankOnHandraise;
  el('vipAutoInviteToggle').checked = !!s.vipAutoInviteEnabled;
  el('blacklistAutoModToggle').checked = !!s.blacklistAutoModEnabled;
  el('protectedListToggle').checked = !!s.protectedListEnabled;
  el('turnRotationToggle').checked = !!s.turnRotationEnabled;
  el('turnRotationTimerInput').value = s.turnRotationTimerMinutes || 5;
  el('turnRotationTimerToggle').checked = !!s.turnRotationTimerEnabled;
  el('turnRotationTimerInput').disabled = !s.turnRotationTimerEnabled;
  el('autoInviteAllToggle').checked = !!s.autoInviteAllNewJoiners;
  el('quietHoursToggle').checked = !!s.quietHoursEnabled;
  el('quietHoursStart').value = s.quietHoursStart || '';
  el('quietHoursEnd').value = s.quietHoursEnd || '';
  // ---- جولة سابعة: 20 ميزة مودريتور ----
  el('autoBackupModToggle').checked = !!s.autoBackupModeratorEnabled;
  el('micCooldownInput').value = s.micCooldownMinutes || 10;
  el('micCooldownToggle').checked = !!s.micCooldownEnabled;
  el('micCooldownInput').disabled = !s.micCooldownEnabled;
  el('maxMicTurnsInput').value = s.maxMicTurns || 3;
  el('maxMicTurnsToggle').checked = !!s.maxMicTurnsEnabled;
  el('maxMicTurnsInput').disabled = !s.maxMicTurnsEnabled;
  el('ghostMicInput').value = s.ghostMicMinutes || 5;
  el('ghostMicToggle').checked = !!s.ghostMicEnabled;
  el('ghostMicInput').disabled = !s.ghostMicEnabled;
  el('blacklistExpireInput').value = s.blacklistAutoExpireDays || 7;
  el('blacklistExpireToggle').checked = !!s.blacklistAutoExpireEnabled;
  el('blacklistExpireInput').disabled = !s.blacklistAutoExpireEnabled;
  el('autoBlacklistOnKickToggle').checked = !!s.autoBlacklistOnKickEnabled;
  el('roomCapacityInput').value = s.roomCapacityMax || 100;
  el('roomCapacityToggle').checked = !!s.roomCapacityEnabled;
  el('roomCapacityInput').disabled = !s.roomCapacityEnabled;
  el('autoFillVacantToggle').checked = !!s.autoFillVacantSeatEnabled;
  el('welcomeSpeakersToggle').checked = !!s.welcomeNewSpeakersEnabled;
  // ---- مركز الإشعارات ----
  el('desktopNotifyLoneModeratorToggle').checked = !!s.desktopNotifyLoneModerator;
  el('desktopNotifyCapacityToggle').checked = !!s.desktopNotifyCapacity;
  el('desktopNotifyGhostMicToggle').checked = !!s.desktopNotifyGhostMic;
  el('desktopNotifyBlacklistJoinToggle').checked = !!s.desktopNotifyBlacklistJoin;
  el('desktopNotifyWelcomeSpeakerToggle').checked = !!s.desktopNotifyWelcomeSpeaker;
  el('welcomeReactionToggle').checked = !!s.welcomeReactionEnabled;
  el('welcomeSpeakerReactionToggle').checked = !!s.welcomeSpeakerReactionEnabled;
  el('welcomeModeratorReactionToggle').checked = !!s.welcomeModeratorReactionEnabled;
  // ---- تاب الأصدقاء والإشعارات ----
  if (el('friendsWatcherEnabledToggle')) el('friendsWatcherEnabledToggle').checked = !!s.friendsWatcherEnabled;
  if (el('friendsWatcherIntervalInput')) el('friendsWatcherIntervalInput').value = s.friendsWatcherIntervalSeconds || 60;
  if (el('notifyOnFriendJoinToggle')) el('notifyOnFriendJoinToggle').checked = !!s.notifyOnFriendJoin;
  if (el('notifyOnModAlertToggle')) el('notifyOnModAlertToggle').checked = !!s.notifyOnModAlert;
}
async function saveSetting(key, value, msg) {
  await api('/api/settings', { method: 'POST', body: { [key]: value } });
  toast(msg, 'ok');
}
el('autoMuteNewToggle').addEventListener('change', (e) => saveSetting('autoMuteNewSpeakers', e.target.checked, e.target.checked ? 'الكتم التلقائي للسبيكر الجديد اتفعّل' : 'اتقفل'));
el('speakingLimitInput').addEventListener('change', (e) => saveSetting('speakingTimeLimitMinutes', Number(e.target.value) || 5, 'اتحفظ سقف وقت الكلام'));
el('speakingLimitToggle').addEventListener('change', (e) => {
  el('speakingLimitInput').disabled = !e.target.checked;
  saveSetting('speakingTimeLimitEnabled', e.target.checked, e.target.checked ? 'سقف وقت الكلام اتفعّل' : 'اتقفل');
});
el('speakerCapInput').addEventListener('change', (e) => saveSetting('speakerCap', Number(e.target.value) || 8, 'اتحفظ أقصى عدد سبيكرز'));
el('speakerCapToggle').addEventListener('change', (e) => {
  el('speakerCapInput').disabled = !e.target.checked;
  saveSetting('speakerCapEnabled', e.target.checked, e.target.checked ? 'أقصى عدد سبيكرز اتفعّل' : 'اتقفل');
});
el('autoThankToggle').addEventListener('change', (e) => saveSetting('autoThankOnHandraise', e.target.checked, e.target.checked ? 'الشكر التلقائي اتفعّل' : 'اتقفل'));
el('vipAutoInviteToggle').addEventListener('change', (e) => saveSetting('vipAutoInviteEnabled', e.target.checked, e.target.checked ? 'رفع الـ VIP التلقائي اتفعّل' : 'اتقفل'));
el('blacklistAutoModToggle').addEventListener('change', (e) => saveSetting('blacklistAutoModEnabled', e.target.checked, e.target.checked ? 'موديريشن القايمة السودة اتفعّل' : 'اتقفل'));
el('protectedListToggle').addEventListener('change', (e) => saveSetting('protectedListEnabled', e.target.checked, e.target.checked ? 'حماية القائمة اتفعّلت' : 'اتقفلت'));
el('autoInviteAllToggle').addEventListener('change', (e) => saveSetting('autoInviteAllNewJoiners', e.target.checked, e.target.checked ? 'الدعوة التلقائية لأي حد يدخل اتفعّلت' : 'اتقفلت'));
el('quietHoursToggle')?.addEventListener('change', (e) => saveSetting('quietHoursEnabled', e.target.checked, e.target.checked ? 'ساعات الهدوء اتفعّلت' : 'اتقفلت'));
el('quietHoursStart')?.addEventListener('change', (e) => saveSetting('quietHoursStart', e.target.value, 'اتحفظ وقت البداية'));
el('quietHoursEnd')?.addEventListener('change', (e) => saveSetting('quietHoursEnd', e.target.value, 'اتحفظ وقت النهاية'));

// ---- جولة سابعة: تفعيل/إعدادات الـ 20 ميزة الجديدة ----
el('autoBackupModToggle')?.addEventListener('change', (e) => saveSetting('autoBackupModeratorEnabled', e.target.checked, e.target.checked ? 'المودريتور الاحتياطي التلقائي اتفعّل' : 'اتقفل'));
el('micCooldownInput')?.addEventListener('change', (e) => saveSetting('micCooldownMinutes', Number(e.target.value) || 10, 'اتحفظت مدة تجميد المايك'));
el('micCooldownToggle')?.addEventListener('change', (e) => { el('micCooldownInput').disabled = !e.target.checked; saveSetting('micCooldownEnabled', e.target.checked, e.target.checked ? 'تجميد المايك اتفعّل' : 'اتقفل'); });
el('maxMicTurnsInput')?.addEventListener('change', (e) => saveSetting('maxMicTurns', Number(e.target.value) || 3, 'اتحفظ أقصى عدد مرات صعود'));
el('maxMicTurnsToggle')?.addEventListener('change', (e) => { el('maxMicTurnsInput').disabled = !e.target.checked; saveSetting('maxMicTurnsEnabled', e.target.checked, e.target.checked ? 'حد أقصى مرات الصعود اتفعّل' : 'اتقفل'); });
el('ghostMicInput')?.addEventListener('change', (e) => saveSetting('ghostMicMinutes', Number(e.target.value) || 5, 'اتحفظت مدة كشف المايك الصامت'));
el('ghostMicToggle')?.addEventListener('change', (e) => { el('ghostMicInput').disabled = !e.target.checked; saveSetting('ghostMicEnabled', e.target.checked, e.target.checked ? 'كشف المايك الصامت اتفعّل' : 'اتقفل'); });
el('blacklistExpireInput')?.addEventListener('change', (e) => saveSetting('blacklistAutoExpireDays', Number(e.target.value) || 7, 'اتحفظت مدة انتهاء القايمة السودة'));
el('blacklistExpireToggle')?.addEventListener('change', (e) => { el('blacklistExpireInput').disabled = !e.target.checked; saveSetting('blacklistAutoExpireEnabled', e.target.checked, e.target.checked ? 'انتهاء صلاحية القايمة السودة اتفعّل' : 'اتقفل'); });
el('autoBlacklistOnKickToggle')?.addEventListener('change', (e) => saveSetting('autoBlacklistOnKickEnabled', e.target.checked, e.target.checked ? 'الإضافة التلقائية للقايمة السودة عند الطرد اتفعّلت' : 'اتقفلت'));
el('roomCapacityInput')?.addEventListener('change', (e) => saveSetting('roomCapacityMax', Number(e.target.value) || 100, 'اتحفظ الحد الأقصى للحضور'));
el('roomCapacityToggle')?.addEventListener('change', (e) => { el('roomCapacityInput').disabled = !e.target.checked; saveSetting('roomCapacityEnabled', e.target.checked, e.target.checked ? 'تنبيه السعة اتفعّل' : 'اتقفل'); });
el('autoFillVacantToggle')?.addEventListener('change', (e) => saveSetting('autoFillVacantSeatEnabled', e.target.checked, e.target.checked ? 'رفع أول واحد فور فضاء مكان اتفعّل' : 'اتقفل'));
el('welcomeSpeakersToggle')?.addEventListener('change', (e) => saveSetting('welcomeNewSpeakersEnabled', e.target.checked, e.target.checked ? 'الترحيب التلقائي بسبيكر جديد اتفعّل' : 'اتقفل'));

// ---- مركز الإشعارات: تنبيه سطح مكتب مستقل لكل نوع ----
el('desktopNotifyLoneModeratorToggle')?.addEventListener('change', (e) => saveSetting('desktopNotifyLoneModerator', e.target.checked, e.target.checked ? 'تنبيه سطح المكتب لمودريتور وحيد اتفعّل' : 'اتقفل'));
el('desktopNotifyCapacityToggle')?.addEventListener('change', (e) => saveSetting('desktopNotifyCapacity', e.target.checked, e.target.checked ? 'تنبيه سطح المكتب لسقف الحضور اتفعّل' : 'اتقفل'));
el('desktopNotifyGhostMicToggle')?.addEventListener('change', (e) => saveSetting('desktopNotifyGhostMic', e.target.checked, e.target.checked ? 'تنبيه سطح المكتب للمايك الصامت اتفعّل' : 'اتقفل'));
el('desktopNotifyBlacklistJoinToggle')?.addEventListener('change', (e) => saveSetting('desktopNotifyBlacklistJoin', e.target.checked, e.target.checked ? 'تنبيه سطح المكتب لدخول القايمة السودة اتفعّل' : 'اتقفل'));
el('desktopNotifyWelcomeSpeakerToggle')?.addEventListener('change', (e) => saveSetting('desktopNotifyWelcomeSpeaker', e.target.checked, e.target.checked ? 'تنبيه سطح المكتب لترحيب السبيكر اتفعّل' : 'اتقفل'));

// ---- تاب الأصدقاء والإشعارات: تحكمات مراقب الخلفية ----
el('friendsWatcherEnabledToggle')?.addEventListener('change', (e) => saveSetting('friendsWatcherEnabled', e.target.checked, e.target.checked ? 'مراقبة الأصدقاء في الخلفية اتفعّلت' : 'اتقفلت'));
el('friendsWatcherIntervalInput')?.addEventListener('change', (e) => saveSetting('friendsWatcherIntervalSeconds', Math.max(15, Number(e.target.value) || 60), 'اتحفظ الفاصل الزمني'));
el('notifyOnFriendJoinToggle')?.addEventListener('change', (e) => saveSetting('notifyOnFriendJoin', e.target.checked, e.target.checked ? 'إشعار دخول الصديق اتفعّل' : 'اتقفل'));
el('notifyOnModAlertToggle')?.addEventListener('change', (e) => saveSetting('notifyOnModAlert', e.target.checked, e.target.checked ? 'ضم تنبيهات المشرفين للفيد اتفعّل' : 'اتقفل'));

// ---------------- إدارة الغرفة: عنوان / قفل رفع الإيد / إنهاء ----------------
el('roomTitleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = el('roomTitleInput').value.trim();
  if (!title || blockedByReadOnly()) return;
  try {
    await api('/api/action/room-title', { method: 'POST', body: { title } });
    toast('اتغيّر عنوان الغرفة', 'ok');
    el('roomTitleInput').value = '';
  } catch (err) { toast(err.message, 'err'); }
});
el('handraiseLockToggle').addEventListener('change', async (e) => {
  if (blockedByReadOnly()) { e.target.checked = !e.target.checked; return; }
  try {
    await api('/api/action/handraise-lock', { method: 'POST', body: { locked: e.target.checked } });
    toast(e.target.checked ? 'رفع الإيد اتقفل' : 'رفع الإيد اتفتح', 'ok');
  } catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
});
el('endRoomBtn').addEventListener('click', async () => {
  if (!(await confirmAction({ title: 'إنهاء الغرفة للجميع', description: 'هذا الإجراء ينهي الجلسة الحية لكل الموجودين ولا يمكن التراجع عنه من Clubhouse mod by Darhous.', target: state.lastState?.topic || state.channel || 'الغرفة الحالية', result: 'إغلاق الغرفة وإنهاء البث', confirmLabel: 'إنهاء الغرفة' }))) return;
  try {
    await api('/api/action/end-room', { method: 'POST' });
    toast('الغرفة اتنهت', 'ok');
    syncRoomPickerAction({ connected: false });
    setConnDot(false);
  } catch (err) { toast(err.message, 'err'); }
});
el('quietModeBtn').addEventListener('click', async () => {
  const minutes = Number(el('quietMinutesInput').value) || 5;
  try {
    const { until } = await api('/api/action/quiet-mode', { method: 'POST', body: { minutes } });
    toast(`وضع الهدوء شغال لحد ${new Date(until).toLocaleTimeString('ar-EG')}`, 'ok');
    el('handraiseLockToggle').checked = true;
  } catch (err) { toast(err.message, 'err'); }
});
el('inviteNextBtn').addEventListener('click', async () => {
  try {
    const { ok, user, error } = await api('/api/action/invite-next', { method: 'POST' });
    toast(ok ? `اتقبل ${user.name || user.user_id}` : error, ok ? 'ok' : 'err');
  } catch (err) { toast(err.message, 'err'); }
});

// ---------------- عرض المستخدمين ----------------
function userRow(u, actionsList, opts = {}) {
  const row = document.createElement('div');
  row.className = `user-row${opts.memberCard ? ' member-card' : ''}`;
  if (opts.zone) row.dataset.zone = opts.zone;
  row.dataset.userId = String(u.user_id ?? '');
  row.dataset.flipId = `member-${u.user_id ?? ''}`;
  row.dataset.speaking = String(u.is_speaking === true);
  const initials = (u.name || '?').trim().slice(0, 1).toUpperCase();
  const hasNote = !!getNote(u.user_id);
  if (opts.selectable) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'select-chk';
    checkbox.setAttribute('aria-label', `تحديد ${u.name || u.username || u.user_id}`);
    row.appendChild(checkbox);
  }
  const avatar = document.createElement('div');
  avatar.className = 'user-avatar';
  avatar.title = `دبل كليك لإرسال رياكت سريع إلى ${u.name || u.username || u.user_id}`;
  avatar.setAttribute('aria-label', avatar.title);
  const photoUrl = u.photo_url || u.photoUrl;
  if (photoUrl) {
    const image = document.createElement('img');
    image.src = photoUrl;
    image.alt = '';
    image.addEventListener('error', () => { image.remove(); avatar.textContent = initials; }, { once: true });
    avatar.appendChild(image);
  } else {
    avatar.textContent = initials;
  }
  avatar.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openQuickReactionPicker(u, avatar);
  });
  row.appendChild(avatar);
  const identity = document.createElement('div');
  identity.className = 'member-identity';
  const name = document.createElement('div');
  name.className = 'user-name';
  name.appendChild(document.createTextNode(u.name || u.username || ('#' + u.user_id)));
  const badges = document.createElement('div');
  badges.className = 'member-badges';
  for (const badge of (Array.isArray(opts.badges) ? opts.badges : [])) {
    const badgeNode = document.createElement('span');
    badgeNode.className = `pill${badge.kind ? ` pill--${badge.kind}` : ''}${badge.ltr ? ' ltr-num' : ''}`;
    badgeNode.title = badge.title || '';
    if (badge.icon) badgeNode.appendChild(uiIcon(badge.icon));
    if (badge.text) badgeNode.appendChild(document.createTextNode(badge.text));
    badges.appendChild(badgeNode);
  }
  identity.appendChild(name);
  if (opts.memberCard) {
    const meta = document.createElement('div');
    meta.className = 'user-meta member-meta';
    meta.textContent = u.username ? `@${u.username}` : (opts.zone === 'stage' ? 'متحدث في الغرفة' : 'ضمن الجمهور');
    identity.appendChild(meta);
    if (badges.childElementCount) identity.appendChild(badges);
  } else if (badges.childElementCount) {
    name.append(' ', badges);
  }
  row.appendChild(identity);
  const infoButton = document.createElement('button');
  infoButton.type = 'button';
  infoButton.className = 'info-icon icon-btn';
  infoButton.title = 'معاينة الملف الشخصي';
  infoButton.setAttribute('aria-label', `معاينة ملف ${u.name || u.username || u.user_id}`);
  infoButton.appendChild(uiIcon('profile'));
  row.appendChild(infoButton);
  const noteButton = document.createElement('button');
  noteButton.type = 'button';
  noteButton.className = `note-icon icon-btn${hasNote ? ' has-note' : ''}`;
  noteButton.title = 'ملاحظة خاصة';
  noteButton.setAttribute('aria-label', `إضافة ملاحظة خاصة عن ${u.name || u.username || u.user_id}`);
  noteButton.appendChild(uiIcon('info'));
  row.appendChild(noteButton);
  const actionsEl = document.createElement('div');
  actionsEl.className = 'user-actions';
  row.appendChild(actionsEl);
  infoButton.addEventListener('click', (e) => { e.stopPropagation(); openProfilePreview(u.user_id); });
  for (const a of actionsList) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.title = a.title;
    btn.setAttribute('aria-label', `${a.title} — ${u.name || u.username || u.user_id}`);
    btn.appendChild(uiIcon(a.icon || 'more'));
    btn.addEventListener('click', (e) => { e.stopPropagation(); a.run(u); });
    actionsEl.appendChild(btn);
  }
  noteButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    const current = getNote(u.user_id) || '';
    const next = await inputAction({
      title: `ملاحظة خاصة عن ${u.name || u.user_id}`,
      description: 'هذه الملاحظة محلية داخل Clubhouse mod by Darhous ولا تُرسل إلى Clubhouse.',
      label: 'الملاحظة',
      value: current,
      placeholder: 'اكتب ملاحظة تشغيلية مختصرة',
    });
    if (next !== null) setNote(u.user_id, next.trim());
    noteButton.classList.toggle('has-note', !!next && !!next.trim());
  });
  if (opts.selectable) {
    const chk = row.querySelector('.select-chk');
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      if (chk.checked) state.selectedUsers.set(u.user_id, u); else state.selectedUsers.delete(u.user_id);
      updateBulkBar();
    });
  }
  if (opts.onSelect) {
    row.classList.add('member-card--inspectable');
    row.tabIndex = 0;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `فتح لوحة ${u.name || u.username || u.user_id}`);
    const selectMember = () => opts.onSelect(u, row);
    row.addEventListener('click', selectMember);
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectMember();
    });
  }
  row.addEventListener('dblclick', (event) => {
    if (event.target.closest('button, input, .user-avatar')) return;
    openReaction(u);
  });
  return row;
}

async function userAction(userId, kind, body) {
  if (blockedByReadOnly()) return;
  try {
    await api(`/api/action/user/${userId}/${kind}`, { method: 'POST', body });
    toast('تم', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function setCurrentRoomControl(id, enabled, reason = '') {
  const button = el(id);
  if (!button) return;
  button.disabled = !enabled || !!state.readOnlyMode;
  button.classList.toggle('is-locked', !enabled);
  button.title = enabled ? '' : reason;
}

function renderCurrentRoomSurface(s = {}) {
  const connected = !!s.connected;
  const self = s.self || {};
  const speakers = s.speakers || [];
  const listeners = s.listeners || [];
  const queue = s.raiseQueue || [];
  const caps = s.capabilities || state.capabilities || {};
  const joined = connected && !!self.isInRoom;
  const role = joined ? (s.myRole || state.myRole || 'listener') : connected ? 'observer' : 'offline';
  const roleLabels = { ...ROLE_LABELS, observer: 'مراقب فقط', offline: 'غير متصل' };
  const presence = el('currentRoomPresence');

  if (presence) presence.dataset.presence = !connected ? 'offline' : joined ? 'joined' : 'monitoring';
  if (el('currentRoomPresenceLabel')) {
    el('currentRoomPresenceLabel').textContent = !connected ? 'لا توجد غرفة متصلة' : joined ? 'الحساب داخل الغرفة الآن' : 'المراقبة متصلة — الحساب خارج الغرفة';
  }
  if (el('currentRoomCapabilitySummary')) {
    el('currentRoomCapabilitySummary').textContent = !connected
      ? 'اختر غرفة من الأعلى لبدء المراقبة.'
      : !joined
        ? 'اضغط الانضمام أولًا؛ لن تُنفّذ أوامر المشاركة قبل دخول الحساب.'
        : self.isModerator
          ? 'صلاحيات المودريتور الفعلية مفعّلة في الكونسول.'
          : self.isSpeaker
            ? 'أنت متحدث؛ أوامر إدارة الآخرين تبقى مقفلة حتى تصبح مودريتور.'
            : 'أنت مستمع؛ رفع اليد والرياكت متاحان حسب حالة الغرفة.';
  }
  if (el('currentRoomRoleBadge')) {
    el('currentRoomRoleBadge').textContent = roleLabels[role] || role;
    el('currentRoomRoleBadge').className = `pill${self.isModerator ? ' pill--warn' : joined ? ' pill--good' : ''}`;
  }
  if (el('currentRoomControlHint')) {
    el('currentRoomControlHint').textContent = !joined
      ? 'انضم إلى الغرفة لتفعيل الأوامر؛ المراقبة وحدها لا تغيّر حسابك.'
      : self.isModerator
        ? 'الكونسول يعمل بصلاحيات المودريتور التي أكدها Clubhouse لهذه الغرفة.'
        : 'الكونسول يعرض كل الأوامر، ويقفل غير المسموح لدورك الحالي.';
  }

  const moderatorReason = joined ? 'يحتاج صلاحية مودريتور في الغرفة الحالية' : 'انضم إلى الغرفة أولًا';
  setCurrentRoomControl('currentMuteAllBtn', joined && !!caps.can_mute_speakers, moderatorReason);
  setCurrentRoomControl('currentInviteAllBtn', joined && !!caps.can_edit_handraise_queue, moderatorReason);
  setCurrentRoomControl('currentLowerAllBtn', joined && !!caps.can_remove_speakers, moderatorReason);
  setCurrentRoomControl('currentReactAllBtn', joined, joined ? '' : 'انضم إلى الغرفة أولًا');
  setCurrentRoomControl('currentEndRoomBtn', joined && !!caps.can_end_room, moderatorReason);
  const leaveButton = el('leaveCurrentRoomBtn');
  if (leaveButton) {
    leaveButton.hidden = !joined;
    leaveButton.disabled = !!state.readOnlyMode;
  }

  if (el('currentRoomQueueCount')) el('currentRoomQueueCount').textContent = queue.length;
  const queueList = clearNode(el('currentRoomQueueList'));
  if (el('currentRoomQueueEmpty')) el('currentRoomQueueEmpty').hidden = queue.length > 0;
  queue.forEach((u) => {
    const actions = caps.can_edit_handraise_queue
      ? [{ icon: 'mic', title: 'دعوة إلى المسرح', run: (member) => userAction(member.user_id, 'invite') }]
      : [];
    const row = userRow(u, actions, { zone: 'queue', badges: memberBadges(u) });
    row.classList.add('current-room-queue-row');
    row.dataset.flipId = `current-queue-${u.user_id ?? ''}`;
    queueList?.appendChild(row);
  });

  const { speakerActions, listenerActions } = getRoomMemberActionSets();
  const currentSpeakers = clearNode(el('currentRoomSpeakersList'));
  const currentListeners = clearNode(el('currentRoomListenersList'));
  speakers.forEach((u) => {
    const row = userRow(u, speakerActions, { memberCard: true, zone: 'stage', badges: memberBadges(u) });
    row.dataset.flipId = `current-stage-${u.user_id ?? ''}`;
    currentSpeakers?.appendChild(row);
  });
  listeners.forEach((u) => {
    const row = userRow(u, listenerActions, { memberCard: true, zone: 'audience', badges: memberBadges(u) });
    row.dataset.flipId = `current-audience-${u.user_id ?? ''}`;
    currentListeners?.appendChild(row);
  });
  if (el('currentRoomSpeakersCount')) el('currentRoomSpeakersCount').textContent = speakers.length;
  if (el('currentRoomListenersCount')) el('currentRoomListenersCount').textContent = listeners.length;
  if (el('currentRoomSpeakersEmpty')) el('currentRoomSpeakersEmpty').hidden = speakers.length > 0;
  if (el('currentRoomListenersEmpty')) el('currentRoomListenersEmpty').hidden = listeners.length > 0;
  window.dispatchEvent(new CustomEvent('modpanel:people:after', { detail: { zone: 'currentroom' } }));
}

document.querySelectorAll('[data-forward-control]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    el(button.dataset.forwardControl)?.click();
  });
});
document.querySelectorAll('[data-open-workspace]').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.openWorkspace));
});

function renderState(s) {
  window.dispatchEvent(new CustomEvent('modpanel:room-state', { detail: s }));
  if (s.reactionCooldownMs > 0) startBroadcastCooldown(s.reactionCooldownMs);
  state.lastState = s;
  if (s.channel) state.channel = s.channel;
  setConnDot(!!s.connected);
  syncRoomPickerAction(s);
  updateLiveRoomStage(s);
  if (state.activeWorkspace === 'effects') renderEffectsCatalog();

  if (s.connected && !state.roomReady) {
    state.roomReady = true;
    setActionButtonsEnabled(true);
    el('roomName').textContent = s.topic || state.channel || 'متصل';
    if (state.activeWorkspace === 'queue') { loadSuggestedSpeakers(); loadReplayers(); }
    state.seenUserIds = new Set([...(s.speakers || []), ...(s.listeners || [])].map((u) => u.user_id));
    bumpVisitCounters([...(s.speakers || []), ...(s.listeners || [])]);
  }
  if (!s.connected) setActionButtonsEnabled(false);
  if (s.connected) {
    state.myRole = s.myRole;
    state.capabilities = s.capabilities || {};
    applyRoleGating(s.myRole, state.capabilities);
  }

  const speakers = s.speakers || [];
  const listeners = s.listeners || [];
  const queue = s.raiseQueue || [];
  const caps = state.capabilities || {};

  el('speakerCount').textContent = `${speakers.length} متكلم`;
  el('speakerCount2').textContent = `${speakers.length} متكلم`;
  el('queueCount').textContent = `${queue.length} رافع إيد`;
  el('queueBadge').hidden = queue.length === 0;
  el('queueBadge').textContent = queue.length;

  el('speakersHeaderCount').textContent = speakers.length;
  el('listenersHeaderCount').textContent = listeners.length;

  if (state.activeWorkspace === 'members') renderMemberLists(speakers, listeners);
  if (state.activeWorkspace === 'currentroom') renderCurrentRoomSurface(s);

  state.lastQueue = queue;
  if (state.activeWorkspace === 'queue') renderQueueList(queue, caps);
  checkQueueSpike(queue.length);

  el('statAll').textContent = s.numAll ?? (speakers.length + listeners.length);
  el('statSpeakers').textContent = speakers.length;
  el('statListeners').textContent = listeners.length;
  el('statQueue').textContent = queue.length;

  const totalNow = speakers.length + listeners.length;
  state.history.push({ t: Date.now(), all: totalNow, speakers: speakers.length });
  if (state.history.length > 120) state.history.shift();
  state.peakAll = Math.max(state.peakAll || 0, totalNow);
  drawChart();
  renderTopTalkers(speakers);
  renderRoomHealth(speakers, listeners);
  updatePanicButtonVisibility(speakers, listeners, caps);
  updateBreadcrumb(s);
  renderQuickWidgets();
  checkEmptySpeakersWarning(speakers);
  renderGrowthAndDeclineStats();
}

// ---------------- معدل النمو + تحذير النزول السريع ----------------
function renderGrowthAndDeclineStats() {
  const el1 = el('growthRate'); if (!el1) return;
  const h = state.history;
  if (h.length < 2) { el1.textContent = '—'; return; }
  const first = h[0].all, last = h[h.length - 1].all;
  const rate = first ? Math.round(((last - first) / first) * 100) : 0;
  el1.textContent = `${rate >= 0 ? '+' : ''}${rate}%`;
  const recent = h.slice(-5);
  const declining = recent.length >= 5 && recent[0].all > 0 && (recent[0].all - recent[recent.length - 1].all) / recent[0].all >= 0.3;
  el('declineWarning').textContent = declining ? 'الحضور ينخفض بسرعة' : 'لا يوجد انخفاض ملحوظ';
}

// ---------------- تصدير الرسم كصورة ----------------
el('exportChartImgBtn')?.addEventListener('click', () => {
  const canvas = el('statsChart');
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'modpanel-chart.png';
  a.click();
  toast('اتصدّر الرسم كصورة', 'ok');
});

// ---------------- نسبة قبول رفع الإيد + معدل الكتم لكل سبيكر (من سجل الأكشنات) ----------------
async function loadAcceptAndMuteStats() {
  try {
    const { list: audit } = await api('/api/audit-log');
    const invites = audit.filter((a) => a.action === 'invite').length;
    const totalRaises = [...queueRaiseCounts.values()].reduce((a, b) => a + b, 0);
    el('acceptRate').textContent = totalRaises ? `${Math.round((invites / totalRaises) * 100)}%` : '—';
    const muteCounts = {};
    audit.filter((a) => a.action === 'mute' || a.action === 'auto-mute-new-speaker').forEach((a) => {
      const name = a.targetName || `#${a.targetId}`;
      muteCounts[name] = (muteCounts[name] || 0) + 1;
    });
    const list = el('muteRateList');
    const entries = Object.entries(muteCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    clearNode(list);
    el('muteRateEmpty').style.display = entries.length ? 'none' : 'block';
    entries.forEach(([name, count]) => {
      const div = document.createElement('div');
      div.className = 'audit-item';
      setSafeHTML(div, `<span>${name}</span><span class="meta">${count} مرة</span>`);
      list.appendChild(div);
    });
  } catch { /* اختياري */ }
}

// ---------------- مقارنة بمتوسط الجلسات السابقة (من الأرشيف) ----------------
async function loadArchiveComparison() {
  try {
    const { list: archives } = await api('/api/archive');
    if (!archives.length) { el('avgPeakAllTime').textContent = 'مفيش أرشيف لسه'; return; }
    const sample = archives.slice(0, 15);
    const details = await Promise.all(sample.map((a) => api(`/api/archive/${encodeURIComponent(a.file)}`).catch(() => null)));
    const peaks = details.filter(Boolean).map((d) => (d.archive.peakListeners || 0) + (d.archive.peakSpeakers || 0)).filter((p) => p > 0);
    if (!peaks.length) { el('avgPeakAllTime').textContent = '—'; return; }
    const avg = Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length);
    el('avgPeakAllTime').textContent = `${avg} شخص`;
    if (state.peakAll) {
      const diff = state.peakAll - avg;
      el('currentVsAvg').textContent = `${state.peakAll} (${diff >= 0 ? '+' : ''}${diff} عن المتوسط)`;
    }
  } catch { /* اختياري */ }
}

// ---------------- تنبيه لو الغرفة فاضية من سبيكرز غير مودريتور ----------------
let emptySpeakersAlerted = false;
function checkEmptySpeakersWarning(speakers) {
  const nonModCount = speakers.filter((u) => !u.is_moderator).length;
  if (nonModCount === 0 && speakers.length > 0 && !emptySpeakersAlerted) {
    emptySpeakersAlerted = true;
    toast('لا يوجد متحدثون غير المودريتورز حاليًا', 'err');
  }
  if (nonModCount > 0) emptySpeakersAlerted = false;
}

// ---------------- البحث ----------------
function fuzzyIncludes(haystack, needle) {
  if (haystack.includes(needle)) return true;
  if (needle.length < 3) return false;
  // تسامح بسيط: لو 80% من حروف الكلمة موجودين بالترتيب في الاسم
  let hi = 0, matched = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, hi);
    if (found >= 0) { matched++; hi = found + 1; }
  }
  return matched / needle.length >= 0.8;
}
function getSearchHistory() { try { return JSON.parse(localStorage.getItem('searchHistory') || '[]'); } catch { return []; } }
function renderSearchHistory() {
  const ul = el('searchHistoryList'); if (!ul) return;
  clearNode(ul);
  getSearchHistory().forEach((q) => {
    const li = document.createElement('li');
    const queryLabel = document.createElement('span');
    queryLabel.style.cursor = 'pointer';
    queryLabel.textContent = q;
    li.appendChild(queryLabel);
    li.querySelector('span').addEventListener('click', () => { el('searchInput').value = q; el('searchForm').requestSubmit(); });
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', () => { localStorage.setItem('searchHistory', JSON.stringify(getSearchHistory().filter((h) => h !== q))); renderSearchHistory(); });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}
el('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = el('searchInput').value.trim();
  const q = raw.toLowerCase();
  const results = clearNode(el('searchResults'));
  if (!q || !state.lastState) { el('searchEmpty').style.display = 'block'; return; }
  const history = getSearchHistory().filter((h) => h !== raw);
  history.unshift(raw);
  localStorage.setItem('searchHistory', JSON.stringify(history.slice(0, 8)));
  renderSearchHistory();
  const pool = [...(state.lastState.speakers || []), ...(state.lastState.listeners || [])];
  let matches = pool.filter((u) => String(u.user_id) === raw || fuzzyIncludes(`${u.name || ''} ${u.username || ''}`.toLowerCase(), q));
  matches.sort((a, b) => (b.is_moderator ? 1 : 0) - (a.is_moderator ? 1 : 0));
  el('searchResultCount').textContent = matches.length ? `${matches.length} نتيجة` : '';
  el('searchEmpty').style.display = matches.length ? 'none' : 'block';
  if (!matches.length) el('searchEmpty').textContent = 'مفيش نتائج.';
  matches.forEach((u) => results.appendChild(userRow(u, [
    { icon: 'mute', title: 'كتم الميكروفون', run: (u) => userAction(u.user_id, 'mute') },
    { icon: 'mic', title: 'دعوة إلى المسرح', run: (u) => userAction(u.user_id, 'invite') },
  ], { badges: memberBadges(u) })));
});
renderSearchHistory();
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    switchTab('search');
    el('searchInput').focus();
  }
});

// ---------------- الرسائل (DMs) ----------------
let myUserId = null;
let currentChatId = null;
let currentChatLoc = 'chats';

async function loadChats(loc) {
  currentChatLoc = loc;
  document.querySelectorAll('[data-loc]').forEach((b) => b.classList.toggle('active', b.dataset.loc === loc));
  const list = clearNode(el('chatsList'));
  el('chatsEmpty').style.display = 'block';
  el('chatsEmpty').textContent = 'بنجيب الرسائل…';
  try {
    const { chats } = await api(`/api/chats?location=${loc}`);
    el('chatsEmpty').style.display = chats.length ? 'none' : 'block';
    el('chatsEmpty').textContent = 'مفيش رسائل هنا.';
    if (loc === 'requests') {
      el('messagesBadge').hidden = chats.length === 0;
      el('messagesBadge').textContent = chats.length;
      el('acceptAllRequestsBtn').hidden = chats.length === 0;
    } else {
      el('acceptAllRequestsBtn').hidden = true;
    }
    const pinned = getPinnedChats();
    const sorted = loc === 'chats' ? [...chats].sort((a, b) => (pinned.includes(b.chat_id) ? 1 : 0) - (pinned.includes(a.chat_id) ? 1 : 0)) : chats;
    sorted.forEach((c) => {
      const other = c.members.find((m) => m.user_profile_id !== myUserId) || c.members[0];
      const row = document.createElement('div');
      row.className = 'user-row chat-list-item';
      const body = c.last_message?.message_data?.message_body || 'مفيش رسائل لسه';
      const isUnread = isChatUnread(c);
      const timeStr = c.time_updated ? new Date(c.time_updated).toLocaleDateString('ar-EG') : '';
      setSafeHTML(row, `
        <div class="user-avatar">${(other.name || '?').slice(0, 1).toUpperCase()}</div>
        <div class="user-name">${pinned.includes(c.chat_id) ? '<span class="pill">مثبت</span> ' : ''}${isUnread ? '<span class="pill pill--warn">جديد</span> ' : ''}${other.name || 'محادثة'}<div class="last-msg">${body}</div></div>
        <div class="user-meta" style="flex:none">${timeStr}</div>
        <div class="user-actions"></div>
      `);
      if (loc === 'requests') {
        const actionsEl = row.querySelector('.user-actions');
        dmRequestActions(c.chat_id).forEach((a) => {
          const btn = document.createElement('button');
          btn.className = 'icon-btn'; btn.title = a.title; btn.textContent = a.icon;
          btn.addEventListener('click', (e) => { e.stopPropagation(); a.run(); });
          actionsEl.appendChild(btn);
        });
      } else {
        row.addEventListener('click', () => openChatThread(c.chat_id, other.name));
      }
      list.appendChild(row);
    });
  } catch (err) {
    el('chatsEmpty').textContent = `تعذّر تحميل الرسائل: ${err.message}`;
  }
}
document.querySelectorAll('[data-loc]').forEach((b) => {
  b.addEventListener('click', () => loadChats(b.dataset.loc));
});
el('acceptAllRequestsBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  if (!(await confirmAction({ title: 'قبول كل طلبات الرسائل', description: 'ستُنقل كل الطلبات المعلّقة إلى صندوق الرسائل.', target: 'كل الطلبات الحالية', result: 'قبول جماعي لطلبات المحادثة', confirmLabel: 'قبول كل الطلبات', tone: 'neutral' }))) return;
  try {
    const { results } = await api('/api/chats/requests/accept-all', { method: 'POST' });
    const ok = results.filter((r) => r.ok).length;
    toast(`قبول الطلبات: نجح ${ok}/${results.length}`, ok === results.length ? 'ok' : 'err');
    loadChats('requests');
  } catch (err) { toast(err.message, 'err'); }
});

async function openChatThread(chatId, title) {
  currentChatId = chatId;
  el('chatsListView').hidden = true;
  el('chatThreadView').hidden = false;
  el('chatThreadTitle').textContent = title || '';
  const box = clearNode(el('chatMessages'));
  box.textContent = 'بنجيب الرسائل…';
  try {
    const { messages } = await api(`/api/chats/${chatId}/messages`);
    currentChatMessages = messages;
    clearNode(box);
    if (!messages.length) setSafeHTML(box, '<p class="empty-hint">مفيش رسائل في المحادثة دي لسه.</p>');
    messages.forEach((m) => {
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${m.sender_user_profile_id === myUserId ? 'me' : 'them'}`;
      bubble.textContent = m.message_data?.message_body || '';
      box.appendChild(bubble);
    });
    box.scrollTop = box.scrollHeight;
    const viewed = getChatLastViewed(); viewed[chatId] = Date.now(); localStorage.setItem('chatLastViewed', JSON.stringify(viewed));
  } catch (err) {
    setSafeHTML(box, `<p class="empty-hint">تعذّر تحميل الرسائل: ${err.message}</p>`);
  }
}
el('backToChatsBtn').addEventListener('click', () => {
  el('chatThreadView').hidden = true;
  el('chatsListView').hidden = false;
  currentChatId = null;
});
el('chatSendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = el('chatSendInput').value.trim();
  if (!text || !currentChatId || blockedByReadOnly()) return;
  try {
    await api(`/api/chats/${currentChatId}/messages`, { method: 'POST', body: { text } });
    el('chatSendInput').value = '';
    openChatThread(currentChatId, el('chatThreadTitle').textContent);
  } catch (err) {
    toast(`فشل الإرسال: ${err.message}`, 'err');
  }
});

// ---------------- اجتماعي: بحث عام + متابعين + متابعة/ويف ----------------
// أزرار التفاعل مع شخص (دعوة للغرفة/متابعة/ويف/حظر/مشاركة/تجاهل) — مستخدمة في صفوف القوائم
// وفي هيدر معاينة البروفايل الكامل، عشان السلوك يفضل واحد في المكانين مش منسوخ مرتين.
function buildPersonActionButtons(u, actionsEl, { onMuteRemove } = {}) {
  const isFollowing = u.viewer_follow_status === 'following';
  if (state.channel && state.capabilities.can_edit_handraise_queue) {
    const bringBtn = document.createElement('button');
    bringBtn.className = 'icon-btn'; bringBtn.title = 'دعوة للغرفة المتصلة'; setButtonIconLabel(bringBtn, 'join', 'دعوة للغرفة', { iconOnly: true });
    bringBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (blockedByReadOnly()) return;
      try { await api(`/api/action/bring-to-room/${u.user_id}`, { method: 'POST' }); toast('اتبعتله دعوة للغرفة', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    });
    actionsEl.appendChild(bringBtn);
  }
  const followBtn = document.createElement('button');
  followBtn.className = 'icon-btn';
  followBtn.title = isFollowing ? 'إلغاء المتابعة' : 'متابعة';
  setButtonIconLabel(followBtn, isFollowing ? 'check' : 'join', isFollowing ? 'متابَع' : 'متابعة');
  followBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (blockedByReadOnly()) return;
    const following = followBtn.title === 'إلغاء المتابعة';
    try {
      await api(`/api/social/${following ? 'unfollow' : 'follow'}/${u.user_id}`, { method: 'POST' });
      toast(following ? 'تم إلغاء المتابعة' : 'تمت المتابعة', 'ok');
      followBtn.title = following ? 'متابعة' : 'إلغاء المتابعة';
      setButtonIconLabel(followBtn, following ? 'join' : 'check', following ? 'متابعة' : 'متابَع');
    } catch (err) { toast(err.message, 'err'); }
  });
  const waveBtn = document.createElement('button');
  waveBtn.className = 'icon-btn'; waveBtn.title = 'إرسال ويف'; setButtonIconLabel(waveBtn, 'hand', 'إرسال ويف', { iconOnly: true });
  waveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (blockedByReadOnly()) return;
    try { await api(`/api/social/wave/${u.user_id}`, { method: 'POST' }); toast('اتبعت الويف', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });
  const blockBtn = document.createElement('button');
  blockBtn.className = 'icon-btn'; blockBtn.title = 'حظر عام'; setButtonIconLabel(blockBtn, 'lock', 'حظر عام', { iconOnly: true });
  blockBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (blockedByReadOnly()) return;
    if (!(await confirmAction({ title: 'حظر حساب', description: 'سيتم إرسال أمر حظر عام إلى Clubhouse.', target: u.name || `#${u.user_id}`, result: 'منع التفاعل مع الحساب', confirmLabel: 'حظر الحساب' }))) return;
    try { await api(`/api/social/block/${u.user_id}`, { method: 'POST' }); toast('اتحظر', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });
  const shareBtn = document.createElement('button');
  shareBtn.className = 'icon-btn'; shareBtn.title = 'مشاركة رابط البروفايل'; setButtonIconLabel(shareBtn, 'link', 'مشاركة رابط البروفايل', { iconOnly: true });
  shareBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(`https://www.clubhouse.com/@${u.username}`, 'رابط البروفايل');
  });
  const muteBtn = document.createElement('button');
  const isMuted = getMutedUsers().some((m) => m.id === u.user_id);
  muteBtn.className = 'icon-btn'; muteBtn.title = isMuted ? 'إلغاء التجاهل' : 'تجاهل (يخفيه من عندك بس)'; setButtonIconLabel(muteBtn, isMuted ? 'eye' : 'mute', muteBtn.title, { iconOnly: true });
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMutedUser(u.user_id, u.name || u.username);
    onMuteRemove?.();
  });
  actionsEl.appendChild(shareBtn);
  actionsEl.appendChild(muteBtn);
  actionsEl.appendChild(followBtn);
  actionsEl.appendChild(waveBtn);
  actionsEl.appendChild(blockBtn);
}
function socialUserRow(u) {
  const row = document.createElement('div');
  row.className = 'user-row';
  const initials = (u.name || '?').trim().slice(0, 1).toUpperCase();
  setSafeHTML(row, `
    <div class="user-avatar">${initials}</div>
    <div class="user-name">${u.name || u.username || ('#' + u.user_id)}<div class="user-meta">@${u.username || ''}</div></div>
    <div class="user-actions"></div>
  `);
  row.addEventListener('click', () => openProfilePreview(u.user_id));
  buildPersonActionButtons(u, row.querySelector('.user-actions'), { onMuteRemove: () => row.remove() });
  if (getMutedUsers().some((m) => m.id === u.user_id)) row.style.display = 'none';
  return row;
}
function getMutedUsers() { try { return JSON.parse(localStorage.getItem('mutedUsers') || '[]'); } catch { return []; } }
function toggleMutedUser(id, name) {
  let list = getMutedUsers();
  if (list.some((m) => m.id === id)) list = list.filter((m) => m.id !== id);
  else list.push({ id, name });
  localStorage.setItem('mutedUsers', JSON.stringify(list));
  renderMutedUsersList();
}
function renderMutedUsersList() {
  const ul = el('mutedUsersList'); if (!ul) return;
  const list = getMutedUsers();
  clearNode(ul);
  el('mutedUsersEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach((m) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = m.name;
    li.appendChild(label);
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', () => toggleMutedUser(m.id, m.name));
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// ---------------- الموجات (Waves) ----------------
async function loadWaves(type) {
  document.querySelectorAll('[data-wave]').forEach((b) => b.classList.toggle('active', b.dataset.wave === type));
  const list = clearNode(el('wavesList'));
  el('wavesEmpty').style.display = 'block';
  try {
    const { waves } = await api(`/api/waves?type=${type}`);
    el('wavesEmpty').style.display = waves.length ? 'none' : 'block';
    waves.forEach((w) => {
      const u = w.user_profile || w.sender || w.receiver || w;
      list.appendChild(socialUserRow(u));
    });
  } catch (err) {
    el('wavesEmpty').textContent = `تعذّر تحميل الموجات: ${err.message}`;
  }
}
document.querySelectorAll('[data-wave]').forEach((b) => b.addEventListener('click', () => loadWaves(b.dataset.wave)));

// ---------------- سجل بحث المستخدمين العام ----------------
function getGlobalSearchHistory() { try { return JSON.parse(localStorage.getItem('globalUserSearchHistory') || '[]'); } catch { return []; } }
function renderGlobalSearchHistory() {
  const ul = el('globalSearchHistoryList'); if (!ul) return;
  clearNode(ul);
  getGlobalSearchHistory().forEach((q) => {
    const li = document.createElement('li');
    const queryLabel = document.createElement('span');
    queryLabel.style.cursor = 'pointer';
    queryLabel.textContent = q;
    queryLabel.addEventListener('click', () => { el('globalSearchInput').value = q; el('globalSearchForm').requestSubmit(); });
    li.appendChild(queryLabel);
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', () => { localStorage.setItem('globalUserSearchHistory', JSON.stringify(getGlobalSearchHistory().filter((h) => h !== q))); renderGlobalSearchHistory(); });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}
renderGlobalSearchHistory();

el('globalSearchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = el('globalSearchInput').value.trim();
  const results = clearNode(el('globalSearchResults'));
  if (!q) return;
  const history = getGlobalSearchHistory().filter((h) => h !== q);
  history.unshift(q);
  localStorage.setItem('globalUserSearchHistory', JSON.stringify(history.slice(0, 8)));
  renderGlobalSearchHistory();
  try {
    const { users } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const minF = Number(el('globalSearchMinFollowers').value) || 0;
    const filtered = minF ? users.filter((u) => (u.num_followers || 0) >= minF) : users;
    filtered.forEach((u) => results.appendChild(socialUserRow(u)));
    if (!filtered.length) setSafeHTML(results, '<p class="empty-hint">مفيش نتائج.</p>');
  } catch (err) {
    toast(`فشل البحث: ${err.message}`, 'err');
  }
});

// ---------------- بروفايلي ----------------
async function loadFullProfile() {
  const card = el('profileCard');
  try {
    const { profile: p } = await api('/api/profile/full');
    setSafeHTML(card, `
      <div class="house-card" style="align-items:flex-start;margin-bottom:16px">
        <img class="house-photo" src="${p.photo_url || ''}" style="width:72px;height:72px;border-radius:50%">
        <div class="house-info">
          <div class="house-name" style="font-size:1.1rem">${p.name}</div>
          <div class="house-meta">@${p.username}</div>
          <div class="house-meta">${p.num_followers ?? 0} متابع · ${p.num_following ?? 0} متابَع</div>
        </div>
        <button class="share-btn" id="shareProfileBtn">نسخ رابط البروفايل</button>
      </div>
      <form class="inline-form" id="bioForm">
        <input type="text" id="bioInput" value="${(p.bio || '').replace(/"/g, '&quot;')}" class="ltr-input" style="flex:1" />
        <button class="btn btn--accent btn--sm">حفظ البايو</button>
      </form>
      <form class="inline-form" id="nameForm" style="margin-top:8px">
        <input type="text" id="nameInput" value="${(p.name || '').replace(/"/g, '&quot;')}" class="ltr-input" style="flex:1" placeholder="الاسم الظاهر" />
        <button class="btn btn--sm">حفظ الاسم</button>
      </form>
      <form class="inline-form" id="usernameForm" style="margin-top:8px">
        <input type="text" id="usernameInput" value="${(p.username || '').replace(/"/g, '&quot;')}" class="ltr-input" style="flex:1" placeholder="اليوزرنيم (@)" />
        <button class="btn btn--sm">حفظ اليوزرنيم</button>
      </form>
      <p class="hint">${(p.social_clubs || []).length} هاوس · ${(p.topics || []).length} موضوع مهتم بيه</p>
      <div class="inline-form" style="margin-top:8px">
        <button class="btn btn--ghost btn--sm" id="mobilePreviewToggleBtn" style="flex:1">معاينة الموبايل</button>
        <button class="btn btn--ghost btn--sm" id="exportProfileDataBtn" style="flex:1">تصدير بياناتي</button>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="card-head"><h3>إحصائياتي</h3></div>
        <table class="kbd-table">
          <tr><td>عدد الغرف المؤرشفة</td><td id="statMyArchives">—</td></tr>
          <tr><td>إجمالي الأكشنات المسجّلة</td><td id="statMyActions">—</td></tr>
          <tr><td>أكتر أكشن استخدمته</td><td id="statMyTopAction">—</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>نسخ سابقة من البايو</h3></div>
        <ul class="chip-list" id="bioHistoryList"></ul>
        <p class="empty-hint" id="bioHistoryEmpty">مفيش نسخ محفوظة لسه.</p>
      </div>
    `);
    setButtonIconLabel(el('shareProfileBtn'), 'link', 'نسخ رابط البروفايل');
    setButtonIconLabel(el('mobilePreviewToggleBtn'), 'monitor', 'معاينة الموبايل');
    setButtonIconLabel(el('exportProfileDataBtn'), 'download', 'تصدير بياناتي');
    el('shareProfileBtn').addEventListener('click', () => copyToClipboard(p.url || p.share_url || `https://www.clubhouse.com/@${p.username}`, 'رابط البروفايل'));
    el('mobilePreviewToggleBtn').addEventListener('click', () => {
      card.classList.toggle('mobile-preview');
    });
    el('exportProfileDataBtn').addEventListener('click', () => {
      downloadBlob(JSON.stringify(p, null, 2), 'my-profile-data.json', 'application/json');
      toast('اتصدّرت بيانات البروفايل', 'ok');
    });
    loadMyStats();
    renderBioHistory();
    el('bioForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (blockedByReadOnly()) return;
      try {
        await api('/api/profile/bio', { method: 'POST', body: { bio: el('bioInput').value } });
        saveBioHistory(el('bioInput').value);
        toast('اتحفظ البايو', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });
    el('nameForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (blockedByReadOnly()) return;
      try {
        await api('/api/profile/name', { method: 'POST', body: { name: el('nameInput').value } });
        toast('اتحفظ الاسم', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });
    el('usernameForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (blockedByReadOnly()) return;
      try {
        await api('/api/profile/username', { method: 'POST', body: { username: el('usernameInput').value } });
        toast('اتحفظ اليوزرنيم', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });
  } catch (err) {
    setSafeHTML(card, `<p class="empty-hint">تعذّر تحميل البروفايل: ${err.message}</p>`);
  }
}

// ---------------- مين أونلاين من متابعينك وفي أنهي غرفة (تبويب اجتماعي + شريط مصغّر فوق الهالواي) ----------------
function renderHallwayOnlineStrip(friends) {
  const strip = el('hallwayOnlineStrip'); if (!strip) return;
  clearNode(strip);
  el('hallwayOnlineCount').textContent = friends.length;
  el('hallwayOnlineEmpty').style.display = friends.length ? 'none' : 'block';
  friends.slice(0, 12).forEach((u) => {
    const chip = document.createElement('div');
    chip.className = 'online-chip';
    setSafeHTML(chip, `<span class="online-dot" aria-hidden="true"></span><span><b>${u.name || u.username || '#' + u.user_id}</b><small> · ${u.room.topic || u.room.channel}</small></span>`);
    const goBtn = document.createElement('button');
    goBtn.className = 'btn btn--ghost btn--sm'; goBtn.type = 'button'; goBtn.textContent = 'دخول';
    goBtn.title = 'مراقبة الغرفة دي (بدون دخول حسابك فعليًا)';
    goBtn.addEventListener('click', () => connectToChannel(u.room.channel, u.room.topic));
    chip.appendChild(goBtn);
    strip.appendChild(chip);
  });
}
function friendOnlineRow(u) {
  const row = socialUserRow(u);
  const meta = row.querySelector('.user-meta');
  if (meta) meta.append(document.createTextNode(` · غرفة: ${u.room.topic || u.room.channel}`));
  const joinBtn = document.createElement('button');
  joinBtn.className = 'icon-btn'; joinBtn.title = 'ادخل الغرفة دي'; joinBtn.textContent = '➡️';
  joinBtn.addEventListener('click', (e) => { e.stopPropagation(); connectToChannel(u.room.channel, u.room.topic); });
  row.querySelector('.user-actions').prepend(joinBtn);
  return row;
}
async function loadFriendsOnline() {
  const list = el('friendsOnlineList'); if (!list) return;
  clearNode(list);
  try {
    const { friends } = await api('/api/social/friends-online');
    lastFriendsOnlineRooms = new Set(friends.map((u) => u.room.channel));
    if (document.getElementById('tab-hallway')?.classList.contains('active')) renderHallway();
    if (el('friendsJoinAlertToggle')?.checked) checkFriendsJoinAlert(friends);
    el('friendsOnlineEmpty').style.display = friends.length ? 'none' : 'block';
    renderHallwayOnlineStrip(friends);
    friends.forEach((u) => list.appendChild(friendOnlineRow(u)));
  } catch (err) { el('friendsOnlineEmpty').textContent = `تعذّر التحميل: ${err.message}`; el('friendsOnlineEmpty').style.display = 'block'; }
}
el('refreshFriendsOnlineBtn')?.addEventListener('click', loadFriendsOnline);

// ---------------- تاب الأصدقاء والإشعارات ----------------
async function loadFriendsOnlineFull() {
  const list = el('friendsOnlineListFull'); if (!list) return;
  clearNode(list);
  try {
    const { friends } = await api('/api/social/friends-online');
    el('friendsOnlineFullEmpty').style.display = friends.length ? 'none' : 'block';
    friends.forEach((u) => list.appendChild(friendOnlineRow(u)));
  } catch (err) { el('friendsOnlineFullEmpty').textContent = `تعذّر التحميل: ${err.message}`; el('friendsOnlineFullEmpty').style.display = 'block'; }
}
el('refreshFriendsOnlineFullBtn')?.addEventListener('click', loadFriendsOnlineFull);

function relativeTimeAr(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'دلوقتي';
  if (mins < 60) return `من ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `من ${hours} ساعة`;
  return `من ${Math.floor(hours / 24)} يوم`;
}
async function loadFriendsOffline() {
  const list = el('friendsOfflineList'); if (!list) return;
  clearNode(list);
  try {
    const [{ sightings }, { friends: online }] = await Promise.all([api('/api/friends/sightings'), api('/api/social/friends-online')]);
    const onlineIds = new Set(online.map((u) => String(u.user_id)));
    const offline = Object.values(sightings)
      .filter((s) => !onlineIds.has(String(s.userId)))
      .sort((a, b) => new Date(b.lastSeenOnline) - new Date(a.lastSeenOnline));
    el('friendsOfflineEmpty').style.display = offline.length ? 'none' : 'block';
    offline.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'user-row';
      const initials = (s.name || '?').trim().slice(0, 1).toUpperCase();
      setSafeHTML(row, `
        <div class="user-avatar">${initials}</div>
        <div class="user-name">${s.name || s.username || ('#' + s.userId)}<div class="user-meta">آخر ظهور رصدناه: ${relativeTimeAr(s.lastSeenOnline)}${s.lastRoom ? ' · ' + (s.lastRoom.topic || s.lastRoom.channel) : ''}</div></div>
        <div class="user-actions"></div>
      `);
      const muteBtn = document.createElement('button');
      muteBtn.className = 'icon-btn'; muteBtn.title = s.muted ? 'إلغاء كتم إشعارات الصديق ده' : 'كتم إشعارات الصديق ده'; muteBtn.textContent = s.muted ? '🔔' : '🔇';
      muteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await api(`/api/friends/${s.userId}/mute`, { method: 'POST', body: { muted: !s.muted } }); loadFriendsOffline(); }
        catch (err) { toast(`فشل: ${err.message}`, 'err'); }
      });
      row.querySelector('.user-actions').appendChild(muteBtn);
      list.appendChild(row);
    });
  } catch (err) { el('friendsOfflineEmpty').textContent = `تعذّر التحميل: ${err.message}`; el('friendsOfflineEmpty').style.display = 'block'; }
}

function notificationRow(n) {
  const row = document.createElement('div');
  row.className = `audit-item notif-item${n.read ? '' : ' notif-item--unread'}`;
  setSafeHTML(row, `<span>${n.message}</span><span class="meta ltr-num">${new Date(n.time).toLocaleTimeString('ar-EG')}</span>`);
  if (n.channel) {
    row.classList.add('notif-item--clickable');
    row.title = 'دوس عشان تدخل الغرفة';
    row.addEventListener('click', async () => {
      if (!n.read) { n.read = true; try { await api(`/api/notifications/${n.id}/read`, { method: 'POST' }); } catch {} updateFriendsBellBadge(); }
      el('friendsBellPopover').hidden = true;
      connectToChannel(n.channel, n.topic);
    });
  }
  return row;
}
function renderNotificationsList() {
  const box = el('friendsNotificationList'); if (!box) return;
  clearNode(box);
  const list = state.notifications || [];
  el('friendsNotificationEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach((n) => box.appendChild(notificationRow(n)));
}
async function loadNotifications() {
  try {
    const { list } = await api('/api/notifications');
    state.notifications = list;
    renderNotificationsList();
    updateFriendsBellBadge();
  } catch (err) { toast(`تعذّر تحميل الإشعارات: ${err.message}`, 'err'); }
}
el('markAllNotificationsReadBtn')?.addEventListener('click', async () => {
  try { await api('/api/notifications/read-all', { method: 'POST' }); await loadNotifications(); toast('اتحدد الكل كمقروء', 'ok'); }
  catch (err) { toast(`فشل: ${err.message}`, 'err'); }
});
el('clearNotificationsBtn')?.addEventListener('click', async () => {
  if (!(await confirmAction({ title: 'مسح كل الإشعارات', description: 'هيتمسح كل الإشعارات المحفوظة نهائيًا.', result: 'مسح الكل', confirmLabel: 'مسح الكل' }))) return;
  try { await api('/api/notifications', { method: 'DELETE' }); state.notifications = []; renderNotificationsList(); updateFriendsBellBadge(); renderFriendsBellPopover(); toast('اتمسح السجل', 'ok'); }
  catch (err) { toast(`فشل: ${err.message}`, 'err'); }
});

function updateFriendsBellBadge() {
  const unread = (state.notifications || []).filter((n) => !n.read).length;
  const badge = el('friendsBellBadge');
  if (badge) { badge.hidden = unread === 0; badge.textContent = String(unread); }
  const tabBadge = el('friendsTabBadge');
  if (tabBadge) { tabBadge.hidden = unread === 0; tabBadge.textContent = String(unread); }
}
function renderFriendsBellPopover() {
  const pop = el('friendsBellPopover'); if (!pop) return;
  clearNode(pop);
  const list = (state.notifications || []).slice(0, 10);
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'history-item';
    empty.textContent = 'مفيش إشعارات لسه';
    pop.appendChild(empty);
  } else {
    list.forEach((n) => pop.appendChild(notificationRow(n)));
  }
  const viewAllBtn = document.createElement('button');
  viewAllBtn.className = 'btn btn--ghost btn--sm'; viewAllBtn.type = 'button'; viewAllBtn.style.cssText = 'width:100%;margin-top:8px';
  viewAllBtn.textContent = 'مشاهدة جميع الإشعارات';
  viewAllBtn.addEventListener('click', () => {
    document.querySelector('.nav-item[data-tab="friends"]')?.click();
    pop.hidden = true;
  });
  pop.appendChild(viewAllBtn);
}
el('friendsBellBtn')?.addEventListener('click', () => {
  const pop = el('friendsBellPopover'); if (!pop) return;
  pop.hidden = !pop.hidden;
  if (!pop.hidden) renderFriendsBellPopover();
});
function handleNewNotification(entry) {
  state.notifications = [entry, ...(state.notifications || [])].slice(0, 300);
  updateFriendsBellBadge();
  if (!el('friendsBellPopover').hidden) renderFriendsBellPopover();
  if (document.getElementById('tab-friends')?.classList.contains('active')) renderNotificationsList();
}
let lastFriendsSnapshot = {};
function checkFriendsJoinAlert(friends) {
  friends.forEach((u) => {
    const prevRoom = lastFriendsSnapshot[u.user_id];
    if (prevRoom !== u.room.channel) {
      if (Object.keys(lastFriendsSnapshot).length) { // متتنبهش أول تحميل - بس على التغييرات بعد كده
        toast(`👋 ${u.name} دخل غرفة: ${u.room.topic || u.room.channel}`, 'ok');
        beep();
        desktopNotify('صديق دخل غرفة', `${u.name} في ${u.room.topic || u.room.channel}`);
      }
      lastFriendsSnapshot[u.user_id] = u.room.channel;
    }
  });
}
el('friendsJoinAlertToggle')?.addEventListener('change', (e) => {
  localStorage.setItem('friendsJoinAlert', e.target.checked ? '1' : '');
  if (e.target.checked) lastFriendsSnapshot = {};
});

let lastFollowers = [];
// ---------------- إحصائياتي + نسخ البايو السابقة ----------------
async function loadMyStats() {
  try {
    const [{ list: archives }, { list: audit }] = await Promise.all([api('/api/archive'), api('/api/audit-log')]);
    el('statMyArchives').textContent = archives.length;
    el('statMyActions').textContent = audit.length;
    const counts = {};
    audit.forEach((a) => { counts[a.action] = (counts[a.action] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    el('statMyTopAction').textContent = top ? `${top[0]} (${top[1]} مرة)` : '—';
  } catch { /* اختياري */ }
}
function getBioHistory() { try { return JSON.parse(localStorage.getItem('bioHistory') || '[]'); } catch { return []; } }
function saveBioHistory(bio) {
  const list = getBioHistory();
  list.unshift({ bio, t: Date.now() });
  localStorage.setItem('bioHistory', JSON.stringify(list.slice(0, 10)));
  renderBioHistory();
}
function renderBioHistory() {
  const ul = el('bioHistoryList'); if (!ul) return;
  const list = getBioHistory();
  clearNode(ul);
  el('bioHistoryEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach((h) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.title = new Date(h.t).toLocaleString('ar-EG');
    label.textContent = (h.bio || '(فاضي)').slice(0, 40);
    li.appendChild(label);
    const btn = document.createElement('button');
    btn.textContent = '↺';
    btn.title = 'استرجاع النسخة دي';
    btn.addEventListener('click', () => { el('bioInput').value = h.bio; toast('اترجعت النسخة القديمة - دوس حفظ عشان تثبتها', 'ok'); });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

async function loadFollowers() {
  try {
    const { users } = await api('/api/social/followers');
    lastFollowers = users;
    const list = clearNode(el('followersList'));
    el('followersEmpty').style.display = users.length ? 'none' : 'block';
    users.forEach((u) => list.appendChild(socialUserRow(u)));
  } catch (err) {
    el('followersEmpty').textContent = `تعذّر تحميل المتابعين: ${err.message}`;
    el('followersEmpty').style.display = 'block';
  }
}
el('exportFollowersBtn')?.addEventListener('click', () => {
  if (!lastFollowers.length) return toast('مفيش متابعين متحملين لسه', 'err');
  const rows = [['الاسم', 'اليوزرنيم'], ...lastFollowers.map((u) => [u.name || '', u.username || ''])];
  downloadBlob(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'followers.csv', 'text/csv');
  toast('اتصدّر CSV', 'ok');
});

// ---------------- آخر تفاعل اجتماعي (من سجل الأكشنات) ----------------
async function loadRecentInteractions() {
  const list = el('recentInteractionsList'); if (!list) return;
  try {
    const { list: audit } = await api('/api/audit-log');
    const social = audit.filter((a) => a.action && a.action.startsWith('social-')).slice(0, 20);
    clearNode(list);
    el('recentInteractionsEmpty').style.display = social.length ? 'none' : 'block';
    social.forEach((a) => {
      const div = document.createElement('div');
      div.className = 'audit-item';
      setSafeHTML(div, `<span>${a.action.replace('social-', '')} — #${a.targetId}</span><span class="meta">${new Date(a.time).toLocaleTimeString('ar-EG')}</span>`);
      list.appendChild(div);
    });
  } catch { /* اختياري */ }
}

// ---------------- الرياكت ----------------
function quickReactionEmoji() {
  const raw = state.lastState?.raw || {};
  const options = raw.emoji_reactions?.profile_reactions || raw.reactions?.profile_reactions || [];
  const first = options[0];
  return (typeof first === 'string' ? first : first?.emoji) || '❤️';
}

function visibleAvatarForUser(userId) {
  return [...document.querySelectorAll(`.user-row[data-user-id="${CSS.escape(String(userId))}"] .user-avatar`)]
    .find((avatar) => avatar.getClientRects().length > 0);
}

function addReactionBurst(avatar, emoji, kind) {
  if (!avatar) return;
  const host = document.createElement('span');
  host.className = `profile-reaction-burst profile-reaction-burst--${kind}`;
  host.setAttribute('aria-hidden', 'true');
  if (kind === 'self') {
    const reaction = document.createElement('span');
    reaction.className = 'profile-reaction-main';
    reaction.textContent = emoji;
    host.appendChild(reaction);
  } else {
    const particles = [
      ['-24px', '-34px', '0ms'], ['18px', '-42px', '55ms'],
      ['-34px', '-16px', '105ms'], ['29px', '-23px', '150ms'],
    ];
    particles.forEach(([x, y, delay]) => {
      const particle = document.createElement('span');
      particle.className = 'profile-reaction-particle';
      particle.style.setProperty('--reaction-x', x);
      particle.style.setProperty('--reaction-y', y);
      particle.style.setProperty('--reaction-delay', delay);
      particle.textContent = emoji;
      host.appendChild(particle);
    });
  }
  avatar.appendChild(host);
  setTimeout(() => host.remove(), 950);
}

// لوحة اختيار سريعة بتظهر عند دبل كليك على صورة أي حد — بتوري كتالوجات الرياكت الحقيقية
// بتاعة الغرفة المتصلة دلوقتي (بروفايل/غرفة/صوت)، ودوسة على أي إيموجي تبعته بنفس حركة
// اللمعة (قلب في النص عندك، جسيمات متحركة عند الطرف التاني).
function closeQuickReactionPicker() {
  document.querySelectorAll('.quick-reaction-picker').forEach((p) => p.remove());
}
function openQuickReactionPicker(user, avatar) {
  closeQuickReactionPicker();
  if (!state.lastState?.connected || !state.lastState?.self?.isInRoom) {
    return toast('انضم إلى الغرفة الأول عشان تبعت رياكت', 'err');
  }
  const groups = [
    ['بروفايل', realRoomReactionCatalog('profile_reactions')],
    ['الغرفة', realRoomReactionCatalog('channel_reactions')],
    ['🔊 صوت', realRoomReactionCatalog('audio_reactions')],
  ].filter(([, list]) => list.length);
  if (!groups.length) return quickReactToUser(user, avatar);
  const pop = document.createElement('div');
  pop.className = 'quick-reaction-picker';
  groups.forEach(([label, list]) => {
    const section = document.createElement('div');
    section.className = 'quick-reaction-picker-group';
    const heading = document.createElement('small');
    heading.textContent = label;
    section.appendChild(heading);
    const row = document.createElement('div');
    row.className = 'quick-reaction-picker-row';
    list.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeQuickReactionPicker();
        quickReactToUser(user, avatar, emoji);
      });
      row.appendChild(btn);
    });
    section.appendChild(row);
    pop.appendChild(section);
  });
  (avatar.closest('.user-row') || avatar).style.position = 'relative';
  (avatar.closest('.user-row') || avatar).appendChild(pop);
  setTimeout(() => document.addEventListener('click', function closeOnce(e) {
    if (pop.contains(e.target)) return;
    closeQuickReactionPicker();
    document.removeEventListener('click', closeOnce);
  }), 0);
}

async function quickReactToUser(user, avatar, chosenEmoji) {
  const userId = String(user?.user_id ?? '');
  if (!userId || blockedByReadOnly()) return;
  if (!state.lastState?.connected || !state.lastState?.self?.isInRoom) {
    return toast('انضم إلى الغرفة الأول عشان تبعت رياكت', 'err');
  }
  if (state.quickReactionsInFlight.has(userId)) return;
  const emoji = chosenEmoji || quickReactionEmoji();
  state.quickReactionsInFlight.add(userId);
  avatar?.classList.add('is-sending-reaction');
  try {
    await api(`/api/action/user/${userId}/reaction`, { method: 'POST', body: { value: emoji } });
    addReactionBurst(avatar, emoji, 'target');
    addReactionBurst(visibleAvatarForUser(state.lastState.self.userId), emoji, 'self');
    toast(`اتبعت ${emoji} إلى ${user.name || user.username || userId}`, 'ok');
  } catch (err) {
    toast(`تعذر إرسال الرياكت: ${err.message}`, 'err');
  } finally {
    avatar?.classList.remove('is-sending-reaction');
    setTimeout(() => state.quickReactionsInFlight.delete(userId), 450);
  }
}

function renderPresetRow(container, onPick) {
  clearNode(container);
  if (!state.presets.length) {
    const p = document.createElement('span'); p.className = 'preset-empty'; p.textContent = 'مفيش قوالب لسه';
    container.appendChild(p);
    return;
  }
  state.presets.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'preset-chip';
    btn.textContent = p.value;
    btn.addEventListener('click', () => onPick(p.value));
    container.appendChild(btn);
  });
}

function syncEmojiComboControls() {
  document.querySelectorAll('.emoji-combo-toggle').forEach((toggle) => {
    toggle.classList.toggle('active', state.emojiComboMode);
    toggle.setAttribute('aria-pressed', String(state.emojiComboMode));
    toggle.title = state.emojiComboMode ? 'الكومبو مفعّل — اختر إيموجي' : 'فعّل الكومبو ثم اختر أي إيموجي';
  });
  document.querySelectorAll('button[data-emoji][data-combo-action]').forEach((emojiButton) => {
    emojiButton.setAttribute('aria-label', `${emojiButton.dataset.comboAction} ${emojiButton.dataset.emoji}${state.emojiComboMode ? ' ككومبو ×100' : ''}`);
  });
  const banner = el('emojiComboBanner');
  const status = el('emojiComboStatus');
  banner?.classList.toggle('active', state.emojiComboMode);
  if (status) status.textContent = state.emojiComboMode ? 'وضع ×100 العام مفعّل — اختار أي إيموجي من الشبكة' : 'كل زر بالمصفوفة يرسل 100 من نفس الإيموجي — 10 × 10';
}

function renderEmojiComboMatrix(container, onPick, actionLabel) {
  if (!container) return;
  clearNode(container);
  for (const emoji of COMBO_PRESET_EMOJIS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-count-combo';
    button.setAttribute('aria-label', `${actionLabel} ${emoji} مئة مرة في مصفوفة 10 في 10`);
    button.title = `${actionLabel} ${emoji} ×100`;
    const symbol = document.createElement('span');
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = emoji;
    const count = document.createElement('small');
    count.textContent = '×100';
    button.append(symbol, count);
    button.addEventListener('click', () => onPick(buildEmojiCombo(emoji)));
    container.appendChild(button);
  }
}

function createEmojiComboToggle() {
  const comboToggle = document.createElement('button');
  comboToggle.type = 'button';
  comboToggle.className = 'emoji-combo-toggle';
  comboToggle.setAttribute('aria-label', 'تفعيل كومبو الإيموجي: 100 إيموجي في 10 صفوف');
  const comboIcon = document.createElement('span');
  comboIcon.className = 'emoji-combo-toggle__icon';
  comboIcon.setAttribute('aria-hidden', 'true');
  comboIcon.textContent = '💕';
  const comboCount = document.createElement('small');
  comboCount.textContent = '×100';
  comboToggle.append(comboIcon, comboCount);
  comboToggle.addEventListener('click', () => {
    state.emojiComboMode = !state.emojiComboMode;
    syncEmojiComboControls();
    toast(state.emojiComboMode ? 'كومبو ×100 مفعّل — اختار الإيموجي' : 'رجعنا للإرسال العادي', 'ok');
  });
  syncEmojiComboControls();
  return comboToggle;
}

function openReaction(u) {
  state.currentReactionUser = u;
  state.emojiComboMode = false;
  el('reactionTarget').textContent = u.isAll ? 'الكل' : (u.name || u.username || ('#' + u.user_id));
  renderEmojiComboMatrix(el('emojiComboMatrix'), sendReaction, 'إرسال');
  const grid = clearNode(el('emojiGrid'));
  grid.appendChild(createEmojiComboToggle());
  for (const e of EMOJIS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.emoji = e;
    btn.dataset.comboAction = 'إرسال';
    btn.textContent = e;
    btn.addEventListener('click', () => sendReaction(state.emojiComboMode ? buildEmojiCombo(e) : e));
    grid.appendChild(btn);
  }
  syncEmojiComboControls();
  renderPresetRow(el('modalPresetRow'), sendReaction);
  updateReactionComposerPreview();
  renderRoomReactionCatalog();
  el('reactionModal').hidden = false;
}

// قايمة الرياكتس الصوتية الحقيقية بتاعة الغرفة المتصلة دلوقتي (مش قايمة عامة) — بتتشغّل
// جوه تطبيق Clubhouse نفسه عند الطرف التاني، Clubhouse mod by Darhous مالوش صوت.
function realRoomReactionCatalog(kind) {
  const raw = state.lastState?.raw || {};
  const source = raw.emoji_reactions?.[kind] || raw.reactions?.[kind] || [];
  return source.map((item) => (typeof item === 'string' ? item : item?.emoji)).filter(Boolean);
}
function renderRoomReactionCatalog() {
  const wrap = el('reactionRoomCatalog');
  const grid = clearNode(el('audioReactionGrid'));
  const audio = realRoomReactionCatalog('audio_reactions');
  wrap.hidden = !audio.length;
  audio.forEach((e) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = e;
    btn.title = `${e} — من كتالوج صوتيات الغرفة الحقيقي`;
    btn.addEventListener('click', () => sendReaction(e));
    grid.appendChild(btn);
  });
}

// ---------------- رياكت GIF (عقد مرشح) ----------------
function extractGiphyId(input) {
  const trimmed = String(input || '').trim();
  const urlMatch = trimmed.match(/giphy\.com\/(?:gifs|embed)\/(?:[\w-]*-)?([a-zA-Z0-9]+)(?:[/?].*)?$/);
  return urlMatch ? urlMatch[1] : trimmed.replace(/[^a-zA-Z0-9]/g, '');
}
async function sendGifReactionById(giphyId) {
  const u = state.currentReactionUser;
  if (!u || u.isAll) { toast('اختار شخص واحد الأول (رياكت الـGIF مش جماعي)', 'err'); return; }
  if (blockedByReadOnly()) return;
  try {
    await api(`/api/action/user/${u.user_id}/gif-reaction`, { method: 'POST', body: { giphyId } });
    toast('اتبعت رياكت الـGIF', 'ok');
    el('reactionModal').hidden = true;
  } catch (err) {
    toast(`فشل إرسال الـGIF: ${err.message}`, 'err');
  }
}
el('gifReactionForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const giphyId = extractGiphyId(el('gifReactionInput').value);
  if (!giphyId) return toast('حط معرّف أو رابط GIF صحيح', 'err');
  el('gifReactionInput').value = '';
  sendGifReactionById(giphyId);
});

// ---------------- بحث GIF حقيقي عبر Giphy (محتاج مفتاح API من الإعدادات) ----------------
function getGifSearchHistory() { try { return JSON.parse(localStorage.getItem('gifSearchHistory') || '[]'); } catch { return []; } }
function renderGifSearchHistory() {
  const ul = el('gifSearchHistoryList'); if (!ul) return;
  clearNode(ul);
  getGifSearchHistory().forEach((q) => {
    const li = document.createElement('li');
    const queryLabel = document.createElement('span');
    queryLabel.style.cursor = 'pointer';
    queryLabel.textContent = q;
    queryLabel.addEventListener('click', () => { el('gifSearchInput').value = q; el('gifSearchForm').requestSubmit(); });
    li.appendChild(queryLabel);
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', () => { localStorage.setItem('gifSearchHistory', JSON.stringify(getGifSearchHistory().filter((h) => h !== q))); renderGifSearchHistory(); });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}
el('gifSearchForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = el('gifSearchInput').value.trim();
  const grid = clearNode(el('gifSearchResults'));
  const empty = el('gifSearchEmpty');
  if (!q) return;
  const history = getGifSearchHistory().filter((h) => h !== q);
  history.unshift(q);
  localStorage.setItem('gifSearchHistory', JSON.stringify(history.slice(0, 8)));
  renderGifSearchHistory();
  empty.style.display = 'block';
  empty.textContent = 'بندوّر…';
  try {
    const { results } = await api(`/api/gif/search?q=${encodeURIComponent(q)}`);
    empty.style.display = results.length ? 'none' : 'block';
    empty.textContent = 'مفيش نتائج.';
    results.forEach((g) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gif-result';
      btn.title = g.title || 'إرسال الـGIF ده';
      const img = document.createElement('img');
      img.src = g.preview;
      img.alt = g.title || '';
      btn.appendChild(img);
      btn.addEventListener('click', () => sendGifReactionById(g.id));
      grid.appendChild(btn);
    });
  } catch (err) {
    empty.style.display = 'block';
    empty.textContent = `تعذّر البحث: ${err.message}`;
  }
});
renderGifSearchHistory();

// ================================================================
// ==================  تبويب تأثيرات — بث جماعي على الغرفة  =================
// ================================================================
function renderEffectsCatalog() {
  const card = el('effectsCatalogCard'); if (!card) return;
  const groups = [['effectsProfileGrid', 'profile_reactions'], ['effectsChannelGrid', 'channel_reactions'], ['effectsAudioGrid', 'audio_reactions']];
  let total = 0;
  groups.forEach(([gridId, kind]) => {
    const grid = clearNode(el(gridId));
    realRoomReactionCatalog(kind).forEach((emoji) => {
      total++;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.addEventListener('click', () => sendRoomEffect(emoji));
      grid.appendChild(btn);
    });
  });
  el('effectsCatalogEmpty').style.display = total ? 'none' : 'block';
}

function recordLastEffect(label, run) {
  el('lastEffectSummary').textContent = `آخر تأثير: ${label} — ${new Date().toLocaleTimeString('ar-EG')}`;
  const repeatBtn = el('repeatLastEffectBtn');
  hasRecordedEffect = true;
  repeatBtn.disabled = broadcastCooldownRemainingMs() > 0 || !!state.readOnlyMode;
  repeatBtn.onclick = run;
}

// حس "الشاشة بتتملي" — طبقة جسيمات بصرية بحتة، مالهاش أي دخل بنجاح/فشل الإرسال الحقيقي
// (بتتفعّل بس بعد رد نجاح من السيرفر). بتحترم تفضيل تقليل الحركة زي باقي الحركات في الكود.
function celebrateRoomEffect(payload) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const layer = el('effectsParticleLayer'); if (!layer) return;
  for (let i = 0; i < 28; i++) {
    const particle = document.createElement(payload.imageUrl ? 'img' : 'span');
    particle.className = 'effects-particle';
    if (payload.imageUrl) { particle.src = payload.imageUrl; particle.alt = ''; }
    else particle.textContent = payload.emoji;
    particle.style.setProperty('--eff-left', `${Math.random() * 100}%`);
    particle.style.setProperty('--eff-duration', `${1.6 + Math.random() * 1.2}s`);
    particle.style.setProperty('--eff-delay', `${Math.random() * 0.5}s`);
    particle.style.setProperty('--eff-drift', `${(Math.random() - 0.5) * 160}px`);
    particle.style.setProperty('--eff-size', `${22 + Math.random() * 26}px`);
    layer.appendChild(particle);
    setTimeout(() => particle.remove(), 2600);
  }
}
function firstEmojiOf(value) {
  return String(value).match(/\p{Extended_Pictographic}️?/u)?.[0] || '✨';
}

// ---------------- حماية من حظر Clubhouse المؤقت: فاصل مشترك بين أي بث جماعي (ريأكت/GIF/ترحيب) ----------------
// اتأكد حيًا إن 3 عمليات بث جماعي بفاصل ~20 ثانية كفاية تفعّل "high usage of this feature" مؤقتًا —
// نفس الفاصل بالظبط متطبّق سيرفر-سايد كبوابة نهائية (server.js: guardBroadcastReactionCooldown)،
// هنا بس نسخة عميل عشان الزراير تتعطّل بعداد تنازلي بدل ما المستخدم يضغط ويستني رفض.
const BROADCAST_COOLDOWN_MS = 30000;
const BROADCAST_ALL_BUTTON_IDS = ['effectsFiftyHeartsBtn', 'effectsFireComboBtn', 'welcomeAllBtn', 'welcomeAllBtnMembers'];
let broadcastCooldownUntil = 0;
let broadcastCooldownTimer = null;
let welcomeRequestPending = false;
let hasRecordedEffect = false;
function broadcastCooldownRemainingMs() { return Math.max(0, broadcastCooldownUntil - Date.now()); }
function blockedByBroadcastCooldown() {
  if (welcomeRequestPending) { toast('الترحيب الحالي شغال بفاصل ٥ ثواني؛ استنى اكتماله', 'err'); return true; }
  const remaining = broadcastCooldownRemainingMs();
  if (remaining > 0) { toast(`⏳ استنى ${Math.ceil(remaining / 1000)} ثانية قبل بث جماعي تاني — عشان محدش يضرب حظر Clubhouse من السبام`, 'err'); return true; }
  return false;
}
function updateBroadcastCooldownUI() {
  const remaining = broadcastCooldownRemainingMs();
  const active = remaining > 0 || welcomeRequestPending;
  BROADCAST_ALL_BUTTON_IDS.forEach((id) => { const btn = el(id); if (btn) btn.disabled = active || !!state.readOnlyMode; });
  const repeatBtn = el('repeatLastEffectBtn');
  if (repeatBtn && hasRecordedEffect) repeatBtn.disabled = active || !!state.readOnlyMode;
  document.querySelectorAll('.gif-result').forEach((btn) => { btn.disabled = active; });
  const hint = el('broadcastCooldownHint');
  if (hint) {
    hint.style.display = active ? 'flex' : 'none';
    hint.textContent = welcomeRequestPending ? 'جاري الترحيب… فاصل ٥ ثواني، وبحد محافظ ٣ طلبات في الدقيقة؛ الانتظار طبيعي' : active ? `⏳ استنى ${Math.ceil(remaining / 1000)} ثانية قبل بث جماعي تاني — لتقليل احتمال التقييد` : '';
  }
  clearTimeout(broadcastCooldownTimer);
  if (active) broadcastCooldownTimer = setTimeout(updateBroadcastCooldownUI, 500);
}
function startBroadcastCooldown(ms = BROADCAST_COOLDOWN_MS) {
  broadcastCooldownUntil = Math.max(broadcastCooldownUntil, Date.now() + ms);
  updateBroadcastCooldownUI();
}

async function sendRoomEffect(value) {
  if (blockedByReadOnly()) return;
  if (!state.lastState?.connected) return toast('لازم تكون متصل بغرفة الأول', 'err');
  if (blockedByBroadcastCooldown()) return;
  startBroadcastCooldown();
  try {
    const { results } = await api('/api/action/reaction-all', { method: 'POST', body: { value } });
    if (!results.length) return toast('مفيش حد في الغرفة دلوقتي', 'err');
    const ok = results.filter((r) => r.ok).length;
    toast(`نتيجة البث: نجح ${ok}/${results.length}${results.some((r) => r.skipped) ? ' — توقف الإرسال قبل الوصول للجميع' : ''}`, ok === results.length ? 'ok' : 'err');
    celebrateRoomEffect({ emoji: firstEmojiOf(value) });
    recordLastEffect(firstEmojiOf(value), () => sendRoomEffect(value));
  } catch (err) {
    toast(`فشل: ${err.message}`, 'err');
  }
}
el('effectsFiftyHeartsBtn')?.addEventListener('click', () => sendRoomEffect(FIFTY_HEARTS_REACTION));
el('effectsFireComboBtn')?.addEventListener('click', () => sendRoomEffect(buildEmojiCombo('🔥')));

// ---------------- ترحيب: توگل تلقائي + زرار "رحّب بالكل" (تأثيرات + المسرح والجمهور) ----------------
el('welcomeReactionToggle')?.addEventListener('change', (e) => saveSetting('welcomeReactionEnabled', e.target.checked, e.target.checked ? 'ريأكت الترحيب التلقائي بالمستمعين اتفعّل' : 'اتقفل'));
el('welcomeSpeakerReactionToggle')?.addEventListener('change', (e) => saveSetting('welcomeSpeakerReactionEnabled', e.target.checked, e.target.checked ? 'ريأكت الترحيب التلقائي بالمتحدثين اتفعّل' : 'اتقفل'));
el('welcomeModeratorReactionToggle')?.addEventListener('change', (e) => saveSetting('welcomeModeratorReactionEnabled', e.target.checked, e.target.checked ? 'ريأكت الترحيب التلقائي بالمودريتورز اتفعّل' : 'اتقفل'));

async function welcomeEveryoneNow() {
  if (blockedByReadOnly()) return;
  if (!state.lastState?.connected) return toast('لازم تكون متصل بغرفة الأول', 'err');
  if (blockedByBroadcastCooldown()) return;
  welcomeRequestPending = true;
  startBroadcastCooldown();
  try {
    const { results, total, capped } = await api('/api/action/welcome-all', { method: 'POST' });
    if (!results.length) return toast('مفيش حد في الغرفة دلوقتي', 'err');
    const ok = results.filter((r) => r.ok).length;
    toast(`اترحّب بـ${ok}/${results.length}${capped ? ` (من إجمالي ${total} — الأول ${results.length} بس للأمان)` : ''}`, ok === results.length ? 'ok' : 'err');
    celebrateRoomEffect({ emoji: '❤️' });
  } catch (err) {
    toast(`فشل الترحيب: ${err.message}`, 'err');
  } finally { welcomeRequestPending = false; updateBroadcastCooldownUI(); }
}
el('welcomeAllBtn')?.addEventListener('click', welcomeEveryoneNow);
el('welcomeAllBtnMembers')?.addEventListener('click', welcomeEveryoneNow);

async function sendGifEffectAll(giphyId, previewUrl) {
  if (blockedByReadOnly()) return;
  if (!state.lastState?.connected) return toast('لازم تكون متصل بغرفة الأول', 'err');
  if (blockedByBroadcastCooldown()) return;
  startBroadcastCooldown();
  try {
    const { results } = await api('/api/action/gif-reaction-all', { method: 'POST', body: { giphyId } });
    if (!results.length) return toast('مفيش حد في الغرفة دلوقتي', 'err');
    const ok = results.filter((r) => r.ok).length;
    toast(`نتيجة بث GIF: نجح ${ok}/${results.length}${results.some((r) => r.skipped) ? ' — توقف الإرسال قبل الوصول للجميع' : ''}`, ok === results.length ? 'ok' : 'err');
    celebrateRoomEffect({ imageUrl: previewUrl });
    recordLastEffect('GIF', () => sendGifEffectAll(giphyId, previewUrl));
  } catch (err) {
    toast(`فشل: ${err.message}`, 'err');
  }
}
el('effectsGifSearchForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = el('effectsGifSearchInput').value.trim();
  const grid = clearNode(el('effectsGifResults'));
  const empty = el('effectsGifEmpty');
  if (!q) return;
  const history = getGifSearchHistory().filter((h) => h !== q);
  history.unshift(q);
  localStorage.setItem('gifSearchHistory', JSON.stringify(history.slice(0, 8)));
  empty.style.display = 'block';
  empty.textContent = 'بندوّر…';
  try {
    const { results } = await api(`/api/gif/search?q=${encodeURIComponent(q)}`);
    empty.style.display = results.length ? 'none' : 'block';
    empty.textContent = 'مفيش نتائج.';
    results.forEach((g) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gif-result';
      btn.title = g.title || 'بث الـGIF ده على الكل';
      const img = document.createElement('img');
      img.src = g.preview;
      img.alt = g.title || '';
      btn.appendChild(img);
      btn.addEventListener('click', () => sendGifEffectAll(g.id, g.preview));
      grid.appendChild(btn);
    });
  } catch (err) {
    empty.style.display = 'block';
    empty.textContent = `تعذّر البحث: ${err.message}`;
  }
});

// ---------------- مفتاح Giphy API (إعدادات) ----------------
async function loadGiphyKey() {
  try {
    const { key } = await api('/api/settings/giphy-key');
    el('giphyKeyInput').value = key || '';
    el('giphyKeyStatus').textContent = key ? 'مفتاح متسجّل.' : 'لسه مفيش مفتاح متسجّل — بحث الـGIF مش هيشتغل من غيره.';
  } catch { /* اختياري */ }
}
el('giphyKeyForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = el('giphyKeyInput').value.trim();
  try {
    await api('/api/settings/giphy-key', { method: 'POST', body: { key } });
    toast(key ? 'اتحفظ مفتاح Giphy' : 'اتشال مفتاح Giphy', 'ok');
    el('giphyKeyStatus').textContent = key ? 'مفتاح متسجّل.' : 'لسه مفيش مفتاح متسجّل — بحث الـGIF مش هيشتغل من غيره.';
  } catch (err) { toast(`فشل الحفظ: ${err.message}`, 'err'); }
});
el('giphyKeyRevealBtn')?.addEventListener('click', () => {
  const input = el('giphyKeyInput');
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  el('giphyKeyRevealBtn').setAttribute('aria-pressed', String(reveal));
});
el('reactionClose').addEventListener('click', () => { el('reactionModal').hidden = true; });
el('reactionModal').addEventListener('click', (e) => { if (e.target.id === 'reactionModal') el('reactionModal').hidden = true; });

function updateReactionComposerPreview() {
  const composer = document.querySelector('.reaction-composer');
  const input = el('reactionCustomInput');
  const preview = el('reactionTextPreview');
  const font = el('reactionFontSelect');
  const color = el('reactionColorInput');
  if (!composer || !input || !preview || !font || !color) return;
  composer.dataset.font = font.value;
  composer.style.setProperty('--reaction-text-color', color.value);
  preview.textContent = input.value || 'اكتب كلمة لتظهر هنا';
}

function insertReactionEmoji(emoji) {
  const input = el('reactionCustomInput');
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const isBlock = emoji.includes('\n');
  const prefix = isBlock && start > 0 && input.value[start - 1] !== '\n' ? '\n' : '';
  const suffix = isBlock && end < input.value.length && input.value[end] !== '\n' ? '\n' : '';
  input.setRangeText(`${prefix}${emoji}${suffix}`, start, end, 'end');
  input.focus();
  updateReactionComposerPreview();
}

function renderReactionEmojiKeyboard() {
  const keyboard = el('reactionEmojiKeyboard');
  if (!keyboard || keyboard.childElementCount) return;
  const comboMatrix = document.createElement('div');
  comboMatrix.className = 'emoji-combo-matrix emoji-combo-matrix--keyboard';
  comboMatrix.setAttribute('role', 'group');
  comboMatrix.setAttribute('aria-label', 'كومبوهات إيموجي جاهزة للكتابة');
  renderEmojiComboMatrix(comboMatrix, insertReactionEmoji, 'إدخال');
  keyboard.appendChild(comboMatrix);
  keyboard.appendChild(createEmojiComboToggle());
  for (const emoji of EMOJIS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.emoji = emoji;
    button.dataset.comboAction = 'إدخال';
    button.textContent = emoji;
    button.addEventListener('click', () => insertReactionEmoji(state.emojiComboMode ? buildEmojiCombo(emoji) : emoji));
    keyboard.appendChild(button);
  }
  syncEmojiComboControls();
}

el('reactionCustomInput').addEventListener('input', updateReactionComposerPreview);
el('reactionFontSelect').addEventListener('change', updateReactionComposerPreview);
el('reactionColorInput').addEventListener('input', updateReactionComposerPreview);
el('reactionEmojiToggle').addEventListener('click', () => {
  const keyboard = el('reactionEmojiKeyboard');
  const isOpen = !keyboard.hidden;
  keyboard.hidden = isOpen;
  el('reactionEmojiToggle').setAttribute('aria-expanded', String(!isOpen));
  if (!isOpen) renderReactionEmojiKeyboard();
});
renderReactionEmojiKeyboard();

el('reactionCustomForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = el('reactionCustomInput').value.trim();
  if (val) sendReaction(val);
});
el('reactionFiftyHeartsBtn').addEventListener('click', () => sendReaction(FIFTY_HEARTS_REACTION));
el('reactionComboBtn').addEventListener('click', async () => {
  const combo = EMOJIS.sort(() => Math.random() - 0.5).slice(0, 3);
  for (const e of combo) {
    await sendReaction(e);
    el('reactionModal').hidden = false; // sendReaction بتقفل المودال، بنفتحه تاني لحد ما الكومبو يخلص
    await new Promise((r) => setTimeout(r, 500));
  }
  el('reactionModal').hidden = true;
});
async function sendReaction(value) {
  const u = state.currentReactionUser;
  if (!u) return;
  if (blockedByReadOnly()) { el('reactionModal').hidden = true; return; }
  if (u.isAll && blockedByBroadcastCooldown()) { el('reactionModal').hidden = true; return; }
  if (u.isAll) startBroadcastCooldown();
  try {
    if (u.isAll) {
      const { results } = await api('/api/action/reaction-all', { method: 'POST', body: { value } });
      if (!results.length) {
        toast('رياكت جماعي: مفيش حد في الغرفة دلوقتي', 'err');
      } else {
        const ok = results.filter((r) => r.ok).length;
        toast(`رياكت جماعي: نجح ${ok}/${results.length}`, ok === results.length ? 'ok' : 'err');
      }
    } else {
      await api(`/api/action/user/${u.user_id}/reaction`, { method: 'POST', body: { value } });
      toast('اتبعت الرياكت', 'ok');
    }
  } catch (err) {
    toast(`فشل: ${err.message}`, 'err');
  }
  el('reactionModal').hidden = true;
}

// ---------------- قوالب الرياكت ----------------
async function loadPresets() {
  const { list } = await api('/api/presets');
  state.presets = list;
  renderPresetRow(el('presetRow'), sendReaction);
  renderPresetChips();
}
function renderPresetChips() {
  const render = (containerId) => {
    const ul = clearNode(el(containerId));
    state.presets.forEach((p) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = p.value;
      li.appendChild(label);
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.addEventListener('click', async () => { await api(`/api/presets/${p.id}`, { method: 'DELETE' }); loadPresets(); });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  };
  render('presetSettingsList');
  render('presetModalList');
}
async function addPreset(value) {
  if (!value) return;
  await api('/api/presets', { method: 'POST', body: { value } });
  loadPresets();
}
el('presetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  addPreset(el('presetInput').value.trim());
  el('presetInput').value = '';
});
el('presetFormModal').addEventListener('submit', (e) => {
  e.preventDefault();
  addPreset(el('presetInputModal').value.trim());
  el('presetInputModal').value = '';
});
el('managePresetsBtn').addEventListener('click', () => { el('presetsModal').hidden = false; });
el('presetsModalClose').addEventListener('click', () => { el('presetsModal').hidden = true; });
el('presetsModal').addEventListener('click', (e) => { if (e.target.id === 'presetsModal') el('presetsModal').hidden = true; });

// ---------------- الإعدادات: VIP / Blacklist ----------------
function renderChipList(containerId, items, deleteBase) {
  const ul = clearNode(el(containerId));
  items.forEach((item) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = item.value;
    li.appendChild(label);
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', async () => {
      await api(`${deleteBase}/${item.id}`, { method: 'DELETE' });
      loadLists();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}
async function loadLists() {
  const vip = await api('/api/vip'); renderChipList('vipList', vip.list, '/api/vip');
  state.vipCache = vip.list;
  const bl = await api('/api/blacklist'); renderChipList('blacklistList', bl.list, '/api/blacklist');
  state.blacklistCache = bl.list;
  const pr = await api('/api/protected'); renderChipList('protectedList', pr.list, '/api/protected');
  const mb = await api('/api/modbackup'); renderChipList('modBackupList', mb.list, '/api/modbackup');
  renderShiftsList();
  const sc = await api('/api/schedule');
  const ul = clearNode(el('scheduleList'));
  sc.list.forEach((item) => {
    const li = document.createElement('li');
    li.dataset.at = item.at;
    setSafeHTML(li, `<span>${item.type} — ${new Date(item.at).toLocaleTimeString('ar-EG')} (<span class="countdown">${scheduleCountdownText(item.at)}</span>)</span>`);
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', async () => { await api(`/api/schedule/${item.id}`, { method: 'DELETE' }); loadLists(); });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}
el('vipForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = el('vipInput').value.trim();
  if (!v) return;
  await api('/api/vip', { method: 'POST', body: { value: v } });
  el('vipInput').value = '';
  loadLists();
});
el('blacklistForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = el('blacklistInput').value.trim();
  if (!v) return;
  await api('/api/blacklist', { method: 'POST', body: { value: v } });
  el('blacklistInput').value = '';
  loadLists();
});
el('modBackupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = el('modBackupInput').value.trim();
  if (!v) return;
  await api('/api/modbackup', { method: 'POST', body: { value: v } });
  el('modBackupInput').value = '';
  loadLists();
});
el('protectedForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = el('protectedInput').value.trim();
  if (!v) return;
  await api('/api/protected', { method: 'POST', body: { value: v } });
  el('protectedInput').value = '';
  loadLists();
});
el('scheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = el('scheduleType').value;
  const time = el('scheduleTime').value;
  if (!time || !state.channel) return toast('لازم تكون متصل بغرفة وتحدد وقت', 'err');
  if (blockedByReadOnly()) return;
  const [h, m] = time.split(':').map(Number);
  const at = new Date(); at.setHours(h, m, 0, 0);
  if (at.getTime() < Date.now()) at.setDate(at.getDate() + 1);
  const body = { type, at: at.toISOString(), channel: state.channel };
  if (type === 'reaction-all') body.value = el('scheduleReactionValue').value.trim() || '🎉';
  await api('/api/schedule', { method: 'POST', body });
  loadLists();
  toast('تمت الجدولة', 'ok');
});

// ---------------- الأرشيف والسجل ----------------
let lastArchives = [];
function getArchiveTags() { try { return JSON.parse(localStorage.getItem('archiveTags') || '{}'); } catch { return {}; } }
async function loadArchiveAndAudit() {
  const arc = await api('/api/archive');
  lastArchives = arc.list;
  renderArchiveList();

  const audit = await api('/api/audit-log');
  const auditList = clearNode(el('auditList'));
  audit.list.slice(0, 50).forEach((a) => {
    const div = document.createElement('div');
    div.className = 'audit-item';
    setSafeHTML(div, `<span>${a.action} ${a.targetName ? '— ' + a.targetName : ''}</span><span class="meta">${new Date(a.time).toLocaleTimeString('ar-EG')}</span>`);
    auditList.appendChild(div);
  });
  renderRecentBulkActions();
}
function renderArchiveList() {
  const list = clearNode(el('archiveList'));
  const q = (el('archiveFilterInput')?.value || '').trim().toLowerCase();
  const tags = getArchiveTags();
  const filtered = q ? lastArchives.filter((a) => a.file.toLowerCase().includes(q) || new Date(a.modified).toLocaleString('ar-EG').toLowerCase().includes(q)) : lastArchives;
  el('archiveEmpty').style.display = filtered.length ? 'none' : 'block';
  filtered.forEach((a) => {
    const div = document.createElement('div');
    div.className = 'archive-item';
    div.style.cursor = 'pointer';
    setSafeHTML(div, `<span>${tags[a.file] ? `${tags[a.file]} — ` : ''}${a.file}</span><span class="meta">${new Date(a.modified).toLocaleString('ar-EG')}</span>`);
    div.addEventListener('click', () => openArchiveDetail(a.file));
    list.appendChild(div);
  });
}
el('archiveFilterInput')?.addEventListener('input', renderArchiveList);

let currentArchiveFile = null;
async function openArchiveDetail(file) {
  currentArchiveFile = file;
  el('archiveDetailPanel').hidden = false;
  el('archiveDetailTitle').textContent = file;
  const body = el('archiveDetailBody');
  clearNode(body).textContent = 'بنجيب التفاصيل…';
  try {
    const { archive: a } = await api(`/api/archive/${encodeURIComponent(file)}`);
    const attendees = Object.values(a.attendees || {});
    const durationMin = a.endTime ? Math.round((new Date(a.endTime) - new Date(a.startTime)) / 60000) : null;
    const auditForRoom = (await api('/api/audit-log')).list.filter((x) => x.channel === a.channel).slice(0, 20);
    const tags = getArchiveTags();
    setSafeHTML(body, `
      <table class="kbd-table">
        <tr><td>الموضوع</td><td>${a.topic || '—'}</td></tr>
        <tr><td>عدد الحضور</td><td>${attendees.length}</td></tr>
        <tr><td>أعلى مستمعين / متكلمين</td><td>${a.peakListeners ?? '—'} / ${a.peakSpeakers ?? '—'}</td></tr>
        <tr><td>المدة</td><td>${durationMin !== null ? durationMin + ' دقيقة' : 'لسه شغالة أو غير معروفة'}</td></tr>
      </table>
      <div class="inline-form" style="margin-top:10px">
        <input type="text" id="archiveTagInput" placeholder="Tag (مقابلة، ترفيه...)" value="${tags[file] || ''}" style="flex:1" />
        <button class="btn btn--sm" id="saveArchiveTagBtn">حفظ التاگ</button>
        <button class="btn btn--sm" id="deleteArchiveBtn" style="border-color:var(--danger);color:var(--danger)">🗑 حذف الأرشيف</button>
      </div>
      <h4 style="font-size:.8rem;color:var(--fg-muted);margin:12px 0 6px">الحضور (${attendees.length})</h4>
      <div class="user-list">${attendees.slice(0, 50).map((u) => `<div class="user-row"><div class="user-avatar">${(u.name || '?').slice(0, 1).toUpperCase()}</div><div class="user-name">${u.name || u.username || ''}</div></div>`).join('')}</div>
      <h4 style="font-size:.8rem;color:var(--fg-muted);margin:12px 0 6px">أكشنات مسجّلة لنفس الغرفة</h4>
      <div class="audit-list">${auditForRoom.map((x) => `<div class="audit-item"><span>${x.action} ${x.targetName ? '— ' + x.targetName : ''}</span><span class="meta">${new Date(x.time).toLocaleTimeString('ar-EG')}</span></div>`).join('') || '<p class="empty-hint">مفيش أكشنات مسجّلة.</p>'}</div>
    `);
    el('saveArchiveTagBtn').addEventListener('click', () => {
      const t = getArchiveTags();
      const val = el('archiveTagInput').value.trim();
      if (val) t[file] = val; else delete t[file];
      localStorage.setItem('archiveTags', JSON.stringify(t));
      toast('اتحفظ التاگ', 'ok');
      renderArchiveList();
    });
    el('deleteArchiveBtn').addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'حذف سجل الأرشيف', description: 'سيُحذف ملف الأرشيف المحلي نهائيًا.', target: file, result: 'فقد بيانات هذه الجلسة من الأرشيف', confirmLabel: 'حذف الأرشيف' }))) return;
      await api(`/api/archive/${encodeURIComponent(file)}`, { method: 'DELETE' });
      toast('اتمسح الأرشيف', 'ok');
      el('archiveDetailPanel').hidden = true;
      loadArchiveAndAudit();
    });
  } catch (err) {
    setSafeHTML(body, `<p class="empty-hint">تعذّر تحميل التفاصيل: ${err.message}</p>`);
  }
}
el('closeArchiveDetail')?.addEventListener('click', () => { el('archiveDetailPanel').hidden = true; });
el('printArchiveBtn')?.addEventListener('click', () => {
  const w = window.open('', '_blank');
  if (!w) return toast('المتصفح منع نافذة الطباعة', 'err');
  const printDocument = w.document;
  printDocument.documentElement.dir = 'rtl';
  printDocument.documentElement.lang = 'ar';
  printDocument.title = el('archiveDetailTitle').textContent;
  const style = printDocument.createElement('style');
  style.textContent = 'body{font-family:system-ui,sans-serif;direction:rtl;padding:32px;color:#101828}h1{font-size:22px}table{width:100%;border-collapse:collapse}td{padding:8px;border-bottom:1px solid #d0d5dd}';
  const heading = printDocument.createElement('h1');
  heading.textContent = el('archiveDetailTitle').textContent;
  const content = el('archiveDetailBody').cloneNode(true);
  printDocument.head.appendChild(style);
  printDocument.body.replaceChildren(heading, content);
  w.focus();
  w.print();
});

// ---------------- الرسم البياني ----------------
function drawChart() {
  const canvas = el('statsChart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const data = state.history;
  if (data.length < 2) return;
  const max = Math.max(1, ...data.map((d) => d.all));
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = h - (h * i) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(245,158,11,.35)');
  grad.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (d.all / max) * (h - 10) - 5;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (d.all / max) * (h - 10) - 5;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  const last = data[data.length - 1];
  const lx = w, ly = h - (last.all / max) * (h - 10) - 5;
  ctx.fillStyle = '#F59E0B';
  ctx.shadowColor = '#F59E0B'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(lx - 4, ly, 4, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}

// ---------------- السجل الحي ----------------
let allLogLines = []; // { text, kind, method } - محفوظة كاملة للفلترة/التصدير حتى لو مش معروضة
let errorTextCounts = {};
function hashColor(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 60%)`;
}
function pushLog(text, kind = '') {
  if (el('logPauseToggle')?.checked) return;
  const method = /^(→|←)\s+(GET|POST|DELETE)/.exec(text)?.[2] || '';
  if (kind === 'err') {
    errorTextCounts[text] = (errorTextCounts[text] || 0) + 1;
  }
  allLogLines.push({ text, kind, method });
  if (allLogLines.length > 1000) allLogLines.shift();
  renderLogLine(text, kind, method);
}
function renderLogLine(text, kind, method) {
  const box = el('logConsole');
  const q = (el('logSearchInput')?.value || '').trim().toLowerCase();
  const filter = el('logFilterSelect')?.value || 'all';
  if (q && !text.toLowerCase().includes(q)) return;
  if (filter === 'ok' && kind === 'err') return;
  if (filter === 'err' && kind !== 'err') return;
  if (filter === 'get' && method !== 'GET') return;
  if (filter === 'post' && method !== 'POST') return;
  const line = document.createElement('div');
  const repeated = kind === 'err' && errorTextCounts[text] > 1;
  line.className = `log-line ${kind}`;
  if (method) line.style.borderInlineStart = `3px solid ${hashColor(text.split(' ').slice(0, 3).join(' '))}`;
  const compact = el('logCompactToggle')?.checked;
  line.textContent = (repeated ? `(×${errorTextCounts[text]}) ` : '') + (compact ? text.slice(0, 90) : text);
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 300) box.removeChild(box.firstChild);
}
function rerenderLog() {
  const box = clearNode(el('logConsole'));
  allLogLines.slice(-300).forEach((l) => renderLogLine(l.text, l.kind, l.method));
}
['logSearchInput', 'logFilterSelect', 'logCompactToggle'].forEach((id) => {
  el(id)?.addEventListener('input', rerenderLog);
  el(id)?.addEventListener('change', rerenderLog);
});
el('exportLogBtn')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/log/export');
    if (!res.ok) throw new Error('تعذر تصدير السجل');
    downloadBlob(await res.text(), 'modpanel-log.jsonl', 'text/plain');
    toast('اتصدّر السجل الكامل المتاح بعد إخفاء بيانات الدخول', 'ok');
  } catch (err) { toast(err.message, 'err'); }
});
el('clearLogBtn')?.addEventListener('click', () => {
  allLogLines = []; errorTextCounts = {};
  clearNode(el('logConsole'));
  toast('اتمسح السجل', 'ok');
});
let allTimeLatencySum = 0, allTimeLatencyCount = 0;

// ---------------- SSE ----------------
function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => renderState(JSON.parse(e.data)));
  es.addEventListener('hand-raise', (e) => {
    const u = JSON.parse(e.data);
    queueRaiseCounts.set(u.user_id, (queueRaiseCounts.get(u.user_id) || 0) + 1);
    toast(`${u.name || u.username || u.user_id} أرسل طلب تحدث`, 'ok');
    beep();
    desktopNotify('رفع إيد جديد', `${u.name || u.username || u.user_id} رفع إيده في الغرفة`);
  });
  es.addEventListener('room-ended', () => {
    toast('الغرفة خلصت أو اتقفلت', 'err');
    state.channel = null;
    state.roomReady = false;
    setActionButtonsEnabled(false);
    syncRoomPickerAction({ connected: false });
    setConnDot(false);
    updateLiveRoomStage({ connected: false });
  });
  es.addEventListener('auto-action', (e) => {
    const d = JSON.parse(e.data);
    toast(`أوتوموديريشن (${d.type}): ${d.user.name || d.user.user_id}`, 'ok');
  });
  es.addEventListener('auto-action-error', (e) => {
    const d = JSON.parse(e.data);
    pushLog(`auto-action error: ${d.error}`, 'err');
  });
  es.addEventListener('schedule-executed', () => toast('اتنفذت مهمة مجدولة', 'ok'));
  es.addEventListener('schedule-error', () => toast('فشلت مهمة مجدولة', 'err'));
  es.addEventListener('operation', (e) => renderOperationProgress(JSON.parse(e.data)));
  for (const eventName of ['room-chat-changed', 'room-chat-deleted', 'room-chat-liked', 'room-chat-auto-error', 'operation']) {
    es.addEventListener(eventName, (e) => window.dispatchEvent(new CustomEvent(`modpanel:${eventName}`, { detail: JSON.parse(e.data) })));
  }
  es.addEventListener('mod-alert', (e) => { const d = JSON.parse(e.data); handleModAlert(d); });
  es.addEventListener('notification', (e) => { handleNewNotification(JSON.parse(e.data)); });
  es.addEventListener('log', (e) => {
    const d = JSON.parse(e.data);
    if (d.kind === 'request') pushLog(`→ ${d.method || 'POST'} ${d.path} [${d.time || ''} #${d.requestId || ''}] ${JSON.stringify(d.body)}`);
    if (d.kind === 'response') {
      if (d.status === 429 && ['/emoji_reaction', '/gif_reaction'].includes(d.path)) startBroadcastCooldown(d.retryAfterMs || 180000);
      pushLog(`← ${d.status} ${d.method || ''} ${d.path} (${d.ms}ms) [${d.time || ''} #${d.requestId || ''}] ${JSON.stringify(d.body).slice(0, 300)} — الرد الكامل في تصدير السجل`, d.status >= 400 ? 'err' : 'ok');
      trackLatency(d.ms);
    }
    if (d.kind === 'error') pushLog(`✕ ${d.path}: ${d.error}`, 'err');
  });
  es.onerror = () => { /* المتصفح بيحاول يعيد الاتصال تلقائي */ };
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.05;
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 180);
  } catch { /* تجاهل لو المتصفح مانعش الصوت */ }
}

// ---------------- اختصارات الكيبورد (تعمل لما النافذة دي بالفوكس بس) ----------------
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (el('paletteBackdrop').hidden) openPalette(); else el('paletteBackdrop').hidden = true;
    return;
  }
  // منقفلش الاختصارات وانت بتكتب في أي خانة نصية - حتى لو الاختصار المخصّص فيه موديفاير،
  // أحسن ما نتدخل في الكتابة العادية (زي Ctrl+A تحديد كل النص جوه الخانة)
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (matchesShortcut('shortcutMute', e)) { e.preventDefault(); runBulk('/api/action/mute-all', 'كتم الكل'); }
  else if (matchesShortcut('shortcutInvite', e)) { e.preventDefault(); runBulk('/api/action/invite-all', 'رفع الكل'); }
  else if (matchesShortcut('shortcutLower', e)) { e.preventDefault(); runBulk('/api/action/lower-all', 'إنزال الجميع'); }
});

// ================================================================
// ==================  مميزات إضافية (دفعة كبيرة)  =================
// ================================================================

// ---------------- ملاحظات خاصة لكل شخص (محلي) ----------------
function getNote(userId) { try { return JSON.parse(localStorage.getItem('notes') || '{}')[userId] || ''; } catch { return ''; } }
function setNote(userId, text) {
  const all = (() => { try { return JSON.parse(localStorage.getItem('notes') || '{}'); } catch { return {}; } })();
  if (text) all[userId] = text; else delete all[userId];
  localStorage.setItem('notes', JSON.stringify(all));
}

// ---------------- فلترة/ترتيب الأعضاء ----------------
// ملحوظة: دي بتعرض بس قايمة الأعضاء - متعملش renderState() الكاملة من هنا،
// عشان مش نلوّث تاريخ الحضور (الجراف) بنقطة جديدة كل ما المستخدم يكتب حرف في خانة الفلترة.
function applyMemberFilterSort(list) {
  const q = (el('memberFilterInput')?.value || '').trim().toLowerCase();
  let out = q ? list.filter((u) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(q)) : list.slice();
  if (el('memberNewOnlyToggle')?.checked) out = out.filter((u) => state.seenUserIds && !state.seenUserIds.has(u.user_id));
  const sortBy = el('memberSortSelect')?.value;
  if (sortBy === 'name') out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (sortBy === 'time') out.sort((a, b) => new Date(a.time_joined_as_speaker || 0) - new Date(b.time_joined_as_speaker || 0));
  return out;
}
el('memberNewOnlyToggle')?.addEventListener('change', () => {
  if (state.lastState) renderMemberLists(state.lastState.speakers || [], state.lastState.listeners || []);
});
function getRoomMemberActionSets() {
  const caps = state.capabilities || {};
  const speakerActions = [
    ...(caps.can_mute_speakers ? [{ icon: 'mute', title: 'كتم الميكروفون', run: (u) => userAction(u.user_id, 'mute') }] : []),
    ...(caps.can_remove_speakers ? [{ icon: 'down', title: 'نقل إلى الجمهور', run: (u) => userAction(u.user_id, 'lower') }] : []),
    ...(caps.can_remove_speakers ? [{ icon: 'shield', title: 'طرد من الغرفة', run: async (u) => {
      if (await confirmAction({ title: 'طرد عضو من الغرفة', description: `سيُزال ${u.name || u.user_id} من الغرفة الحالية.`, target: u.name || `#${u.user_id}`, result: 'الخروج الفوري من الغرفة', confirmLabel: 'طرد العضو' })) userAction(u.user_id, 'kick');
    } }] : []),
    ...(state.myRole === 'moderator' ? [{ icon: 'crown', title: 'ترقية إلى مودريتور', run: async (u) => {
      if (u.is_moderator) return toast('هو مودريتور أصلاً', 'ok');
      if (await confirmAction({ title: 'منح صلاحية مودريتور', description: 'سيتمكن العضو من إدارة المسرح والأعضاء حسب صلاحيات Clubhouse.', target: u.name || `#${u.user_id}`, result: 'ترقية داخل الغرفة الحالية', confirmLabel: 'منح الصلاحية', tone: 'warning' })) userAction(u.user_id, 'promote');
    } }, { icon: 'down', title: 'إلغاء صلاحية مودريتور', run: async (u) => {
      if (!u.is_moderator) return toast('هو مش مودريتور أصلاً', 'ok');
      if (await confirmAction({ title: 'إلغاء صلاحية مودريتور', description: 'هذا العقد لم يُثبت لايف بعد؛ ستُعرض نتيجة Clubhouse الفعلية بعد التنفيذ.', target: u.name || `#${u.user_id}`, result: 'محاولة إزالة صلاحية الإشراف الحالية', confirmLabel: 'إلغاء الصلاحية', tone: 'warning' })) userAction(u.user_id, 'demote');
    } }] : []),
  ];
  const listenerActions = [
    ...(caps.can_edit_handraise_queue ? [{ icon: 'mic', title: 'دعوة إلى المسرح', run: (u) => userAction(u.user_id, 'invite') }] : []),
    ...(caps.can_remove_speakers ? [{ icon: 'shield', title: 'طرد من الغرفة', run: async (u) => {
      if (await confirmAction({ title: 'طرد عضو من الغرفة', description: `سيُزال ${u.name || u.user_id} من الغرفة الحالية.`, target: u.name || `#${u.user_id}`, result: 'الخروج الفوري من الغرفة', confirmLabel: 'طرد العضو' })) userAction(u.user_id, 'kick');
    } }] : []),
  ];
  const selectable = !!(caps.can_mute_speakers || caps.can_remove_speakers);
  return { speakerActions, listenerActions, selectable };
}

function renderMemberInspector(user, actionsList, zone = 'stage') {
  const content = clearNode(el('memberInspectorContent'));
  const empty = el('memberInspectorEmpty');
  if (!content || !empty) return;
  state.inspectedMemberId = user?.user_id ?? null;
  empty.hidden = !!user;
  content.hidden = !user;
  document.querySelectorAll('.stage-command-deck .member-card').forEach((card) => {
    const selected = String(card.dataset.userId) === String(state.inspectedMemberId);
    card.classList.toggle('is-inspected', selected);
    card.setAttribute('aria-current', selected ? 'true' : 'false');
  });
  if (!user) return;

  const hero = document.createElement('div');
  hero.className = 'member-inspector-hero';
  const avatar = document.createElement('div');
  avatar.className = 'member-inspector-avatar';
  const photoUrl = user.photo_url || user.photoUrl;
  if (photoUrl) {
    const image = document.createElement('img');
    image.src = photoUrl; image.alt = '';
    image.addEventListener('error', () => { image.remove(); avatar.textContent = (user.name || '?').slice(0, 1); }, { once: true });
    avatar.appendChild(image);
  } else avatar.textContent = (user.name || '?').trim().slice(0, 1).toUpperCase();
  const identity = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = user.name || user.username || `#${user.user_id}`;
  const handle = document.createElement('p');
  handle.textContent = user.username ? `@${user.username}` : `User ID ${user.user_id}`;
  identity.append(title, handle);
  hero.append(avatar, identity);

  const facts = document.createElement('div');
  facts.className = 'member-inspector-facts';
  const joinedAt = user.time_joined_as_speaker ? new Date(user.time_joined_as_speaker).getTime() : 0;
  const minutes = joinedAt ? Math.max(0, Math.round((Date.now() - joinedAt) / 60000)) : null;
  const factValues = [
    ['الموقع', user.is_moderator ? 'صف القيادة' : zone === 'stage' ? 'المسرح' : 'الجمهور'],
    ['الإشارة', user.is_speaking === true ? 'يتحدث الآن' : user.is_speaking === false ? 'لا يتحدث' : 'غير متاحة'],
    ['المدة', minutes === null ? 'غير معروفة' : `${minutes} دقيقة`],
  ];
  factValues.forEach(([label, value]) => {
    const fact = document.createElement('span');
    const key = document.createElement('small'); key.textContent = label;
    const val = document.createElement('b'); val.textContent = value;
    fact.append(key, val); facts.appendChild(fact);
  });

  const actionBar = document.createElement('div');
  actionBar.className = 'member-inspector-actions';
  actionsList.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn btn--ghost btn--sm';
    button.append(uiIcon(action.icon || 'more'), document.createTextNode(action.title));
    button.addEventListener('click', () => action.run(user));
    actionBar.appendChild(button);
  });
  const profileButton = document.createElement('button');
  profileButton.type = 'button'; profileButton.className = 'btn btn--ghost btn--sm';
  profileButton.append(uiIcon('profile'), document.createTextNode('الملف الشخصي'));
  profileButton.addEventListener('click', () => openProfilePreview(user.user_id));
  actionBar.appendChild(profileButton);
  content.append(hero, facts, actionBar);
}

function renderMemberLists(speakers, listeners) {
  window.dispatchEvent(new CustomEvent('modpanel:people:before'));
  const { speakerActions, listenerActions, selectable } = getRoomMemberActionSets();
  const filteredSpeakers = applyMemberFilterSort(speakers);
  const moderators = filteredSpeakers.filter((user) => user.is_moderator);
  const stageSpeakers = filteredSpeakers.filter((user) => !user.is_moderator);
  const selectStageMember = (user) => renderMemberInspector(user, speakerActions, 'stage');
  const moderatorsList = clearNode(el('moderatorsList'));
  moderators.forEach((user) => moderatorsList.appendChild(userRow(user, speakerActions, { memberCard: true, zone: 'moderator', badges: memberBadges(user), onSelect: selectStageMember })));
  const speakersList = clearNode(el('speakersList'));
  stageSpeakers.forEach((user) => speakersList.appendChild(userRow(user, speakerActions, { selectable, memberCard: true, zone: 'stage', badges: memberBadges(user), onSelect: selectStageMember })));
  const listenersList = clearNode(el('listenersList'));
  applyMemberFilterSort(listeners).forEach((u) => listenersList.appendChild(userRow(u, listenerActions, { selectable, memberCard: true, zone: 'audience', badges: memberBadges(u) })));
  if (el('moderatorsEmpty')) el('moderatorsEmpty').hidden = moderators.length > 0;
  if (el('stageSeatsEmpty')) el('stageSeatsEmpty').hidden = stageSpeakers.length > 0;
  if (el('stageSignalTruth')) {
    const hasSpeakingSignal = speakers.some((user) => typeof user.is_speaking === 'boolean');
    el('stageSignalTruth').textContent = hasSpeakingSignal ? 'إشارة التحدث الحية متاحة من Clubhouse.' : 'حالة التحدث غير متاحة في هذه الاستجابة؛ لا يتم تخمينها.';
  }
  const inspected = speakers.find((user) => String(user.user_id) === String(state.inspectedMemberId));
  if (inspected) renderMemberInspector(inspected, speakerActions, 'stage');
  else if (speakers.length) renderMemberInspector(speakers[0], speakerActions, 'stage');
  else renderMemberInspector(null, [], 'stage');
  el('bulkBar').hidden = !selectable || state.selectedUsers.size === 0;
  window.dispatchEvent(new CustomEvent('modpanel:people:after', { detail: { zone: 'members' } }));
}
el('memberFilterInput')?.addEventListener('input', () => {
  if (state.lastState) renderMemberLists(state.lastState.speakers || [], state.lastState.listeners || []);
});
el('memberSortSelect')?.addEventListener('change', () => {
  if (state.lastState) renderMemberLists(state.lastState.speakers || [], state.lastState.listeners || []);
});

// ---------------- اختيار متعدد + أكشن جماعي على المحددين ----------------
function updateBulkBar() {
  el('bulkCount').textContent = `${state.selectedUsers.size} متحدد`;
  el('bulkBar').hidden = state.selectedUsers.size === 0;
}
el('bulkClearBtn')?.addEventListener('click', () => {
  state.selectedUsers.clear();
  document.querySelectorAll('.select-chk').forEach((c) => { c.checked = false; });
  updateBulkBar();
});
async function bulkOnSelected(kind, label) {
  if (blockedByReadOnly()) return;
  const users = [...state.selectedUsers.values()];
  if (!users.length) return;
  const results = await Promise.all(users.map((u) => api(`/api/action/user/${u.user_id}/${kind}`, { method: 'POST' }).then(() => true).catch(() => false)));
  const ok = results.filter(Boolean).length;
  toast(`${label} للمحددين: نجح ${ok}/${users.length}`, ok === users.length ? 'ok' : 'err');
  if (ok) burstSuccess();
  state.selectedUsers.clear();
  updateBulkBar();
}
el('bulkMuteBtn')?.addEventListener('click', () => bulkOnSelected('mute', 'كتم'));
el('bulkLowerBtn')?.addEventListener('click', () => bulkOnSelected('lower', 'إنزال'));
el('bulkReactBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  const value = await inputAction({ title: 'إرسال تفاعل للمحددين', description: `سيُرسل التفاعل إلى ${state.selectedUsers.size} عضو.`, label: 'التفاعل (رمز أو كلمة)', value: '👏' });
  if (!value) return;
  const users = [...state.selectedUsers.values()];
  const results = await Promise.all(users.map((u) => api(`/api/action/user/${u.user_id}/reaction`, { method: 'POST', body: { value } }).then(() => true).catch(() => false)));
  toast(`رياكت للمحددين: نجح ${results.filter(Boolean).length}/${users.length}`, 'ok');
  state.selectedUsers.clear(); updateBulkBar();
});
el('bulkNoteBtn')?.addEventListener('click', async () => {
  const note = await inputAction({ title: 'ملاحظة جماعية محلية', description: `ستُحفظ الملاحظة محليًا على ${state.selectedUsers.size} عضو ولن تُرسل إلى Clubhouse.`, label: 'الملاحظة', placeholder: 'اكتب ملاحظة تشغيلية' });
  if (note === null || !note.trim()) return;
  state.selectedUsers.forEach((u) => setNote(u.user_id, note.trim()));
  toast('اتضافت الملاحظة للمحددين', 'ok');
  if (state.lastState) renderMemberLists(state.lastState.speakers || [], state.lastState.listeners || []);
});
el('exportMembersCsvBtn')?.addEventListener('click', () => {
  const s = state.lastState;
  if (!s) return toast('مفيش جلسة متصلة دلوقتي', 'err');
  const rows = [['الاسم', 'اليوزرنيم', 'الدور'],
    ...(s.speakers || []).map((u) => [u.name || '', u.username || '', u.is_moderator ? 'مودريتور' : 'متكلم']),
    ...(s.listeners || []).map((u) => [u.name || '', u.username || '', 'مستمع'])];
  downloadBlob(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'modpanel-members.csv', 'text/csv');
  toast('اتصدّر CSV', 'ok');
});

// ---------------- أطول متكلمين (Top Talkers) ----------------
function renderTopTalkers(speakers) {
  const list = el('topTalkersList'); if (!list) return;
  clearNode(list);
  const withDuration = speakers
    .filter((u) => u.time_joined_as_speaker)
    .map((u) => ({ u, mins: Math.max(0, Math.round((Date.now() - new Date(u.time_joined_as_speaker).getTime()) / 60000)) }))
    .sort((a, b) => b.mins - a.mins)
    .slice(0, 5);
  el('topTalkersEmpty').style.display = withDuration.length ? 'none' : 'block';
  withDuration.forEach(({ u, mins }) => {
    const row = userRow(u, []);
    const duration = document.createElement('span');
    duration.className = 'pill';
    duration.textContent = `${mins} د`;
    row.querySelector('.user-name').append(' ', duration);
    list.appendChild(row);
  });
  if (withDuration.length) {
    el('topTalkerBadge').hidden = false;
    el('topTalkerBadge').replaceChildren(uiIcon('crown'), document.createTextNode(` ${withDuration[0].u.name || ''}`));
  }
}

// ---------------- صحة الغرفة ----------------
function renderRoomHealth(speakers, listeners) {
  if (!el('healthRatio')) return;
  const ratio = speakers.length ? (listeners.length / speakers.length).toFixed(1) : '—';
  el('healthRatio').textContent = `${ratio} مستمع لكل متكلم`;
  el('healthPeak').textContent = state.peakAll || '—';
  if (state.connectedAt) {
    const mins = Math.round((Date.now() - state.connectedAt) / 60000);
    el('healthDuration').textContent = mins < 1 ? 'أقل من دقيقة' : `${mins} دقيقة`;
  }
}

// ---------------- بريدكرمب + مؤشر جودة الاتصال ----------------
function updateBreadcrumb(s) {
  const activeTab = document.querySelector('.nav-item.active')?.querySelector('span:not(.nav-icon):not(.nav-badge)')?.textContent || '';
  el('breadcrumbText').textContent = s?.connected ? `${activeTab} — ${s.topic || state.channel}` : activeTab;
  el('connQuality').classList.toggle('good', !!s?.connected);
}

// ---------------- غرف زُرتها مؤخراً ----------------
function rememberRecentRoom(channel, topic) {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem('recentRooms') || '[]'); } catch { /* ignore */ }
  recent = recent.filter((r) => r.channel !== channel);
  recent.unshift({ channel, topic: topic || channel, t: Date.now() });
  recent = recent.slice(0, 8);
  localStorage.setItem('recentRooms', JSON.stringify(recent));
  renderRecentRooms();
}
function renderRecentRooms() {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem('recentRooms') || '[]'); } catch { /* ignore */ }
  el('recentRoomsWrap').hidden = recent.length === 0;
  const row = clearNode(el('recentRoomsRow'));
  recent.forEach((r) => {
    const chip = document.createElement('button');
    chip.className = 'preset-chip';
    chip.textContent = r.topic || r.channel;
    chip.addEventListener('click', () => connectToChannel(r.channel, r.topic));
    row.appendChild(chip);
  });
}

// ---------------- رياكت نجاح متحرك ----------------
function burstSuccess() {
  const el2 = document.createElement('div');
  el2.className = 'success-burst';
  el2.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 8; i += 1) {
    const bar = document.createElement('span');
    bar.style.setProperty('--burst-index', String(i));
    el2.appendChild(bar);
  }
  document.body.appendChild(el2);
  setTimeout(() => el2.remove(), 900);
}

// ---------------- أزرار المشاركة (بيانات موجودة أصلاً - مفيش نداء جديد) ----------------
function copyToClipboard(text, label) {
  navigator.clipboard?.writeText(text).then(() => toast(`${label} اتنسخ`, 'ok')).catch(() => toast('تعذّر النسخ', 'err'));
}
el('backToHallwayBtn')?.addEventListener('click', () => {
  loadHallway();
  switchTab('hallway');
});
el('shareRoomBtn')?.addEventListener('click', () => {
  const url = state.lastState?.raw?.url;
  if (url) copyToClipboard(url, 'رابط الغرفة'); else toast('لسه مفيش رابط', 'err');
});
el('shareHouseBtn')?.addEventListener('click', () => {
  const url = currentHouse?.url || currentHouse?.share_url;
  if (url) copyToClipboard(url, 'رابط الهاوس'); else toast('لسه مفيش رابط', 'err');
});

// ---------------- مايكروز ----------------
el('macroInterviewBtn')?.addEventListener('click', async () => {
  await api('/api/action/handraise-lock', { method: 'POST', body: { locked: true } }).catch(() => {});
  await runBulk('/api/action/mute-all', 'وضع مقابلة');
  el('handraiseLockToggle').checked = true;
});
el('macroCleanBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  const nonModSpeakers = (state.lastState?.speakers || []).filter((u) => !u.is_moderator);
  if (!nonModSpeakers.length) return toast('كل السبيكرز مودريتورز أصلاً', 'ok');
  const results = await Promise.all(nonModSpeakers.map((u) => api(`/api/action/user/${u.user_id}/lower`, { method: 'POST' }).then(() => true).catch(() => false)));
  toast(`تنظيف الغرفة: نزّلنا ${results.filter(Boolean).length}/${nonModSpeakers.length}`, 'ok');
});
el('macroRecordSceneBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  await api('/api/action/handraise-lock', { method: 'POST', body: { locked: true } }).catch(() => {});
  await api('/api/action/room-messages', { method: 'POST', body: { enabled: false } }).catch(() => {});
  await runBulk('/api/action/mute-all', 'مشهد بدء تسجيل');
  el('handraiseLockToggle').checked = true;
  el('roomMessagesToggle').checked = false;
});

// ---------------- مشاهد (Presets) إعدادات محفوظة بالاسم ----------------
function getScenePresets() { try { return JSON.parse(localStorage.getItem('scenePresets') || '{}'); } catch { return {}; } }
function renderScenePresets() {
  const ul = el('scenePresetsList'); if (!ul) return;
  const presets = getScenePresets();
  clearNode(ul);
  Object.keys(presets).forEach((name) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.append(uiIcon('sliders'), document.createTextNode(` ${name}`));
    li.appendChild(label);
    const applyBtn = document.createElement('button');
    applyBtn.textContent = '▶'; applyBtn.title = 'تطبيق';
    applyBtn.addEventListener('click', async () => {
      if (blockedByReadOnly()) return;
      const settings = presets[name];
      for (const [key, value] of Object.entries(settings)) await api('/api/settings', { method: 'POST', body: { [key]: value } });
      toast(`اتطبّق مشهد "${name}"`, 'ok');
      loadSettings();
    });
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => { const p = getScenePresets(); delete p[name]; localStorage.setItem('scenePresets', JSON.stringify(p)); renderScenePresets(); });
    li.appendChild(applyBtn); li.appendChild(delBtn);
    ul.appendChild(li);
  });
}
el('saveScenePresetBtn')?.addEventListener('click', async () => {
  const name = el('scenePresetName').value.trim();
  if (!name) return toast('اكتب اسم للمشهد الأول', 'err');
  const settings = await api('/api/settings');
  const presets = getScenePresets();
  presets[name] = settings;
  localStorage.setItem('scenePresets', JSON.stringify(presets));
  el('scenePresetName').value = '';
  toast(`اتحفظ مشهد "${name}"`, 'ok');
  renderScenePresets();
});

// ---------------- Widgets إضافية في التحكم السريع ----------------
function renderQuickWidgets() {
  const s = state.lastState; if (!s) return;
  const list = el('quickTopTalkersList');
  if (list) {
    clearNode(list);
    (s.speakers || []).filter((u) => u.time_joined_as_speaker)
      .map((u) => ({ u, mins: Math.round((Date.now() - new Date(u.time_joined_as_speaker).getTime()) / 60000) }))
      .sort((a, b) => b.mins - a.mins).slice(0, 3)
      .forEach(({ u, mins }) => {
        const row = document.createElement('div');
        row.className = 'user-row';
        setSafeHTML(row, `<div class="user-avatar">${(u.name || '?').slice(0, 1).toUpperCase()}</div><div class="user-name">${u.name || u.user_id} <span class="pill">${mins} د</span></div>`);
        list.appendChild(row);
      });
  }
}
async function renderRecentBulkActions() {
  const list = el('quickRecentBulkList'); if (!list) return;
  try {
    const { list: audit } = await api('/api/audit-log');
    const bulkActions = audit.filter((a) => ['mute', 'lower', 'invite', 'kick', 'reaction'].includes(a.action)).slice(0, 5);
    clearNode(list);
    bulkActions.forEach((a) => {
      const div = document.createElement('div');
      div.className = 'audit-item';
      setSafeHTML(div, `<span>${a.action} — ${a.targetName || ''}</span><span class="meta">${new Date(a.time).toLocaleTimeString('ar-EG')}</span>`);
      list.appendChild(div);
    });
  } catch { /* اختياري */ }
}

// ---------------- وضع الطوارئ ----------------
function updatePanicButtonVisibility(speakers, listeners, caps) {
  const btn = el('panicBtn'); if (!btn) return;
  const blacklist = state.blacklistCache || [];
  const everyone = [...speakers, ...listeners];
  const flagged = everyone.filter((u) => blacklist.some((b) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(String(b.value).toLowerCase())));
  btn.hidden = !(caps.can_mute_speakers && flagged.length > 0);
  btn.dataset.flaggedIds = JSON.stringify(flagged.map((u) => u.user_id));
}
el('panicBtn')?.addEventListener('click', async () => {
  const flagged = JSON.parse(el('panicBtn').dataset.flaggedIds || '[]');
  if (!(await confirmAction({ title: 'تشغيل وضع الطوارئ', description: 'سيُغلق طلب التحدث ويُكتم كل المتحدثين ثم يُطرد كل عضو حاضر من القائمة السوداء.', target: `${flagged.length} عضو محظور حاليًا`, result: 'ثلاثة إجراءات غرفة متتالية وفورية', confirmLabel: 'تشغيل الطوارئ' }))) return;
  await api('/api/action/handraise-lock', { method: 'POST', body: { locked: true } }).catch(() => {});
  await api('/api/action/mute-all', { method: 'POST' }).catch(() => {});
  for (const id of flagged) await api(`/api/action/user/${id}/kick`, { method: 'POST' }).catch(() => {});
  toast('اتفعّل وضع الطوارئ', 'ok');
});

// ---------------- شكل اللوحة: لون مميز / وضع مضغوط ----------------
el('accentPicker')?.addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--accent', e.target.value);
  localStorage.setItem('accentColor', e.target.value);
});
el('densityToggle')?.addEventListener('change', (e) => {
  document.body.classList.toggle('density-compact', e.target.checked);
  localStorage.setItem('densityCompact', e.target.checked ? '1' : '');
});

// ---------------- تنبيهات سطح مكتب حقيقية ----------------
el('desktopNotifToggle')?.addEventListener('change', async (e) => {
  if (typeof Notification === 'undefined') { e.target.checked = false; return toast('المتصفح ده مش بيدعم إشعارات سطح المكتب', 'err'); }
  if (e.target.checked) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { e.target.checked = false; return toast('محتاجين إذن الإشعارات من المتصفح', 'err'); }
    localStorage.setItem('desktopNotif', '1');
    toast('التنبيهات الحقيقية اتفعّلت', 'ok');
  } else {
    localStorage.removeItem('desktopNotif');
  }
});
function desktopNotify(title, body) {
  if (typeof Notification !== 'undefined' && localStorage.getItem('desktopNotif') && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

// ---------------- اختصارات مخصّصة ----------------
const SHORTCUT_IDS = { shortcutMute: 'mute-all', shortcutInvite: 'invite-all', shortcutLower: 'lower-all' };
function loadShortcuts() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('shortcuts') || '{}'); } catch { return {}; } })();
  for (const id of Object.keys(SHORTCUT_IDS)) if (saved[id]) el(id).value = saved[id];
}
Object.keys(SHORTCUT_IDS).forEach((id) => {
  const input = el(id); if (!input) return;
  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (['Control', 'Alt', 'Shift'].includes(e.key)) return; // لسه مستني حرف/رقم فعلي مع الموديفاير
    if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
      return toast('لازم الاختصار يتضمن Ctrl أو Alt أو Shift — عشان مايتعارضش مع الكتابة العادية', 'err');
    }
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl'); if (e.altKey) parts.push('Alt'); if (e.shiftKey) parts.push('Shift');
    parts.push(e.key.toUpperCase());
    const combo = parts.join('+');
    input.value = combo;
    const saved = (() => { try { return JSON.parse(localStorage.getItem('shortcuts') || '{}'); } catch { return {}; } })();
    saved[id] = combo;
    localStorage.setItem('shortcuts', JSON.stringify(saved));
    toast('اتغيّر الاختصار', 'ok');
  });
});
function matchesShortcut(id, e) {
  const combo = el(id).value.split('+');
  const key = combo[combo.length - 1];
  const needCtrl = combo.includes('Ctrl'), needAlt = combo.includes('Alt'), needShift = combo.includes('Shift');
  return e.ctrlKey === needCtrl && e.altKey === needAlt && e.shiftKey === needShift && e.key.toUpperCase() === key;
}

// ---------------- تصدير CSV / تقرير الجلسة ----------------
function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
el('exportAuditCsvBtn')?.addEventListener('click', async () => {
  const { list } = await api('/api/audit-log');
  const rows = [['الوقت', 'الأكشن', 'المستهدف', 'القيمة'], ...list.map((a) => [a.time, a.action, a.targetName || '', a.value || ''])];
  downloadBlob(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'modpanel-audit-log.csv', 'text/csv');
  toast('اتصدّر CSV', 'ok');
});
el('exportSessionBtn')?.addEventListener('click', () => {
  const s = state.lastState;
  if (!s) return toast('مفيش جلسة متصلة دلوقتي', 'err');
  const lines = [
    `تقرير جلسة Clubhouse mod by Darhous`,
    `الغرفة: ${s.topic || state.channel}`,
    `الوقت: ${new Date().toLocaleString('ar-EG')}`,
    `عدد الحضور الحالي: ${s.numAll}`,
    `أعلى حضور: ${state.peakAll}`,
    `متكلمون: ${(s.speakers || []).length} | مستمعون: ${(s.listeners || []).length}`,
    `مدة الاتصال: ${state.connectedAt ? Math.round((Date.now() - state.connectedAt) / 60000) + ' دقيقة' : '—'}`,
  ];
  downloadBlob(lines.join('\n'), 'modpanel-session-report.txt', 'text/plain');
  toast('اتصدّر تقرير الجلسة', 'ok');
});

// ---------------- فلترة أعضاء الهاوس والرسائل ----------------
el('houseMemberFilter')?.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#houseMembersList .user-row').forEach((row) => {
    row.style.display = row.querySelector('.user-name').textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});
el('chatFilterInput')?.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#chatsList .chat-list-item').forEach((row) => {
    row.style.display = row.querySelector('.user-name').textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

// ---------------- متحدثون مقترحون ----------------
async function loadSuggestedSpeakers() {
  const list = el('suggestedSpeakersList'); if (!list) return;
  try {
    const { users } = await api('/api/suggested-speakers');
    clearNode(list);
    el('suggestedSpeakersEmpty').style.display = users.length ? 'none' : 'block';
    const caps = state.capabilities || {};
    users.forEach((u) => list.appendChild(userRow(u, caps.can_edit_handraise_queue
      ? [{ icon: 'mic', title: 'دعوة إلى المسرح', run: (u) => userAction(u.user_id, 'invite') }]
      : [])));
  } catch { /* اختياري - تجاهل لو فشل */ }
}

// ---------------- قبول/رفض طلبات الرسائل ----------------
function dmRequestActions(chatId) {
  return [
    { icon: 'check', title: 'قبول', run: async () => { if (blockedByReadOnly()) return; await api(`/api/chats/requests/${chatId}/accept`, { method: 'POST' }).catch((e) => toast(e.message, 'err')); loadChats('requests'); } },
    { icon: 'close', title: 'رفض', run: async () => {
      if (blockedByReadOnly()) return;
      await api(`/api/chats/requests/${chatId}/hide`, { method: 'POST' }).catch((e) => toast(e.message, 'err'));
      const archived = getRejectedRequests(); if (!archived.includes(chatId)) { archived.push(chatId); localStorage.setItem('rejectedRequests', JSON.stringify(archived)); }
      loadChats('requests');
    } },
  ];
}
function getRejectedRequests() { try { return JSON.parse(localStorage.getItem('rejectedRequests') || '[]'); } catch { return []; } }

// ---------------- تثبيت/حذف/تصدير/بحث داخل محادثة ----------------
function getPinnedChats() { try { return JSON.parse(localStorage.getItem('pinnedChats') || '[]'); } catch { return []; } }
function getChatLastViewed() { try { return JSON.parse(localStorage.getItem('chatLastViewed') || '{}'); } catch { return {}; } }
function isChatUnread(c) {
  const viewed = getChatLastViewed();
  if (!c.time_updated) return false;
  const last = viewed[c.chat_id];
  return !last || new Date(c.time_updated).getTime() > last;
}
let currentChatMessages = [];
el('pinChatBtn')?.addEventListener('click', () => {
  if (!currentChatId) return;
  const pinned = getPinnedChats();
  const idx = pinned.indexOf(currentChatId);
  if (idx >= 0) { pinned.splice(idx, 1); toast('اتشال التثبيت', 'ok'); } else { pinned.push(currentChatId); toast('اتثبتت المحادثة', 'ok'); }
  localStorage.setItem('pinnedChats', JSON.stringify(pinned));
});
el('deleteChatBtn')?.addEventListener('click', async () => {
  if (!currentChatId || blockedByReadOnly()) return;
  if (!(await confirmAction({ title: 'حذف المحادثة', description: 'سيُرسل أمر حذف المحادثة الحالية.', target: el('chatThreadTitle').textContent || 'المحادثة الحالية', result: 'إزالة المحادثة من الرسائل', confirmLabel: 'حذف المحادثة' }))) return;
  try {
    await api(`/api/chats/${currentChatId}`, { method: 'DELETE' });
    toast('اتمسحت المحادثة', 'ok');
    el('backToChatsBtn').click();
    loadChats(currentChatLoc);
  } catch (err) { toast(`فشل: ${err.message}`, 'err'); }
});
el('exportChatBtn')?.addEventListener('click', () => {
  if (!currentChatMessages.length) return toast('مفيش رسائل لتصديرها', 'err');
  const lines = currentChatMessages.map((m) => `${m.sender_user_profile_id === myUserId ? 'أنا' : el('chatThreadTitle').textContent}: ${m.message_data?.message_body || ''}`);
  downloadBlob(lines.join('\n'), 'modpanel-chat-export.txt', 'text/plain');
  toast('اتصدّرت المحادثة', 'ok');
});
el('chatSearchInput')?.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#chatMessages .chat-bubble').forEach((b) => {
    b.style.display = !q || b.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

// ---------------- الشريط الجانبي القابل للطي ----------------
el('sidebarCollapseBtn')?.addEventListener('click', () => {
  const collapsed = el('sidebar').classList.toggle('collapsed');
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '');
});

// ---------------- لوحة الأوامر (Ctrl+K) ----------------
function paletteItems() {
  const items = [];
  document.querySelectorAll('.nav-item').forEach((b) => {
    items.push({ label: b.textContent.trim(), hint: 'تبويب', action: () => switchTab(b.dataset.tab) });
  });
  (lastHouses || []).forEach((h) => items.push({ label: h.name, hint: 'هاوس', action: () => { switchTab('houses'); openHouseDetail(h); } }));
  (lastHallwayRooms || []).forEach((r) => items.push({ label: r.topic || r.channel, hint: 'غرفة مباشرة', action: () => connectToChannel(r.channel, r.topic) }));
  return items;
}
function openPalette() {
  el('paletteBackdrop').hidden = false;
  el('paletteInput').value = '';
  el('paletteInput').focus();
  renderPaletteResults(paletteItems());
}
function renderPaletteResults(items) {
  const box = clearNode(el('paletteResults'));
  items.slice(0, 30).forEach((it, i) => {
    const row = document.createElement('div');
    row.className = `palette-item${i === 0 ? ' active' : ''}`;
    setSafeHTML(row, `<span>${it.label}</span><span class="k">${it.hint}</span>`);
    row.addEventListener('click', () => { it.action(); el('paletteBackdrop').hidden = true; });
    box.appendChild(row);
  });
}
el('paletteOpenBtn')?.addEventListener('click', openPalette);
el('paletteBackdrop')?.addEventListener('click', (e) => { if (e.target.id === 'paletteBackdrop') el('paletteBackdrop').hidden = true; });
el('paletteInput')?.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  const items = paletteItems().filter((it) => it.label.toLowerCase().includes(q));
  renderPaletteResults(items);
});
el('paletteInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = el('paletteResults').querySelector('.palette-item');
    first?.click();
  }
  if (e.key === 'Escape') el('paletteBackdrop').hidden = true;
});

// ---------------- سجل التنبيهات ----------------
state.toastHistory = [];
function renderHistoryDrawer() {
  const d = el('historyDrawer');
  setSafeHTML(d, state.toastHistory.length
    ? state.toastHistory.slice(0, 30).map((h) => `<div class="history-item h-${h.kind === 'ok' ? 'ok' : h.kind === 'err' ? 'err' : ''}"><span class="h-dot" aria-hidden="true"></span><span>${new Date(h.time).toLocaleTimeString('ar-EG')} — ${h.text}</span></div>`).join('')
    : '<div class="history-item">مفيش تنبيهات لسه</div>');
}
el('toastHistoryBtn')?.addEventListener('click', () => {
  const d = el('historyDrawer');
  d.hidden = !d.hidden;
  if (!d.hidden) {
    renderHistoryDrawer();
    const badge = el('notifUnreadBadge');
    if (badge) { badge.hidden = true; badge.textContent = '0'; }
  }
});

// ================================================================
// ==================  20 ميزة جديدة (دفعة تانية)  =================
// ================================================================

// ---------------- معاينة بروفايل أي حد (بضغطة) + متابعون مشتركون ----------------
async function openProfilePreview(userId) {
  el('profilePreviewModal').hidden = false;
  const body = el('profilePreviewBody');
  clearNode(body).textContent = 'بنجيب البيانات…';
  try {
    const [{ profile: p }, mutualRes] = await Promise.all([
      api(`/api/profile/view/${userId}`),
      api(`/api/social/mutual/${userId}`).catch(() => ({ users: [] })),
    ]);
    const mutual = mutualRes.users || [];
    let history = { total: 0, counts: {} };
    try { history = await api(`/api/user-history/${userId}`); } catch { /* اختياري */ }
    const historyLabels = { mute: 'كتم', kick: 'طرد', lower: 'إنزال', 'promote-moderator': 'ترقية', 'demote-moderator': 'إلغاء ترقية', 'auto-blacklist': 'قايمة سودة تلقائي' };
    const historyChips = Object.entries(history.counts)
      .filter(([action]) => historyLabels[action])
      .map(([action, count]) => `<span class="pill ${action === 'kick' || action === 'mute' ? 'pill--danger' : ''}">${historyLabels[action]} ×${count}</span>`)
      .join(' ');
    const firstSeenLine = history.firstSeen
      ? `أول تفاعل مسجّل في Clubhouse mod by Darhous: ${new Date(history.firstSeen).toLocaleDateString('ar-EG')} <span class="ltr-num" style="opacity:.7">(من سجل الأكشنات المحلي، مش تاريخ انضمام Clubhouse)</span>`
      : 'مفيش سجل تفاعل محلي مع الشخص ده لسه.';
    setSafeHTML(body, `
      <div class="house-card" style="align-items:flex-start;margin-bottom:10px">
        <img class="house-photo" src="${p.photo_url || ''}" style="width:56px;height:56px;border-radius:50%">
        <div class="house-info">
          <div class="house-name">${p.name || ''}</div>
          <div class="house-meta">@${p.username || ''}</div>
          <div class="house-meta">${p.num_followers ?? 0} متابع · ${p.num_following ?? 0} متابَع</div>
        </div>
      </div>
      <div id="profilePreviewActions" class="user-actions" style="justify-content:flex-start;margin-bottom:10px"></div>
      ${p.bio ? `<p class="hint" style="white-space:pre-wrap">${p.bio}</p>` : ''}
      <p class="hint">${firstSeenLine}</p>
      ${historyChips ? `<div class="card-head" style="margin-top:10px"><h3 style="font-size:.9rem">سجل تراكمي عبر كل الغرف</h3></div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">${historyChips}</div>` : ''}
      <div class="card-head" style="margin-top:10px"><h3 style="font-size:.9rem">متابعون مشتركون (${mutual.length})</h3></div>
      <div id="profilePreviewMutual" class="user-list"></div>
    `);
    buildPersonActionButtons({ user_id: userId, name: p.name, username: p.username, viewer_follow_status: p.viewer_follow_status }, el('profilePreviewActions'));
    const list = el('profilePreviewMutual');
    if (!mutual.length) setSafeHTML(list, '<p class="empty-hint">مفيش متابعين مشتركين.</p>');
    mutual.slice(0, 10).forEach((u) => list.appendChild(socialUserRow(u)));
  } catch (err) {
    setSafeHTML(body, `<p class="empty-hint">تعذّر تحميل البروفايل: ${err.message}</p>`);
  }
}
el('profilePreviewClose')?.addEventListener('click', () => { el('profilePreviewModal').hidden = true; });
el('profilePreviewModal')?.addEventListener('click', (e) => { if (e.target.id === 'profilePreviewModal') el('profilePreviewModal').hidden = true; });

// ---------------- اكتشف أشخاص / مقترحات دعوة / المحظورون ----------------
async function loadDiscover() {
  const list = clearNode(el('discoverList'));
  el('discoverEmpty').style.display = 'block';
  try {
    const { users } = await api('/api/social/discover');
    el('discoverEmpty').style.display = users.length ? 'none' : 'block';
    users.slice(0, 20).forEach((u) => list.appendChild(socialUserRow(u)));
  } catch (err) { el('discoverEmpty').textContent = `تعذّر التحميل: ${err.message}`; }
}
el('refreshDiscoverBtn')?.addEventListener('click', loadDiscover);

async function loadSuggestedInvites() {
  const list = clearNode(el('suggestedInvitesList'));
  try {
    const { users } = await api('/api/social/suggested-invites');
    el('suggestedInvitesEmpty').style.display = users.length ? 'none' : 'block';
    users.slice(0, 20).forEach((u) => list.appendChild(socialUserRow(u)));
  } catch (err) { el('suggestedInvitesEmpty').textContent = `تعذّر التحميل: ${err.message}`; }
}

async function loadBlocked() {
  const list = clearNode(el('blockedList'));
  try {
    const { users } = await api('/api/social/blocked');
    el('blockedEmpty').style.display = users.length ? 'none' : 'block';
    users.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'user-row';
      setSafeHTML(row, `<div class="user-avatar">${(u.name || '?').slice(0, 1).toUpperCase()}</div><div class="user-name">${u.name || u.username}</div><div class="user-actions"></div>`);
      const btn = document.createElement('button');
      btn.className = 'icon-btn'; btn.title = 'فك الحظر'; btn.textContent = '✓ فك الحظر';
      btn.addEventListener('click', async () => {
        if (blockedByReadOnly()) return;
        try { await api(`/api/social/unblock/${u.user_id}`, { method: 'POST' }); toast('اتفك الحظر', 'ok'); loadBlocked(); }
        catch (err) { toast(err.message, 'err'); }
      });
      row.querySelector('.user-actions').appendChild(btn);
      list.appendChild(row);
    });
  } catch (err) { el('blockedEmpty').textContent = `تعذّر التحميل: ${err.message}`; }
}

// ---------------- مغادرة حقيقية من الغرفة على السيرفر ----------------
async function leaveCurrentRoom() {
  if (!state.channel) return toast('مش متصل بغرفة', 'err');
  if (!(await confirmAction({ title: 'مغادرة الغرفة فعليًا', description: 'هذا يختلف عن إيقاف المراقبة: سيُخرج حسابك من الغرفة على Clubhouse.', target: state.lastState?.topic || state.channel, result: 'خروج الحساب وإيقاف جلسة الغرفة الحالية', confirmLabel: 'مغادرة الغرفة' }))) return;
  try {
    await api('/api/channel/leave', { method: 'POST' });
    state.channel = null;
    state.roomReady = false;
    setActionButtonsEnabled(false);
    syncRoomPickerAction({ connected: false });
    setConnDot(false);
    updateLiveRoomStage({ connected: false });
    renderCurrentRoomSurface({ connected: false });
    toast('اتغادرت الغرفة فعلياً', 'ok');
    switchTab('hallway');
  } catch (err) { toast(err.message, 'err'); }
}
el('leaveChannelBtn')?.addEventListener('click', leaveCurrentRoom);
el('leaveCurrentRoomBtn')?.addEventListener('click', leaveCurrentRoom);

// ---------------- رفع جماعي لكل الـ VIP الحاضرين / طرد جماعي للقايمة السودة الحاضرة ----------------
el('inviteAllVipBtn')?.addEventListener('click', () => runBulk('/api/action/invite-all-vip', 'رفع كل الـ VIP الحاضرين'));
el('kickAllBlacklistedBtn')?.addEventListener('click', async () => {
  if (!(await confirmAction({ title: 'طرد الحاضرين من القائمة السوداء', description: 'سيتم تنفيذ أمر طرد على كل عضو محظور موجود الآن.', target: 'أعضاء القائمة السوداء الحاضرون', result: 'الخروج الفوري من الغرفة', confirmLabel: 'طرد المحظورين' }))) return;
  runBulk('/api/action/kick-all-blacklisted', 'طرد القايمة السودة الحاضرة');
});

// ---------------- تكرار آخر أكشن جماعي ----------------
let lastBulkAction = null;
function rememberBulkAction(path, label) {
  lastBulkAction = { path, label };
  const btn = el('repeatLastActionBtn');
  if (!btn) return;
  btn.disabled = false;
  setButtonIconLabel(btn, 'refresh', `كرر: ${label}`);
}
el('repeatLastActionBtn')?.addEventListener('click', () => {
  if (!lastBulkAction) return;
  runBulk(lastBulkAction.path, lastBulkAction.label);
});
const _origRunBulk = runBulk;
runBulk = async function (path, label, body) {
  await _origRunBulk(path, label, body);
  rememberBulkAction(path, label);
};

// ---------------- مؤشر زمن استجابة الـ API الحي ----------------
let latencySamples = [];
function trackLatency(ms) {
  latencySamples.push(ms);
  if (latencySamples.length > 8) latencySamples.shift();
  const avg = Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length);
  const badge = el('latencyBadge');
  if (badge) {
    badge.hidden = false;
    badge.textContent = `${avg}ms`;
    badge.classList.toggle('pill--good', avg < 600);
    badge.classList.toggle('pill--warn', avg >= 600 && avg < 1500);
    badge.classList.toggle('pill--danger', avg >= 1500);
  }
  allTimeLatencySum += ms; allTimeLatencyCount++;
  const logBadge = el('logAvgLatency');
  if (logBadge) logBadge.textContent = `متوسط كل الوقت: ${Math.round(allTimeLatencySum / allTimeLatencyCount)}ms`;
}

// ---------------- وضع "تركيز" (يوقف الأصوات والتنبيهات مؤقتاً) ----------------
let focusModeTimer = null;
el('focusModeBtn')?.addEventListener('click', () => {
  if (focusModeTimer) {
    clearTimeout(focusModeTimer);
    focusModeTimer = null;
    state.focusMode = false;
    el('focusModeBadge').hidden = true;
    setButtonIconLabel(el('focusModeBtn'), 'eye', 'وضع تركيز مؤقت');
    return toast('اتقفل وضع التركيز', 'ok');
  }
  const minutes = Number(el('focusMinutesInput').value) || 10;
  state.focusMode = true;
  el('focusModeBadge').hidden = false;
  el('focusModeBtn').textContent = 'إلغاء وضع التركيز';
  toast(`وضع التركيز شغال ${minutes} دقيقة`, 'ok');
  focusModeTimer = setTimeout(() => {
    state.focusMode = false;
    focusModeTimer = null;
    el('focusModeBadge').hidden = true;
    setButtonIconLabel(el('focusModeBtn'), 'eye', 'وضع تركيز مؤقت');
    toast('خلص وضع التركيز', 'ok');
  }, minutes * 60000);
});
const _origBeep = beep;
beep = function () { if (!state.focusMode) _origBeep(); };
const _origDesktopNotify = desktopNotify;
desktopNotify = function (...args) { if (!state.focusMode) _origDesktopNotify(...args); };

// ---------------- نسخ احتياطي/استرجاع الإعدادات ----------------
const LOCAL_PREF_KEYS = ['shortcuts', 'accentColor', 'densityCompact', 'highContrast', 'fontSize', 'goodColor', 'dangerColor', 'toastDuration', 'watchedKeywords', 'mutedUsers'];
async function buildSettingsBundle() {
  const [vip, blacklist, protectedList, presets, settings] = await Promise.all([
    api('/api/vip'), api('/api/blacklist'), api('/api/protected'), api('/api/presets'), api('/api/settings'),
  ]);
  const localPrefs = {};
  LOCAL_PREF_KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v !== null) localPrefs[k] = v; });
  return { vip: vip.list, blacklist: blacklist.list, protected: protectedList.list, presets: presets.list, settings, localPrefs };
}
async function applySettingsBundle(bundle) {
  for (const item of bundle.vip || []) await api('/api/vip', { method: 'POST', body: { value: item.value } });
  for (const item of bundle.blacklist || []) await api('/api/blacklist', { method: 'POST', body: { value: item.value } });
  for (const item of bundle.protected || []) await api('/api/protected', { method: 'POST', body: { value: item.value } });
  for (const item of bundle.presets || []) await api('/api/presets', { method: 'POST', body: { value: item.value } });
  for (const [key, value] of Object.entries(bundle.settings || {})) await api('/api/settings', { method: 'POST', body: { [key]: value } });
  Object.entries(bundle.localPrefs || {}).forEach(([k, v]) => localStorage.setItem(k, v));
  loadLists(); loadPresets(); loadSettings(); applySavedPrefs();
}
el('exportSettingsBtn')?.addEventListener('click', async () => {
  try {
    const bundle = await buildSettingsBundle();
    downloadBlob(JSON.stringify(bundle, null, 2), 'modpanel-settings-backup.json', 'application/json');
    toast('اتصدّرت الإعدادات', 'ok');
  } catch (err) { toast(err.message, 'err'); }
});
el('importSettingsBtn')?.addEventListener('click', async () => {
  const file = el('importSettingsInput').files[0];
  if (!file) return toast('اختار ملف الأول', 'err');
  try {
    const bundle = JSON.parse(await file.text());
    await applySettingsBundle(bundle);
    toast('اتستوردت الإعدادات', 'ok');
  } catch (err) { toast(`فشل الاستيراد: ${err.message}`, 'err'); }
});

// ---------------- ملفات تعريف الإعدادات (Profiles) ----------------
function getSettingsProfiles() { try { return JSON.parse(localStorage.getItem('settingsProfiles') || '{}'); } catch { return {}; } }
function renderSettingsProfiles() {
  const ul = el('settingsProfilesList'); if (!ul) return;
  const profiles = getSettingsProfiles();
  clearNode(ul);
  Object.keys(profiles).forEach((name) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.append(uiIcon('user'), document.createTextNode(` ${name}`));
    li.appendChild(label);
    const loadBtn = document.createElement('button'); loadBtn.textContent = '▶'; loadBtn.title = 'تحميل';
    loadBtn.addEventListener('click', async () => { await applySettingsBundle(profiles[name]); toast(`اتحمّل ملف "${name}"`, 'ok'); });
    const delBtn = document.createElement('button'); delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => { const p = getSettingsProfiles(); delete p[name]; localStorage.setItem('settingsProfiles', JSON.stringify(p)); renderSettingsProfiles(); });
    li.appendChild(loadBtn); li.appendChild(delBtn);
    ul.appendChild(li);
  });
}
el('saveProfileBtn')?.addEventListener('click', async () => {
  const name = el('profileNameInput').value.trim();
  if (!name) return toast('اكتب اسم لملف التعريف', 'err');
  const bundle = await buildSettingsBundle();
  const profiles = getSettingsProfiles();
  profiles[name] = bundle;
  localStorage.setItem('settingsProfiles', JSON.stringify(profiles));
  el('profileNameInput').value = '';
  toast(`اتحفظ ملف تعريف "${name}"`, 'ok');
  renderSettingsProfiles();
});
el('resetAllSettingsBtn')?.addEventListener('click', async () => {
  if (!(await confirmAction({ title: 'إعادة ضبط إعدادات Clubhouse mod by Darhous', description: 'سيتم مسح الشكل والاختصارات والقوائم المحفوظة محليًا. لن يُرسل أي أمر إلى الغرفة.', target: 'كل بيانات localStorage الخاصة باللوحة', result: 'العودة للإعدادات الافتراضية ثم إعادة التحميل', confirmLabel: 'إعادة الضبط' }))) return;
  localStorage.clear();
  toast('اترجعت كل الإعدادات لوضعها الافتراضي - هنعيد تحميل الصفحة', 'ok');
  setTimeout(() => location.reload(), 1200);
});

// ---------------- سجل تغييرات الإعدادات ----------------
function logSettingsChange(key, value) {
  const log = (() => { try { return JSON.parse(localStorage.getItem('settingsChangeLog') || '[]'); } catch { return []; } })();
  log.unshift({ key, value, t: Date.now() });
  localStorage.setItem('settingsChangeLog', JSON.stringify(log.slice(0, 50)));
  renderSettingsChangeLog();
}
function renderSettingsChangeLog() {
  const list = el('settingsChangeLog'); if (!list) return;
  const log = (() => { try { return JSON.parse(localStorage.getItem('settingsChangeLog') || '[]'); } catch { return []; } })();
  clearNode(list);
  el('settingsChangeLogEmpty').style.display = log.length ? 'none' : 'block';
  log.slice(0, 20).forEach((e) => {
    const div = document.createElement('div');
    div.className = 'audit-item';
    setSafeHTML(div, `<span>${e.key} → ${JSON.stringify(e.value)}</span><span class="meta">${new Date(e.t).toLocaleTimeString('ar-EG')}</span>`);
    list.appendChild(div);
  });
}
const _origSaveSetting = saveSetting;
saveSetting = async function (key, value, msg) {
  await _origSaveSetting(key, value, msg);
  logSettingsChange(key, value);
};

// ---------------- مدة التنبيهات + ألوان مخصصة ----------------
el('toastDurationInput')?.addEventListener('change', (e) => localStorage.setItem('toastDuration', e.target.value));
el('goodColorPicker')?.addEventListener('input', (e) => { document.documentElement.style.setProperty('--good', e.target.value); localStorage.setItem('goodColor', e.target.value); });
el('dangerColorPicker')?.addEventListener('input', (e) => { document.documentElement.style.setProperty('--danger', e.target.value); localStorage.setItem('dangerColor', e.target.value); });

// ---------------- تذكير نسخة احتياطية دورية ----------------
function maybeRemindBackup() {
  const last = Number(localStorage.getItem('lastBackupReminder')) || 0;
  if (Date.now() - last > 1000 * 60 * 60 * 24 * 7) { // كل أسبوع
    localStorage.setItem('lastBackupReminder', String(Date.now()));
    toast('💾 تذكير: كام يوم مضوا من غير نسخة احتياطية للإعدادات - جرّب تصدّرها من الإعدادات', 'ok');
  }
}

// ---------------- تصدير قائمة الحضور الحالية CSV ----------------
el('exportAttendeesCsvBtn')?.addEventListener('click', () => {
  const s = state.lastState;
  if (!s) return toast('مفيش جلسة متصلة دلوقتي', 'err');
  const rows = [['الاسم', 'اليوزرنيم', 'الدور'],
    ...(s.speakers || []).map((u) => [u.name || '', u.username || '', u.is_moderator ? 'مودريتور' : 'متكلم']),
    ...(s.listeners || []).map((u) => [u.name || '', u.username || '', 'مستمع'])];
  downloadBlob(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'modpanel-attendees.csv', 'text/csv');
  toast('اتصدّر CSV الحضور', 'ok');
});

// ---------------- عداد تنازلي مرئي للمهام المجدولة ----------------
function scheduleCountdownText(at) {
  const ms = new Date(at).getTime() - Date.now();
  if (ms <= 0) return 'دلوقتي';
  const mins = Math.round(ms / 60000);
  return mins < 1 ? 'أقل من دقيقة' : `بعد ${mins} دقيقة`;
}
setInterval(() => {
  if (document.hidden) return;
  document.querySelectorAll('#scheduleList [data-at]').forEach((li) => {
    const span = li.querySelector('.countdown');
    if (span) span.textContent = scheduleCountdownText(li.dataset.at);
  });
}, 20000);

// ================================================================
// ============  20 ميزة جديدة (موديريشن الغرفة - دفعة تالتة)  ============
// ================================================================

// ---------------- تجاهل رافع إيد من العرض (محلي) ----------------
function getHiddenQueueIds() { try { return JSON.parse(localStorage.getItem('hiddenQueueIds') || '[]'); } catch { return []; } }
function hideFromQueue(userId, reason) {
  const ids = getHiddenQueueIds();
  if (!ids.includes(userId)) ids.push(userId);
  localStorage.setItem('hiddenQueueIds', JSON.stringify(ids));
  if (reason) {
    const reasons = (() => { try { return JSON.parse(localStorage.getItem('hideReasons') || '{}'); } catch { return {}; } })();
    reasons[userId] = reason;
    localStorage.setItem('hideReasons', JSON.stringify(reasons));
  }
}

// ---------------- تتبّع وقت الانتظار + عدد مرات الرفع لكل شخص (محلي، طول الاتصال الحالي) ----------------
const queueFirstSeen = new Map();
const queueRaiseCounts = new Map();
let manualQueueOrder = [];
let waitTimeSamples = []; // مدة انتظار كل شخص اتقبل من الطابور - لحساب المتوسط
function trackQueuePresence(queue) {
  const nowIds = new Set(queue.map((u) => u.user_id));
  queue.forEach((u) => { if (!queueFirstSeen.has(u.user_id)) queueFirstSeen.set(u.user_id, Date.now()); });
  [...queueFirstSeen.keys()].forEach((id) => { if (!nowIds.has(id)) queueFirstSeen.delete(id); });
}

// ---------------- عرض طابور رفع الإيد (فلترة/ترتيب/تجاهل) — مفصولة عن renderState زي renderMemberLists بالظبط ----------------
function renderQueueList(queue, caps) {
  window.dispatchEvent(new CustomEvent('modpanel:people:before'));
  trackQueuePresence(queue);
  const hidden = getHiddenQueueIds();
  let list = queue.filter((u) => !hidden.includes(u.user_id));
  const q = (el('queueFilterInput')?.value || '').trim().toLowerCase();
  if (q) list = list.filter((u) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(q));
  const sortBy = el('queueSortSelect')?.value;
  if (sortBy === 'oldest') list = list.slice().reverse();
  if (sortBy === 'vip') {
    const vip = state.vipCache || [];
    const isVip = (u) => vip.some((v) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(String(v.value).toLowerCase()));
    list.sort((a, b) => (isVip(b) ? 1 : 0) - (isVip(a) ? 1 : 0));
  }
  if (sortBy === 'manual' && manualQueueOrder.length) {
    list.sort((a, b) => manualQueueOrder.indexOf(a.user_id) - manualQueueOrder.indexOf(b.user_id));
  }
  const threshold = Number(el('longWaitThreshold')?.value) || 5;
  const queueList = clearNode(el('queueList'));
  list.forEach((u, i) => {
    const waitMs = Date.now() - (queueFirstSeen.get(u.user_id) || Date.now());
    const waitMins = Math.floor(waitMs / 60000);
    const raiseCount = queueRaiseCounts.get(u.user_id) || 1;
    const row = userRow(u, [
      ...(sortBy === 'manual' ? [
        { icon: 'join', title: 'تحريك للأعلى', run: () => { reorderManualQueue(u.user_id, -1, list); } },
        { icon: 'down', title: 'تحريك للأسفل', run: () => { reorderManualQueue(u.user_id, 1, list); } },
      ] : []),
      ...(caps.can_edit_handraise_queue ? [{ icon: 'check', title: 'قبول طلب التحدث', run: (u) => { waitTimeSamples.push(waitMs); userAction(u.user_id, 'invite'); } }] : []),
      { icon: 'eye', title: 'تجاهل محليًا', run: async (u) => {
        const reason = (await inputAction({ title: `تجاهل ${u.name || u.user_id} محليًا`, description: 'سيختفي من عرض الطابور في Clubhouse mod by Darhous فقط، ولن يُرسل أي إجراء إلى Clubhouse.', label: 'سبب التجاهل (اختياري)', value: '', placeholder: 'سبب تشغيلي مختصر' })) || '';
        hideFromQueue(u.user_id, reason);
        renderQueueList(state.lastQueue || [], state.capabilities || {});
      } },
    ]);
    const turnCount = (state.lastState?.micTurnCounts || {})[u.user_id];
    const nameSlot = row.querySelector('.user-name');
    const appendQueueBadge = ({ text, kind = '', title = '', icon = '' }) => {
      const badge = document.createElement('span');
      badge.className = `pill${kind ? ` pill--${kind}` : ''} ltr-num`;
      badge.title = title;
      if (icon) badge.appendChild(uiIcon(icon));
      badge.appendChild(document.createTextNode(text));
      nameSlot.append(document.createTextNode(' '), badge);
    };
    appendQueueBadge({ text: `${waitMins} د`, kind: waitMins >= threshold ? 'danger' : '', title: 'وقت الانتظار الحالي' });
    if (raiseCount > 1) appendQueueBadge({ text: `×${raiseCount}`, kind: 'warn', title: 'عدد مرات طلب التحدث' });
    if (turnCount > 1) appendQueueBadge({ text: `×${turnCount}`, title: 'عدد مرات الصعود إلى المسرح', icon: 'mic' });
    if (!state.queueExcluded) state.queueExcluded = new Set();
    const exChk = document.createElement('input');
    exChk.type = 'checkbox';
    exChk.className = 'select-chk';
    exChk.title = 'استثناء من "ادعي الباقي (ماعدا المستثنين)"';
    exChk.checked = state.queueExcluded.has(u.user_id);
    exChk.addEventListener('click', (e) => e.stopPropagation());
    exChk.addEventListener('change', () => {
      if (exChk.checked) state.queueExcluded.add(u.user_id); else state.queueExcluded.delete(u.user_id);
    });
    row.insertBefore(exChk, row.firstChild);
    queueList.appendChild(row);
  });
  el('queueEmpty').style.display = list.length ? 'none' : 'block';
  el('avgWaitTime').textContent = waitTimeSamples.length ? `${Math.round(waitTimeSamples.reduce((a, b) => a + b, 0) / waitTimeSamples.length / 60000)} دقيقة` : '—';
  window.dispatchEvent(new CustomEvent('modpanel:people:after', { detail: { zone: 'queue' } }));
}
el('inviteQueueExceptBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  const excluded = state.queueExcluded || new Set();
  const ids = (state.lastQueue || []).map((u) => u.user_id).filter((id) => !excluded.has(id));
  if (!ids.length) return toast('مفيش حد في الطابور غير مستثنى', 'err');
  if (!(await confirmAction({ title: 'دعوة بقية الطابور', description: `سيتم تجاوز ${excluded.size} عضو مستثنى وإرسال دعوة إلى الباقين.`, target: `${ids.length} طلب تحدث`, result: 'دعوات انتقال إلى المسرح', confirmLabel: 'دعوة الباقين', tone: 'warning' }))) return;
  try {
    const { results } = await api('/api/action/invite-ids', { method: 'POST', body: { ids } });
    toast(`اتدعوا ${results.filter((r) => r.ok).length}/${ids.length}`, 'ok');
  } catch (err) { toast(err.message, 'err'); }
});
el('restoreQueueBackupBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  try {
    const { users } = await api('/api/queue/backup');
    if (!users.length) return toast('مفيش نسخة احتياطية محفوظة لسه', 'err');
    if (!(await confirmAction({ title: 'استعادة نسخة الطابور', description: 'سيتم استخدام آخر نسخة محفوظة وإرسال دعوات التحدث لأعضائها.', target: `${users.length} عضو`, result: 'دعوات انتقال إلى المسرح', confirmLabel: 'استعادة وإرسال', tone: 'warning' }))) return;
    const { results } = await api('/api/action/invite-ids', { method: 'POST', body: { ids: users.map((u) => u.user_id) } });
    toast(`اتدعوا ${results.filter((r) => r.ok).length}/${users.length}`, 'ok');
  } catch (err) { toast(err.message, 'err'); }
});
function reorderManualQueue(userId, dir, currentList) {
  if (!manualQueueOrder.length) manualQueueOrder = currentList.map((u) => u.user_id);
  const idx = manualQueueOrder.indexOf(userId);
  const swapWith = idx + dir;
  if (idx < 0 || swapWith < 0 || swapWith >= manualQueueOrder.length) return;
  [manualQueueOrder[idx], manualQueueOrder[swapWith]] = [manualQueueOrder[swapWith], manualQueueOrder[idx]];
  renderQueueList(state.lastQueue || [], state.capabilities || {});
}
el('queueFilterInput')?.addEventListener('input', () => renderQueueList(state.lastQueue || [], state.capabilities || {}));
el('queueSortSelect')?.addEventListener('change', () => renderQueueList(state.lastQueue || [], state.capabilities || {}));

// ---------------- تنبيه لما الطابور يتجمع ----------------
let queueSpikeFiredFor = 0;
function checkQueueSpike(len) {
  if (!state.queueSpikeEnabled) return;
  const threshold = state.queueSpikeThreshold || 5;
  if (len >= threshold && queueSpikeFiredFor !== len) {
    queueSpikeFiredFor = len;
    toast(`الطابور مزدحم: ${len} طلب تحدث حاليًا`, 'err');
    beep();
    desktopNotify('الطابور اتجمع', `${len} رافعين إيد دلوقتي`);
  }
  if (len < threshold) queueSpikeFiredFor = 0;
}
el('queueSpikeToggle')?.addEventListener('change', (e) => { state.queueSpikeEnabled = e.target.checked; localStorage.setItem('queueSpikeEnabled', e.target.checked ? '1' : ''); });
el('queueSpikeInput')?.addEventListener('change', (e) => { state.queueSpikeThreshold = Number(e.target.value) || 5; localStorage.setItem('queueSpikeThreshold', e.target.value); });

// ---------------- تمييز VIP/قايمة سودة + "دخل أول مرة النهاردة" في قائمة الأعضاء ----------------
function getVisitCounts() { try { return JSON.parse(localStorage.getItem('visitCounts') || '{}'); } catch { return {}; } }
function bumpVisitCounters(users) {
  const counts = getVisitCounts();
  users.forEach((u) => { counts[u.user_id] = (counts[u.user_id] || 0) + 1; });
  localStorage.setItem('visitCounts', JSON.stringify(counts));
}
function memberBadges(u) {
  const name = `${u.name || ''} ${u.username || ''}`.toLowerCase();
  const isVip = (state.vipCache || []).some((v) => name.includes(String(v.value).toLowerCase()));
  const isBlacklisted = (state.blacklistCache || []).some((b) => name.includes(String(b.value).toLowerCase()));
  const isNew = state.seenUserIds && !state.seenUserIds.has(u.user_id);
  const visits = getVisitCounts()[u.user_id] || 0;
  const badges = [];
  if (isVip) badges.push({ kind: 'good', title: 'VIP', icon: 'crown', text: 'VIP' });
  if (isBlacklisted) badges.push({ kind: 'danger', title: 'القائمة السوداء', icon: 'shield', text: 'محظور' });
  if (isNew) badges.push({ kind: 'warn', title: 'دخل أول مرة خلال الاتصال الحالي', text: 'جديد' });
  if (visits > 1) badges.push({ title: 'عدد مرات دخوله غرفك', icon: 'refresh', text: String(visits), ltr: true });
  const turnCount = (state.lastState?.micTurnCounts || {})[u.user_id];
  if (turnCount > 1) badges.push({ title: 'عدد مرات صعوده على الميكروفون في الجلسة', icon: 'mic', text: `×${turnCount}`, ltr: true });
  const cooldownUntil = (state.lastState?.micCooldowns || {})[u.user_id];
  if (cooldownUntil && cooldownUntil > Date.now()) {
    badges.push({ kind: 'warn', title: 'ما زال في فترة تجميد الميكروفون', icon: 'clock', text: `${Math.ceil((cooldownUntil - Date.now()) / 60000)}د`, ltr: true });
  }
  return badges;
}

// ---------------- تفعيل/تعطيل الشات النصي داخل الغرفة ----------------
el('roomMessagesToggle')?.addEventListener('change', async (e) => {
  if (blockedByReadOnly()) { e.target.checked = !e.target.checked; return; }
  try {
    await api('/api/action/room-messages', { method: 'POST', body: { enabled: e.target.checked } });
    toast(e.target.checked ? 'الشات النصي اتفعّل' : 'الشات النصي اتقفل', 'ok');
  } catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
});

// ---------------- إضافة/حذف رابط الغرفة ----------------
el('roomLinkForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const link = el('roomLinkInput').value.trim();
  if (!link || blockedByReadOnly()) return;
  try {
    await api('/api/check-link', { method: 'POST', body: { link } });
    await api('/api/action/room-link', { method: 'POST', body: { link } });
    toast('اتضاف الرابط', 'ok');
    el('roomLinkInput').value = '';
  } catch (err) { toast(`فشل: ${err.message}`, 'err'); }
});
el('removeRoomLinkBtn')?.addEventListener('click', async () => {
  try { await api('/api/action/room-link', { method: 'DELETE' }); toast('اتشال الرابط', 'ok'); }
  catch (err) { toast(err.message, 'err'); }
});

// ---------------- إيموجي بجانب اسمك في الغرفة (عقد مرشح) ----------------
el('channelEmojiForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const emoji = el('channelEmojiInput').value.trim();
  if (!emoji || blockedByReadOnly()) return;
  try {
    await api('/api/action/channel-emoji', { method: 'POST', body: { emoji } });
    toast('اتعيّن الإيموجي', 'ok');
  } catch (err) { toast(`فشل: ${err.message}`, 'err'); }
});
el('channelEmojiClearBtn')?.addEventListener('click', async () => {
  if (blockedByReadOnly()) return;
  try {
    await api('/api/action/channel-emoji/clear', { method: 'POST' });
    el('channelEmojiInput').value = '';
    toast('اتشال الإيموجي', 'ok');
  } catch (err) { toast(`فشل: ${err.message}`, 'err'); }
});

// ---------------- آخر متكلمين + عارضين الريبلاي ----------------
async function loadRecentSpeakers() {
  try {
    const { users } = await api('/api/recent-speakers');
    const list = clearNode(el('recentSpeakersList'));
    el('recentSpeakersEmpty').style.display = users.length ? 'none' : 'block';
    users.slice(0, 20).forEach((u) => list.appendChild(socialUserRow(u)));
  } catch (err) { el('recentSpeakersEmpty').textContent = `تعذّر التحميل: ${err.message}`; }
}
async function loadReplayers() {
  if (!state.channel) return;
  try {
    const { users } = await api('/api/room/replayers');
    const list = clearNode(el('replayersList'));
    el('replayersEmpty').style.display = users.length ? 'none' : 'block';
    users.slice(0, 20).forEach((u) => list.appendChild(socialUserRow(u)));
  } catch (err) { el('replayersEmpty').textContent = `تعذّر التحميل: ${err.message}`; }
}
el('refreshReplayersBtn')?.addEventListener('click', loadReplayers);

// ---------------- رفع أول N من الطابور / كتم غير المودريتورز / نسخ الحضور ----------------
el('inviteNextNBtn')?.addEventListener('click', () => {
  const n = Number(el('inviteNextNInput').value) || 1;
  runBulk('/api/action/invite-next-n', `رفع أول ${n}`, { n });
});
el('muteNonModsBtn')?.addEventListener('click', () => runBulk('/api/action/mute-non-mods', 'كتم غير المودريتورز'));
el('inviteAllListenersBtn')?.addEventListener('click', async () => {
  if (!(await confirmAction({ title: 'دعوة كل الجمهور إلى المسرح', description: 'سيتم إرسال دعوة تحدث إلى كل المستمعين الموجودين الآن.', target: `${state.lastState?.listeners?.length || 0} مستمع`, result: 'دعوات جماعية للانتقال إلى المسرح', confirmLabel: 'دعوة كل الجمهور', tone: 'warning' }))) return;
  runBulk('/api/action/invite-all-listeners', 'دعوة كل المستمعين');
});
el('copyAttendeesBtn')?.addEventListener('click', () => {
  const s = state.lastState;
  if (!s) return toast('مفيش جلسة متصلة دلوقتي', 'err');
  const lines = [
    ...(s.speakers || []).map((u) => `متحدث: ${u.name || u.username || u.user_id}${u.is_moderator ? ' (مودريتور)' : ''}`),
    ...(s.listeners || []).map((u) => `مستمع: ${u.name || u.username || u.user_id}`),
  ];
  copyToClipboard(lines.join('\n'), 'قائمة الحضور');
});

// ---------------- دور تلقائي (event-driven / بتوقيت) ----------------
el('turnRotationToggle')?.addEventListener('change', (e) => saveSetting('turnRotationEnabled', e.target.checked, e.target.checked ? 'الدور التلقائي اتفعّل' : 'اتقفل'));
el('turnRotationTimerInput')?.addEventListener('change', (e) => saveSetting('turnRotationTimerMinutes', Number(e.target.value) || 5, 'اتحفظ توقيت الدور التلقائي'));
el('turnRotationTimerToggle')?.addEventListener('change', (e) => {
  el('turnRotationTimerInput').disabled = !e.target.checked;
  saveSetting('turnRotationTimerEnabled', e.target.checked, e.target.checked ? 'الدور التلقائي بتوقيت اتفعّل' : 'اتقفل');
});

// ---------------- جدولة رياكت جماعي: إظهار خانة القيمة بس لما النوع ده مختار ----------------
el('scheduleType')?.addEventListener('change', (e) => {
  el('scheduleReactionValue').hidden = e.target.value !== 'reaction-all';
});

// ================================================================
// ==============  10 ميزات جديدة (شكل وتجربة استخدام)  ==============
// ================================================================

// ---------------- حجم الخط ----------------
el('fontSizeSlider')?.addEventListener('input', (e) => {
  document.body.style.fontSize = `${e.target.value}px`;
  localStorage.setItem('fontSize', e.target.value);
});

// ---------------- وضع تباين عالي ----------------
el('highContrastToggle')?.addEventListener('change', (e) => {
  document.body.classList.toggle('high-contrast', e.target.checked);
  localStorage.setItem('highContrast', e.target.checked ? '1' : '');
});

// ---------------- حفظ آخر تبويب مفتوح ----------------
const _origSwitchTab = switchTab;
switchTab = function (name) {
  _origSwitchTab(name);
  localStorage.setItem('lastTab', name);
};

// ---------------- شاشة كاملة ----------------
el('fullscreenBtn')?.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => toast('المتصفح رفض وضع الشاشة الكاملة', 'err'));
});

// ---------------- سحب وإفلات لإعادة ترتيب قوالب الرياكت ----------------
function makePresetsDraggable(container) {
  let dragId = null;
  container.querySelectorAll('.preset-chip').forEach((chip, i) => {
    chip.draggable = true;
    chip.dataset.presetId = state.presets[i]?.id;
    chip.addEventListener('dragstart', () => { dragId = chip.dataset.presetId; });
    chip.addEventListener('dragover', (e) => e.preventDefault());
    chip.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetId = chip.dataset.presetId;
      if (!dragId || dragId === targetId) return;
      const order = state.presets.map((p) => p.id);
      const from = order.indexOf(dragId), to = order.indexOf(targetId);
      order.splice(to, 0, order.splice(from, 1)[0]);
      state.presets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      renderPresetRow(el('presetRow'), sendReaction);
      makePresetsDraggable(el('presetRow'));
    });
  });
}
const _origLoadPresets = loadPresets;
loadPresets = async function () {
  await _origLoadPresets();
  makePresetsDraggable(el('presetRow'));
};

// ---------------- وضع قراءة فقط مؤقت ----------------
const REAL_EFFECT_BUTTON_IDS = [
  'muteAllBtn', 'inviteAllBtn', 'lowerAllBtn', 'reactAllBtn', 'reactCurrentBtn', 'inviteAllBtn2', 'endRoomBtn',
  'quietModeBtn', 'inviteNextBtn', 'panicBtn', 'macroInterviewBtn', 'macroCleanBtn', 'leaveChannelBtn',
  'inviteAllVipBtn', 'kickAllBlacklistedBtn', 'inviteNextNBtn', 'muteNonModsBtn', 'removeRoomLinkBtn', 'channelEmojiClearBtn',
  'welcomeAllBtn', 'welcomeAllBtnMembers',
  'inviteAllListenersBtn', 'acceptAllRequestsBtn', 'joinRoomBtn', 'acceptSpeakerInviteBtn',
  'raiseHandBtn', 'moveToAudienceBtn', 'promoteAllBtn', 'leaveCurrentRoomBtn',
  'currentMuteAllBtn', 'currentInviteAllBtn', 'currentLowerAllBtn', 'currentReactAllBtn', 'currentEndRoomBtn',
  'runOperationBtn',
];
function applyReadOnlyMode(enabled, { announce = true } = {}) {
  state.readOnlyMode = !!enabled;
  document.body.classList.toggle('read-only-mode', !!enabled);
  if (el('readOnlyModeToggle')) el('readOnlyModeToggle').checked = !!enabled;
  if (enabled) {
    REAL_EFFECT_BUTTON_IDS.forEach((id) => { const b = el(id); if (b) b.disabled = true; });
  } else {
    REAL_EFFECT_BUTTON_IDS.forEach((id) => { const b = el(id); if (b) b.disabled = false; });
    setActionButtonsEnabled(!!state.roomReady);
    if (state.myRole) applyRoleGating(state.myRole, state.capabilities);
    updateLiveRoomStage(state.lastState || { connected: false });
  }
  if (announce) toast(enabled ? 'وضع القراءة فقط شغال على الواجهة والسيرفر' : 'وضع القراءة فقط اتقفل', 'ok');
}
el('readOnlyModeToggle')?.addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  applyReadOnlyMode(enabled);
  try {
    await api('/api/settings', { method: 'POST', body: { serverReadOnlyMode: enabled } });
  } catch (err) {
    applyReadOnlyMode(!enabled, { announce: false });
    toast(`تعذّر تحديث وضع القراءة فقط على السيرفر: ${err.message}`, 'err');
  }
});

// ---------------- عداد وقت الجلسة ----------------
const sessionStartedAt = Date.now();
setInterval(() => {
  if (document.hidden) return;
  const badge = el('sessionTimerBadge'); if (!badge) return;
  const mins = Math.floor((Date.now() - sessionStartedAt) / 60000);
  const secs = Math.floor(((Date.now() - sessionStartedAt) % 60000) / 1000);
  badge.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
}, 1000);

// ---------------- اختصار طي/فتح الشريط الجانبي (Ctrl+B) ----------------
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    el('sidebarCollapseBtn')?.click();
  }
});

// ---------------- نسخ ملخص سريع للغرفة الحالية ----------------
el('copyRoomSummaryBtn')?.addEventListener('click', () => {
  const s = state.lastState;
  if (!s) return toast('مفيش جلسة متصلة دلوقتي', 'err');
  const summary = `${s.topic || state.channel}\nالمتكلمون: ${(s.speakers || []).length} | المستمعون: ${(s.listeners || []).length} | رافعو الإيد: ${(s.raiseQueue || []).length}\nدورك: ${ROLE_LABELS[state.myRole] || state.myRole}`;
  copyToClipboard(summary, 'ملخص الغرفة');
});

// ================================================================
// ==================  إدارة حسابات جلسة السيرفر  ==================
// ================================================================

async function reloadAllAccountData() {
  window.dispatchEvent(new CustomEvent('modpanel:room-state', { detail: { connected: false } }));
  await loadProfile();
  loadChannels();
  loadedWorkspaces.clear();
  ensureWorkspaceData(state.activeWorkspace);
  // كنا متصلين بغرفة بحساب قديم - الاتصال بيتوقف من السيرفر تلقائي عند التبديل، بنعكس ده هنا كمان
  state.channel = null;
  state.roomReady = false;
  setActionButtonsEnabled(false);
  syncRoomPickerAction({ connected: false });
  setConnDot(false);
}

async function loadAccountStatus() {
  try {
    const status = await api('/api/account/status');
    const info = el('accountCurrentInfo');
    const badge = el('settingsActiveAccountBadge');
    const label = status.user ? `${status.user.name || status.user.username || 'حساب Clubhouse'}${status.user.username ? ` @${status.user.username}` : ''}` : 'لا يوجد حساب';
    if (info) info.textContent = status.user ? `الحساب النشط: ${label} · ${status.mode === 'custom' ? 'جلسة مؤقتة' : 'Clubdeck'}` : 'مفيش حساب نشط دلوقتي.';
    if (badge) badge.textContent = label;
    return status;
  } catch (err) {
    if (el('accountCurrentInfo')) el('accountCurrentInfo').textContent = `تعذّر التحقق: ${err.message}`;
    if (el('settingsActiveAccountBadge')) el('settingsActiveAccountBadge').textContent = 'تعذّر التحقق';
    throw err;
  }
}

function accountInitial(user) { return String(user?.name || user?.username || '?').trim().slice(0, 1).toUpperCase(); }
async function loadAccountsPage() {
  const data = await api('/api/accounts');
  const host = clearNode(el('activeAccountsList'));
  for (const account of data.accounts || []) {
    const card = document.createElement('article'); card.className = `active-account-card${account.active ? ' is-active' : ''}`;
    let avatar;
    if (account.user?.photo_url) { avatar = document.createElement('img'); avatar.src = account.user.photo_url; avatar.alt = ''; avatar.className = 'account-avatar'; }
    else { avatar = document.createElement('span'); avatar.className = 'account-avatar'; avatar.textContent = accountInitial(account.user); }
    const copy = document.createElement('span'); copy.className = 'active-account-copy';
    const name = document.createElement('b'); name.textContent = account.user?.name || 'حساب غير متاح';
    const meta = document.createElement('small'); meta.textContent = `${account.user?.username ? `@${account.user.username}` : 'بدون اسم مستخدم'} · ${account.source === 'clubdeck' ? 'Clubdeck' : 'ذاكرة الجلسة'}`;
    copy.append(name, meta);
    const button = document.createElement('button'); button.type = 'button'; button.className = `btn btn--sm${account.active ? ' btn--ghost' : ''}`; button.textContent = account.active ? 'نشط الآن' : 'استخدام الحساب'; button.disabled = account.active || !account.user;
    button.addEventListener('click', async () => {
      try {
        await api(`/api/accounts/${encodeURIComponent(account.id)}/activate`, { method: 'POST' });
        toast(`تم تفعيل ${account.user?.name || 'الحساب'}`, 'ok');
        await reloadAllAccountData(); await loadAccountsPage();
      } catch (err) { toast(err.message, 'err'); }
    });
    card.append(avatar, copy, button); host.appendChild(card);
  }
  if (!host.childElementCount) host.textContent = 'لا توجد حسابات متاحة في جلسة السيرفر.';
  await loadAccountStatus();
}

function openAccountsWorkspace() { switchTab('accounts'); ensureWorkspaceData('accounts'); }
el('account')?.addEventListener('click', openAccountsWorkspace);
el('openAccountsSettingsBtn')?.addEventListener('click', openAccountsWorkspace);
el('refreshAccountsBtn')?.addEventListener('click', () => loadAccountsPage().catch((err) => toast(err.message, 'err')));
el('tokenLoginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = el('tokenLoginInput').value.trim();
  const username = el('tokenLoginUsername').value.trim();
  try {
    const { user } = await api('/api/account/login-token', { method: 'POST', body: { token, username } });
    toast(`اتسجّل الدخول كـ ${user.name} @${user.username}`, 'ok');
    el('tokenLoginInput').value = '';
    el('tokenLoginUsername').value = '';
    await reloadAllAccountData(); await loadAccountsPage();
  } catch (err) { toast(`فشل الدخول: ${err.message}`, 'err'); }
});
el('phoneAuthStartForm')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const phoneNumber = el('phoneAuthNumber').value.trim();
  const status = el('phoneAuthStatus'); status.textContent = 'جاري طلب كود التحقق…';
  try {
    const { auth } = await api('/api/account/phone/start', { method: 'POST', body: { phoneNumber } });
    if (auth.isBlocked) throw new Error('Clubhouse أوقف محاولات الرقم مؤقتًا');
    el('phoneAuthCompleteForm').hidden = false;
    status.textContent = auth.retryAfter ? `تم إرسال الكود. إعادة المحاولة بعد ${auth.retryAfter} ثانية.` : 'تم طلب الكود. اكتبه لإكمال الجلسة المؤقتة.';
    el('phoneAuthCode').focus();
  } catch (err) { status.textContent = `تعذّر إرسال الكود: ${err.message}`; toast(err.message, 'err'); }
});
el('phoneAuthCompleteForm')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const phoneNumber = el('phoneAuthNumber').value.trim(); const verificationCode = el('phoneAuthCode').value.trim();
  const status = el('phoneAuthStatus'); status.textContent = 'جاري التحقق من الكود…';
  try {
    const { user } = await api('/api/account/phone/complete', { method: 'POST', body: { phoneNumber, verificationCode } });
    status.textContent = `تمت إضافة ${user.name || user.username || 'الحساب'} إلى جلسة السيرفر.`;
    el('phoneAuthNumber').value = ''; el('phoneAuthCode').value = ''; el('phoneAuthCompleteForm').hidden = true;
    await reloadAllAccountData(); await loadAccountsPage();
  } catch (err) { status.textContent = `الكود لم يُقبل: ${err.message}`; toast(err.message, 'err'); }
});

// ================================================================
// ==================  إعادة تنظيم: كل كارت قابل للطي  ==================
// ================================================================

function makeCardsCollapsible() {
  document.querySelectorAll('.card').forEach((card) => {
    const head = card.querySelector(':scope > .card-head');
    if (!head || head.querySelector('.collapse-toggle')) return;
    const heading = head.querySelector('h3');
    const panelId = card.closest('.panel')?.id || card.closest('.modal')?.id || '';
    const key = `collapse:${panelId}:${heading?.textContent.trim() || ''}`;
    const btn = document.createElement('button');
    btn.className = 'collapse-toggle';
    btn.type = 'button';
    btn.title = 'اطوي/افتح القسم';
    btn.textContent = '▾';
    head.insertBefore(btn, head.firstChild);
    if (localStorage.getItem(key) === '1') card.classList.add('collapsed');
    head.addEventListener('click', (e) => {
      if (!e.target.closest('.collapse-toggle') && e.target.closest('button, input, select, textarea, a, label')) return;
      const isCollapsed = card.classList.toggle('collapsed');
      localStorage.setItem(key, isCollapsed ? '1' : '');
    });
  });
}

// ================================================================
// ==================  جولة سابعة: 20 ميزة مودريتور  ==================
// ================================================================

// ---------------- تنبيهات المودريتور المباشرة (SSE) ----------------
const MOD_ALERT_LABELS = {
  'lone-moderator': (d) => `مودريتور وحيد متبقٍ في الغرفة (${d.count})`,
  'capacity-reached': (d) => `👥 الغرفة وصلت للحد الأقصى: ${d.numAll}/${d.max}`,
  'ghost-mic': (d) => `ميكروفون صامت: ${d.user?.name || d.user?.user_id} بلا نشاط منذ ${d.minutes} د`,
  'blacklist-join': (d) => `⛔ حد من القايمة السودة دخل الغرفة: ${d.user?.name || d.user?.user_id}`,
  'welcome-speaker': (d) => `👋 رحّب بسبيكر جديد: ${d.user?.name || d.user?.user_id}`,
};
const MOD_ALERT_DESKTOP_TOGGLE_IDS = {
  'lone-moderator': 'desktopNotifyLoneModeratorToggle',
  'capacity-reached': 'desktopNotifyCapacityToggle',
  'ghost-mic': 'desktopNotifyGhostMicToggle',
  'blacklist-join': 'desktopNotifyBlacklistJoinToggle',
  'welcome-speaker': 'desktopNotifyWelcomeSpeakerToggle',
};
function handleModAlert(d) {
  const build = MOD_ALERT_LABELS[d.type];
  const msg = build ? build(d) : `تنبيه: ${d.type}`;
  toast(msg, d.type === 'welcome-speaker' ? 'ok' : 'err');
  const desktopToggleId = MOD_ALERT_DESKTOP_TOGGLE_IDS[d.type];
  if (desktopToggleId && el(desktopToggleId)?.checked) desktopNotify('تنبيه مشرفين', msg);
  const list = el('modAlertsList');
  if (list) {
    el('modAlertsEmpty').style.display = 'none';
    const div = document.createElement('div');
    div.className = 'audit-item';
    setSafeHTML(div, `<span>${msg}</span><span class="meta ltr-num">${new Date().toLocaleTimeString('ar-EG')}</span>`);
    list.insertBefore(div, list.firstChild);
    while (list.children.length > 30) list.removeChild(list.lastChild);
  }
  const badge = el('advancedBadge');
  if (badge && document.querySelector('.nav-item.active')?.dataset.tab !== 'advanced') {
    badge.hidden = false;
    badge.textContent = String((Number(badge.textContent) || 0) + 1);
  }
}
document.querySelector('[data-tab="advanced"]')?.addEventListener('click', () => {
  const badge = el('advancedBadge'); if (badge) { badge.hidden = true; badge.textContent = '0'; }
});

// ---------------- جدول نوبات المودريتور (تنظيمي محلي، مش متصل بـ Clubhouse) ----------------
function renderShiftsList() {
  api('/api/shifts').then(({ list }) => {
    const ul = el('shiftsList'); if (!ul) return;
    clearNode(ul);
    el('shiftsEmpty').style.display = list.length ? 'none' : 'block';
    list.forEach((item) => {
      const v = item.value || {};
      const li = document.createElement('li');
      setSafeHTML(li, `<span class="ltr-num">${v.day || ''} ${v.start || ''}–${v.end || ''}</span> <span>${v.name || ''}</span>`);
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.addEventListener('click', async () => { await api(`/api/shifts/${item.id}`, { method: 'DELETE' }); renderShiftsList(); });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }).catch(() => {});
}
el('shiftForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('shiftNameInput').value.trim();
  const day = el('shiftDayInput').value;
  const start = el('shiftStartInput').value;
  const end = el('shiftEndInput').value;
  if (!name || !start || !end) return toast('لازم اسم ووقت بداية ونهاية', 'err');
  await api('/api/shifts', { method: 'POST', body: { value: { name, day, start, end } } });
  el('shiftNameInput').value = '';
  toast('اتضافت النوبة', 'ok');
  renderShiftsList();
});

// ---------------- السعة وجدولة إنهاء الغرفة (Curfew) ----------------
el('curfewScheduleBtn')?.addEventListener('click', async () => {
  if (!state.channel) return toast('لازم تكون متصل بغرفة الأول', 'err');
  if (blockedByReadOnly()) return;
  const minutes = Number(el('curfewMinutesInput').value) || 30;
  const at = new Date(Date.now() + minutes * 60000).toISOString();
  try {
    await api('/api/schedule', { method: 'POST', body: { type: 'end-room', at, channel: state.channel } });
    toast(`اتجدول إنهاء الغرفة بعد ${minutes} دقيقة`, 'ok');
    loadLists();
  } catch (err) { toast(err.message, 'err'); }
});

// ---------------- لوحة مراقبة عدة غرف مرة واحدة (قراءة فقط - من غير قطع اتصالك الحالي) ----------------
function getMultiRoomFavorites() { try { return JSON.parse(localStorage.getItem('multiRoomFavorites') || '[]'); } catch { return []; } }
function saveMultiRoomFavorites(list) { localStorage.setItem('multiRoomFavorites', JSON.stringify(list)); }
async function renderMultiRoomGrid() {
  const favorites = getMultiRoomFavorites();
  const grid = el('multiRoomGrid'); if (!grid) return;
  el('multiRoomEmpty').style.display = favorites.length ? 'none' : 'block';
  clearNode(grid);
  for (const channel of favorites) {
    const card = document.createElement('div');
    card.className = 'room-card';
    setSafeHTML(card, '<div class="room-card-topic">جاري التحميل…</div>');
    grid.appendChild(card);
    api(`/api/room/quick-status?channel=${encodeURIComponent(channel)}`).then((s) => {
      setSafeHTML(card, s.ended
        ? `<div class="room-card-topic">${channel}</div><p class="hint" style="margin:0">الغرفة خلصت أو مش موجودة</p>`
        : `<div class="room-card-topic">${s.topic || channel}</div>
           <div class="room-card-meta"><span class="ltr-num">${s.numAll} حاضر · ${s.numSpeakers} متحدث</span></div>`);
      const actions = document.createElement('div');
      actions.style.display = 'flex'; actions.style.gap = '6px';
      const connectBtn = document.createElement('button');
      connectBtn.className = 'btn btn--sm'; setButtonIconLabel(connectBtn, 'monitor', 'اتصل');
      connectBtn.addEventListener('click', () => { el('channelInput').value = channel; el('connectBtn').click(); switchTab('quick'); });
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn--sm'; setButtonIconLabel(removeBtn, 'trash', 'إزالة الغرفة', { iconOnly: true });
      removeBtn.addEventListener('click', () => { saveMultiRoomFavorites(getMultiRoomFavorites().filter((c) => c !== channel)); renderMultiRoomGrid(); });
      actions.appendChild(connectBtn); actions.appendChild(removeBtn);
      card.appendChild(actions);
    }).catch(() => { setSafeHTML(card, `<div class="room-card-topic">${channel}</div><p class="hint" style="margin:0">تعذّر التحميل</p>`); });
  }
}
el('multiRoomForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = el('multiRoomInput').value.trim();
  if (!v) return;
  const favorites = getMultiRoomFavorites();
  if (!favorites.includes(v)) { favorites.push(v); saveMultiRoomFavorites(favorites); }
  el('multiRoomInput').value = '';
  renderMultiRoomGrid();
});

// ---------------- وضع الحدث (Event Mode): مجموعة إعدادات دفعة واحدة، وبيرجّعها زي ما كانت ----------------
el('eventModeToggle')?.addEventListener('change', async (e) => {
  if (blockedByReadOnly()) { e.target.checked = !e.target.checked; return; }
  try {
    if (e.target.checked) {
      const cur = await api('/api/settings');
      localStorage.setItem('eventModeSnapshot', JSON.stringify({
        autoMuteNewSpeakers: cur.autoMuteNewSpeakers,
        speakerCapEnabled: cur.speakerCapEnabled, speakerCap: cur.speakerCap,
        turnRotationTimerEnabled: cur.turnRotationTimerEnabled, turnRotationTimerMinutes: cur.turnRotationTimerMinutes,
      }));
      await api('/api/settings', { method: 'POST', body: { autoMuteNewSpeakers: true } });
      await api('/api/settings', { method: 'POST', body: { speakerCapEnabled: true } });
      await api('/api/settings', { method: 'POST', body: { speakerCap: cur.speakerCap || 8 } });
      await api('/api/settings', { method: 'POST', body: { turnRotationTimerEnabled: true } });
      toast('🎪 وضع الحدث اتفعّل — كتم تلقائي + سقف سبيكرز + دور بالتايمر', 'ok');
      loadSettings();
    } else {
      const snap = JSON.parse(localStorage.getItem('eventModeSnapshot') || 'null');
      if (snap) {
        for (const [key, value] of Object.entries(snap)) await api('/api/settings', { method: 'POST', body: { [key]: value } });
      }
      toast('🎪 وضع الحدث اتقفل — رجّعنا الإعدادات القديمة', 'ok');
      loadSettings();
    }
  } catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
});

// ---------------- تحميل تفضيلات محفوظة عند بدء التشغيل ----------------
function applySavedPrefs() {
  const accent = localStorage.getItem('accentColor');
  if (accent) { document.documentElement.style.setProperty('--accent', accent); el('accentPicker').value = accent; }
  if (localStorage.getItem('densityCompact')) { document.body.classList.add('density-compact'); el('densityToggle').checked = true; }
  if (localStorage.getItem('sidebarCollapsed')) el('sidebar').classList.add('collapsed');
  if (localStorage.getItem('desktopNotif')) el('desktopNotifToggle').checked = true;
  state.queueSpikeEnabled = localStorage.getItem('queueSpikeEnabled') === '1';
  state.queueSpikeThreshold = Number(localStorage.getItem('queueSpikeThreshold')) || 5;
  el('queueSpikeToggle').checked = state.queueSpikeEnabled;
  el('queueSpikeInput').value = state.queueSpikeThreshold;
  const savedFontSize = localStorage.getItem('fontSize');
  if (savedFontSize) { document.body.style.fontSize = `${savedFontSize}px`; el('fontSizeSlider').value = savedFontSize; }
  if (localStorage.getItem('highContrast')) { document.body.classList.add('high-contrast'); el('highContrastToggle').checked = true; }
  const lastTab = localStorage.getItem('lastTab');
  if (lastTab && el(`tab-${lastTab}`)) switchTab(lastTab);
  if (localStorage.getItem('hallwayListView')) {
    el('hallwayGrid').classList.add('list-view');
    el('hallwayViewToggle').textContent = '▦ عرض شبكي';
  }
  const savedRate = Number(localStorage.getItem('hallwayRefreshRate'));
  const rate = Number.isFinite(savedRate) && localStorage.getItem('hallwayRefreshRate') !== null ? savedRate : 30000;
  el('hallwayRefreshRate').value = String(rate);
  setHallwayRefreshRate(rate);
  renderWatchedKeywords();
  if (localStorage.getItem('friendsJoinAlert')) el('friendsJoinAlertToggle').checked = true;
  renderMutedUsersList();
  renderScenePresets();
  renderSettingsProfiles();
  renderSettingsChangeLog();
  const toastDur = localStorage.getItem('toastDuration');
  if (toastDur) el('toastDurationInput').value = toastDur;
  const goodColor = localStorage.getItem('goodColor');
  if (goodColor) { document.documentElement.style.setProperty('--good', goodColor); el('goodColorPicker').value = goodColor; }
  const dangerColor = localStorage.getItem('dangerColor');
  if (dangerColor) { document.documentElement.style.setProperty('--danger', dangerColor); el('dangerColorPicker').value = dangerColor; }
  maybeRemindBackup();
  loadShortcuts();
  renderRecentRooms();
}

// ---------------- مركز المنصة: حقيقة العقود + تشخيص + عمليات مقيدة ----------------
const PLATFORM_STATUS_LABELS = {
  verified: 'مؤكد حيًا', contract: 'عقد محلي', human: 'بقرار بشري', experimental: 'تجريبي',
  candidate: 'مرشح', unsupported: 'غير مدعوم', deferred: 'مؤجل',
};
const OPERATION_STATUS_LABELS = {
  running: 'جارية', completed: 'اكتملت', partial: 'اكتملت جزئيًا', failed: 'فشلت', cancelled: 'أُلغيت', preview: 'محاكاة',
};

function operationPayload() {
  const sequence = (el('operationSequence')?.value || '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const scope = el('operationScope')?.value || 'speakers';
  return {
    kind: el('operationKind')?.value,
    sequence,
    scope,
    cycles: Number(el('operationCycles')?.value) || 1,
    intervalMs: Number(el('operationInterval')?.value) || 800,
    targetIds: scope === 'selected' ? [...state.selectedUsers.keys()] : [],
  };
}

function syncOperationFields() {
  const reaction = el('operationKind')?.value === 'reaction-sequence';
  ['operationSequenceField', 'operationScopeField', 'operationCyclesField'].forEach((id) => { if (el(id)) el(id).hidden = !reaction; });
  state.operationPreview = null;
  if (el('operationPreview')) el('operationPreview').dataset.state = 'empty';
  if (el('operationPreviewTitle')) el('operationPreviewTitle').textContent = 'لم تتم المعاينة بعد';
  if (el('operationPreviewMeta')) el('operationPreviewMeta').textContent = 'لن يبدأ أي تأثير حقيقي قبل التأكيد.';
}

function renderOperationPreview(preview, dryRun = false) {
  state.operationPreview = preview;
  const names = (preview.targets || []).slice(0, 4).map((target) => target.name || target.username || `#${target.user_id}`);
  el('operationPreview').dataset.state = preview.total ? 'ready' : 'empty';
  el('operationPreviewTitle').textContent = dryRun ? `اكتمل Dry Run — ${preview.total || 0} خطوة` : `${preview.label || 'عملية'} — ${preview.total || 0} خطوة`;
  el('operationPreviewMeta').textContent = preview.total
    ? `${(preview.targets || []).length} هدف${names.length ? `: ${names.join('، ')}${preview.targets.length > names.length ? '…' : ''}` : ''} · فاصل ${preview.intervalMs}ms`
    : 'لا توجد أهداف مطابقة وآمنة حاليًا؛ لم يتم ولن يتم تنفيذ شيء.';
}

async function previewOperation({ dryRun = false } = {}) {
  try {
    const payload = operationPayload();
    const preview = await api('/api/operations/preview', { method: 'POST', body: payload });
    renderOperationPreview(preview);
    if (!dryRun) return preview;
    const { operation } = await api('/api/operations/run', { method: 'POST', body: { ...payload, dryRun: true } });
    renderOperationPreview({ ...preview, total: operation.total }, true);
    await loadPlatformOperations();
    toast('Dry Run اكتمل بدون إرسال أي أمر إلى Clubhouse', 'ok');
    return preview;
  } catch (err) {
    state.operationPreview = null;
    el('operationPreview').dataset.state = 'error';
    el('operationPreviewTitle').textContent = 'المعاينة غير جاهزة';
    el('operationPreviewMeta').textContent = err.message;
    toast(err.message, 'err');
    return null;
  }
}

function renderOperationProgress(operation) {
  if (!operation) return;
  const live = el('operationLive');
  const running = operation.status === 'running';
  const percent = operation.total ? Math.round((operation.completed / operation.total) * 100) : 0;
  live.hidden = false;
  live.dataset.status = operation.status;
  el('operationProgressBar').style.transform = `scaleX(${percent / 100})`;
  el('operationLiveTitle').textContent = `${operation.label} — ${OPERATION_STATUS_LABELS[operation.status] || operation.status}`;
  el('operationLiveMeta').textContent = `${operation.completed}/${operation.total} · نجح ${operation.succeeded} · تخطي ${operation.skipped || 0} · تعذر ${operation.failed}`;
  el('cancelOperationBtn').hidden = !running;
  el('platformRunningBadge').hidden = !running;
  if (running) state.activeOperationId = operation.id;
  else if (state.activeOperationId === operation.id) state.activeOperationId = null;
  if (!running) loadPlatformOperations().catch(() => {});
}

function renderOperationHistory(operations = []) {
  const host = clearNode(el('operationHistory'));
  if (!operations.length) {
    const empty = document.createElement('p'); empty.className = 'empty-hint'; empty.textContent = 'لا توجد عمليات في هذه الجلسة بعد.'; host.appendChild(empty); return;
  }
  operations.slice(0, 6).forEach((operation) => {
    const row = document.createElement('div'); row.className = 'operation-history-row'; row.dataset.status = operation.status;
    const copy = document.createElement('span');
    const title = document.createElement('b'); title.textContent = operation.label;
    const meta = document.createElement('small'); meta.textContent = `${OPERATION_STATUS_LABELS[operation.status] || operation.status} · ${operation.completed}/${operation.total}`;
    copy.append(title, meta);
    const time = document.createElement('time'); time.dateTime = operation.createdAt; time.textContent = new Date(operation.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    row.append(copy, time); host.appendChild(row);
    if (operation.status === 'running') renderOperationProgress(operation);
  });
}

async function loadPlatformOperations() {
  const { operations } = await api('/api/operations');
  renderOperationHistory(operations || []);
  return operations || [];
}

function renderEndpointList() {
  const query = (el('endpointFilterInput')?.value || '').trim().toLowerCase();
  const endpoints = state.platformEndpoints.filter((endpoint) => `${endpoint.name} ${endpoint.domain} ${endpoint.description} ${endpoint.statusLabel}`.toLowerCase().includes(query));
  const host = clearNode(el('endpointList'));
  endpoints.forEach((endpoint) => {
    const row = document.createElement('article'); row.className = 'endpoint-row'; row.dataset.status = endpoint.status;
    const copy = document.createElement('span');
    const name = document.createElement('code'); name.textContent = endpoint.name;
    const description = document.createElement('small'); description.textContent = `${endpoint.description} · ${endpoint.domain}`;
    copy.append(name, description);
    const status = document.createElement('b'); status.textContent = endpoint.statusLabel || PLATFORM_STATUS_LABELS[endpoint.status] || endpoint.status;
    row.append(copy, status); host.appendChild(row);
  });
  if (!endpoints.length) {
    const empty = document.createElement('p'); empty.className = 'empty-hint'; empty.textContent = 'لا توجد عقود تطابق البحث.'; host.appendChild(empty);
  }
}

async function loadPlatformTruth() {
  const { endpoints, summary } = await api('/api/platform/endpoints');
  state.platformEndpoints = endpoints || [];
  const host = clearNode(el('endpointSummary'));
  [['الإجمالي', summary.total], ['مؤكد', summary.byStatus?.verified || 0], ['بقرار بشري', summary.byStatus?.human || 0], ['مرشح', summary.byStatus?.candidate || 0]].forEach(([label, value]) => {
    const item = document.createElement('span'); const number = document.createElement('b'); number.textContent = value; const text = document.createElement('small'); text.textContent = label; item.append(number, text); host.appendChild(item);
  });
  renderEndpointList();
}

function diagnosticCard(label, value, stateName = 'neutral') {
  const card = document.createElement('span'); card.className = 'diagnostic-card'; card.dataset.state = stateName;
  const key = document.createElement('small'); key.textContent = label;
  const val = document.createElement('b'); val.textContent = value;
  card.append(key, val); return card;
}

async function loadPlatformDiagnostics() {
  const data = await api('/api/platform/diagnostics');
  const host = clearNode(el('platformDiagnostics'));
  host.append(
    diagnosticCard('السيرفر', `localhost:${data.server.port}`, 'good'),
    diagnosticCard('وضع الأمان', data.server.readOnly ? 'قراءة فقط' : 'تنفيذ بإذن', data.server.readOnly ? 'warn' : 'good'),
    diagnosticCard('الحساب', data.account.available ? 'متاح' : 'غير متاح', data.account.available ? 'good' : 'warn'),
    diagnosticCard('الغرفة', data.room.connected ? `${data.room.members} عضو` : 'غير متصلة', data.room.connected ? 'good' : 'neutral'),
  );
  el('platformHealth').dataset.health = data.account.available ? 'good' : 'warn';
  el('platformHealthTitle').textContent = data.account.available ? 'Clubhouse mod by Darhous جاهز' : 'السيرفر يعمل — الحساب غير متاح';
  el('platformHealthMeta').textContent = `فحص محلي ${new Date(data.checkedAt).toLocaleTimeString('ar-EG')} · Node ${data.server.node}`;
  applyReadOnlyMode(data.server.readOnly, { announce: false });
  return data;
}

async function loadPlatform() {
  try { await Promise.all([loadPlatformTruth(), loadPlatformDiagnostics(), loadPlatformOperations(), loadSettings()]); }
  catch (err) {
    el('platformHealth').dataset.health = 'error';
    el('platformHealthTitle').textContent = 'تعذّر الفحص المحلي';
    el('platformHealthMeta').textContent = err.message;
  }
}

el('operationKind')?.addEventListener('change', syncOperationFields);
el('previewOperationBtn')?.addEventListener('click', () => previewOperation());
el('dryRunOperationBtn')?.addEventListener('click', () => previewOperation({ dryRun: true }));
el('operationStudioForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (blockedByReadOnly()) return;
  const preview = await previewOperation();
  if (!preview?.total) return;
  const confirmed = await confirmAction({
    title: preview.label, description: `سيتم تنفيذ ${preview.total} خطوة على ${(preview.targets || []).length} عضو بفاصل ${preview.intervalMs}ms. يمكنك إلغاء الباقي أثناء التشغيل.`,
    target: state.lastState?.topic || state.channel || 'الغرفة الحالية', result: 'تنفيذ محدود ومسجل في سجل التدقيق', confirmLabel: 'بدء العملية', tone: preview.kind === 'kick-blacklisted' ? 'danger' : 'warning',
  });
  if (!confirmed) return;
  try {
    const { operation } = await api('/api/operations/run', { method: 'POST', body: operationPayload() });
    renderOperationProgress(operation); toast('بدأت العملية ويمكنك إلغاء الباقي من مركز المنصة', 'ok');
  } catch (err) { toast(err.message, 'err'); }
});
el('cancelOperationBtn')?.addEventListener('click', async () => {
  if (!state.activeOperationId) return;
  try { const { operation } = await api(`/api/operations/${state.activeOperationId}/cancel`, { method: 'POST' }); renderOperationProgress(operation); toast('تم طلب إلغاء الخطوات المتبقية', 'ok'); }
  catch (err) { toast(err.message, 'err'); }
});
el('endpointFilterInput')?.addEventListener('input', renderEndpointList);
el('refreshPlatformBtn')?.addEventListener('click', loadPlatform);
el('loadClubhouseSettingsBtn')?.addEventListener('click', async () => {
  const host = clearNode(el('clubhouseSettingsSafe')); host.hidden = false;
  try {
    const { settings } = await api('/api/account/clubhouse-settings');
    const entries = Object.entries(settings || {}).slice(0, 16);
    entries.forEach(([key, value]) => {
      const row = document.createElement('span'); const label = document.createElement('code'); label.textContent = key;
      const text = document.createElement('b'); text.textContent = Array.isArray(value) ? `${value.length} عنصر` : value && typeof value === 'object' ? `${Object.keys(value).length} حقل` : String(value);
      row.append(label, text); host.appendChild(row);
    });
    if (!entries.length) host.textContent = 'لم تُرجع الاستجابة إعدادات قابلة للعرض.';
  } catch (err) { host.textContent = `تعذّرت القراءة الآمنة: ${err.message}`; }
});

el('createRoomGatewayForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (blockedByReadOnly()) return;
  const topic = el('createRoomTopic').value.trim(); const mode = el('createRoomMode').value;
  const modeLabel = { regular: 'مفتوحة', social: 'سوشيال', private: 'خاصة' }[mode] || mode;
  const confirmed = await confirmAction({
    title: 'إنشاء غرفة بعقد مرشح',
    description: 'هذا العقد مأخوذ من التوثيق العامل بالمشروع لكنه غير موثق رسميًا كعقد حديث. ستُرسل المحاولة مرة واحدة فقط.',
    target: `${topic || 'بدون عنوان'} · ${modeLabel}`,
    result: 'إنشاء غرفة Clubhouse وربط رمزها بالنتيجة', confirmLabel: 'إنشاء الغرفة', tone: 'warning',
  });
  if (!confirmed) return;
  const output = el('createRoomGatewayResult'); output.textContent = 'جاري إرسال طلب الإنشاء…';
  try {
    const { room } = await api('/api/platform/create-room', { method: 'POST', body: { topic, mode, confirmCandidate: true } });
    const channel = room?.channel || room?.channel_id || 'تم الإنشاء';
    output.textContent = `تم إنشاء الغرفة بنجاح · ${channel}`; toast('تم إنشاء الغرفة', 'ok');
    loadChannels();
  } catch (err) { output.textContent = `تعذّر الإنشاء: ${err.message}`; toast(err.message, 'err'); }
});

function renderGatewayHouses(houses) {
  const host = clearNode(el('houseDiscoveryResults'));
  for (const house of houses || []) {
    const clubId = house.club_id ?? house.id; if (clubId == null) continue;
    const row = document.createElement('article'); row.className = 'gateway-house';
    const copy = document.createElement('span'); const name = document.createElement('b'); const meta = document.createElement('small');
    name.textContent = house.name || house.title || `هاوس #${clubId}`;
    meta.textContent = house.description || `${Number(house.num_members || house.member_count || 0).toLocaleString('ar-EG')} عضو`;
    copy.append(name, meta);
    const followed = !!(house.is_followed || house.is_member || house.is_follower);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn--sm'; button.textContent = followed ? 'إلغاء المتابعة' : 'متابعة';
    button.addEventListener('click', async () => {
      if (blockedByReadOnly()) return;
      const action = followed ? 'unfollow' : 'follow';
      if (!(await confirmAction({ title: followed ? 'إلغاء متابعة الهاوس' : 'متابعة الهاوس', description: 'سيتم تنفيذ عقد المتابعة المرشح مرة واحدة.', target: name.textContent, result: followed ? 'إلغاء المتابعة' : 'إضافة المتابعة', confirmLabel: followed ? 'إلغاء المتابعة' : 'متابعة', tone: 'warning' }))) return;
      try { await api(`/api/platform/houses/${encodeURIComponent(clubId)}/${action}`, { method: 'POST' }); button.textContent = followed ? 'تم إلغاء المتابعة' : 'تمت المتابعة'; button.disabled = true; toast('تم تنفيذ الطلب', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    });
    row.append(copy, button); host.appendChild(row);
  }
  if (!host.childElementCount) { const empty = document.createElement('p'); empty.className = 'empty-hint'; empty.textContent = 'لا توجد نتائج مطابقة.'; host.appendChild(empty); }
}
el('houseDiscoveryForm')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const query = el('houseDiscoveryQuery').value.trim();
  const host = el('houseDiscoveryResults'); host.textContent = 'جاري البحث…';
  try { const { houses } = await api(`/api/platform/houses/search?q=${encodeURIComponent(query)}`); renderGatewayHouses(houses); }
  catch (err) { host.textContent = `تعذّر البحث: ${err.message}`; }
});

el('compareFriendsBtn')?.addEventListener('click', async () => {
  const output = el('friendsCompareResult'); output.textContent = 'جاري مقارنة المصدر المباشر باستنتاج الغرف…';
  try {
    const data = await api('/api/platform/friends-compare');
    output.textContent = `المصدر المباشر: ${data.direct.length} · الاستنتاج الحالي: ${data.inferred.length} · التطابق: ${data.overlap}\n${data.directAvailable ? 'المصدر المباشر استجاب.' : `المصدر المباشر غير متاح: ${data.directError}`}`;
  } catch (err) { output.textContent = `تعذّرت المقارنة: ${err.message}`; }
});
el('compatibilityCheckBtn')?.addEventListener('click', async () => {
  const output = el('compatibilityResult'); output.textContent = 'جاري فحص البصمة والعقود محليًا…';
  try {
    const data = await api('/api/platform/compatibility'); const client = data.activeClient || {};
    output.textContent = `App ${client.appVersion || 'غير معروف'} · Build ${client.appBuild || 'غير معروف'}\nالعقود: ${data.contracts?.byStatus?.verified || 0} مؤكدة · ${data.contracts?.byStatus?.candidate || 0} مرشحة\nلا يتم عرض التوكن أو هيدرز الهوية.`;
  } catch (err) { output.textContent = `تعذّر الفحص: ${err.message}`; }
});
syncOperationFields();

// ---------------- تحميل مساحات العمل عند فتحها + إيقاف التحديث عند الخمول ----------------
const loadedWorkspaces = new Set();
let archiveRefreshTimer = null;
let queueSuggestionsTimer = null;
let multiRoomRefreshTimer = null;
const workspaceLoaders = {
  currentroom: () => renderCurrentRoomSurface(state.lastState || { connected: false }),
  hallway: () => loadHallway(),
  houses: () => loadHouses(),
  messages: () => loadChats('requests').then(() => loadChats('chats')),
  social: () => Promise.all([loadFollowers(), loadFriendsOnline(), loadRecentInteractions(), loadDiscover(), loadSuggestedInvites(), loadBlocked(), loadWaves('received')]),
  friends: () => Promise.all([loadFriendsOnlineFull(), loadFriendsOffline(), loadNotifications(), loadSettings()]),
  profile: () => loadFullProfile(),
  quick: () => Promise.all([loadLists(), loadPresets(), loadSettings()]),
  effects: () => Promise.all([renderEffectsCatalog(), loadSettings()]),
  queue: () => Promise.all([loadLists(), loadRecentSpeakers(), state.roomReady ? loadSuggestedSpeakers() : Promise.resolve(), state.roomReady ? loadReplayers() : Promise.resolve()]),
  members: () => { if (state.lastState) renderMemberLists(state.lastState.speakers || [], state.lastState.listeners || []); },
  platform: () => loadPlatform(),
  accounts: () => loadAccountsPage(),
  search: () => undefined,
  advanced: () => Promise.all([loadLists(), loadSettings(), renderShiftsList(), renderMultiRoomGrid()]),
  settings: () => Promise.all([loadLists(), loadPresets(), loadSettings(), loadGiphyKey()]),
  stats: () => Promise.all([loadAcceptAndMuteStats(), loadArchiveComparison()]),
  archive: () => loadArchiveAndAudit(),
  log: () => undefined,
};
function ensureWorkspaceData(name) {
  if (!name) return;
  if (name === 'currentroom') {
    workspaceLoaders.currentroom();
    syncPollingActivity();
    return;
  }
  if (loadedWorkspaces.has(name)) return;
  loadedWorkspaces.add(name);
  Promise.resolve(workspaceLoaders[name]?.()).catch((err) => {
    loadedWorkspaces.delete(name);
    toast(`تعذّر تحميل مساحة العمل: ${err.message}`, 'err');
  });
  if (name === 'queue' && state.lastQueue) renderQueueList(state.lastQueue, state.capabilities || {});
  syncPollingActivity();
}
function syncPollingActivity() {
  if (hallwayRefreshTimer) { clearInterval(hallwayRefreshTimer); hallwayRefreshTimer = null; }
  if (archiveRefreshTimer) { clearInterval(archiveRefreshTimer); archiveRefreshTimer = null; }
  if (queueSuggestionsTimer) { clearInterval(queueSuggestionsTimer); queueSuggestionsTimer = null; }
  if (multiRoomRefreshTimer) { clearInterval(multiRoomRefreshTimer); multiRoomRefreshTimer = null; }
  if (document.hidden) return;
  if (state.activeWorkspace === 'hallway' && hallwayRefreshMs > 0) hallwayRefreshTimer = setInterval(loadHallway, hallwayRefreshMs);
  if (state.activeWorkspace === 'archive') archiveRefreshTimer = setInterval(loadArchiveAndAudit, 15000);
  if (state.activeWorkspace === 'queue') queueSuggestionsTimer = setInterval(() => state.roomReady && loadSuggestedSpeakers(), 20000);
  if (state.activeWorkspace === 'advanced') multiRoomRefreshTimer = setInterval(renderMultiRoomGrid, 20000);
}
window.addEventListener('modpanel:workspace', (event) => ensureWorkspaceData(event.detail?.name));
document.addEventListener('visibilitychange', syncPollingActivity);

// ---------------- بدء التشغيل ----------------
loadProfile();
loadChannels();
connectSSE();
applySavedPrefs();
makeCardsCollapsible();
loadNotifications(); // عشان بادچ الجرس العائم يبان من غير ما تفتح تاب الأصدقاء والإشعارات
ensureWorkspaceData(state.activeWorkspace);
