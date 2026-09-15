'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { getError: profileError } = require('./lib/clubdeckProfile');
const account = require('./lib/account');
const { apiPost, apiGet, buildHeaders, MODERN_ROOM_CLIENT, log: apiLog } = require('./lib/chClient');
const poller = require('./lib/poller');
const friendsWatcher = require('./lib/friendsWatcher');
const actions = require('./lib/actions');
const state = require('./lib/state');
const endpointRegistry = require('./lib/endpointRegistry');
const operationManager = require('./lib/operationManager');
const { createRoomChat } = require('./lib/roomChat');
const { createLogBuffer } = require('./lib/logBuffer');
const { resolveRoomLink } = require('./lib/roomLink');
const { createChatReceipts } = require('./lib/chatReceipts');
const { createRoomConnection } = require('./lib/roomConnection');
const roomConnection = createRoomConnection({ poller, getProfile: account.getActiveProfile, join: actions.joinChannel, leave: (channel) => apiPost('/leave_channel', { channel }) });
const fullApiLog = createLogBuffer();
const roomChat = createRoomChat({
  getRoom: poller.getState, getGeneration: poller.getContext, getProfile: account.getActiveProfile,
  getSettings: state.getSettings, setSetting: state.setSetting, apiGet, apiPost,
  operations: operationManager, appendAudit: state.appendAudit, emit: broadcast,
  receipts: createChatReceipts({ load: state.getChatReceipts, save: state.saveChatReceipts }),
});

const getProfile = account.getActiveProfile;

const PORT = process.env.PORT || 4545;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ---------- أدوات مساعدة ----------
function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403, SECURITY_HEADERS); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, SECURITY_HEADERS); return res.end('not found'); }
    const ext = path.extname(filePath);
    const cacheControl = ext === '.html' ? 'no-store' : 'public, max-age=0, must-revalidate';
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControl });
    res.end(buf);
  });
}

function findUser(userId) {
  const s = poller.getState();
  const pools = [s.speakers || [], s.listeners || [], s.raiseQueue || []];
  for (const pool of pools) {
    const u = pool.find((x) => String(x.user_id) === String(userId));
    if (u) return u;
  }
  return { user_id: userId, name: `#${userId}` };
}

// ---- حماية من حظر Clubhouse المؤقت للسبام: اتأكد حيًا إن 3 عمليات بث جماعي (ريأكت/GIF/ترحيب) بفاصل
// ~20 ثانية كفاية تفعّل "high usage of this feature" مؤقتًا. بوابة واحدة مشتركة بين الثلاثة عشان
// أي بث جماعي (من أي زرار) يحترم نفس الفاصل، مش كل زرار لوحده. ---
const BROADCAST_REACTION_COOLDOWN_MS = 30000;
let lastBroadcastReactionAt = 0;
let welcomeReactionRunning = false;
function guardBroadcastReactionCooldown(res) {
  if (welcomeReactionRunning) {
    sendJSON(res, 409, { error: 'الترحيب الحالي لسه شغال بفاصل ٥ ثواني؛ استنى اكتماله' });
    return true;
  }
  const remaining = BROADCAST_REACTION_COOLDOWN_MS - (Date.now() - lastBroadcastReactionAt);
  if (remaining > 0) {
    sendJSON(res, 429, {
      error: `استنى ${Math.ceil(remaining / 1000)} ثانية قبل أي بث جماعي تاني — عشان محدش يضرب حماية Clubhouse من السبام`,
      retryAfterMs: remaining,
    });
    return true;
  }
  lastBroadcastReactionAt = Date.now();
  return false;
}

// ---------- SSE ----------
const sseClients = new Set();
function broadcast(event, payload) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(line);
}
poller.bus.on('state', (s) => broadcast('state', s));
poller.bus.on('state', () => roomChat.update());
poller.bus.on('reset', () => roomChat.reset());
poller.bus.on('hand-raise', (u) => broadcast('hand-raise', u));
poller.bus.on('room-ended', (d) => broadcast('room-ended', d));
poller.bus.on('auto-action', (d) => broadcast('auto-action', d));
poller.bus.on('auto-action-error', (d) => broadcast('auto-action-error', d));
poller.bus.on('schedule-executed', (d) => broadcast('schedule-executed', d));
poller.bus.on('schedule-error', (d) => broadcast('schedule-error', d));
poller.bus.on('mod-alert', (d) => broadcast('mod-alert', d));
friendsWatcher.bus.on('notification', (d) => broadcast('notification', d));
apiLog.on('request', (d) => broadcast('log', { kind: 'request', ...d }));
apiLog.on('response', (d) => broadcast('log', { kind: 'response', ...d }));
apiLog.on('error', (d) => broadcast('log', { kind: 'error', ...d }));
for (const kind of ['request', 'response', 'error']) apiLog.on(kind, (d) => fullApiLog.add({ kind, ...d }));
operationManager.bus.on('progress', (d) => broadcast('operation', d));

function redactSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(token|authorization|phone|email|device.?id|refresh|access)/i.test(key)) continue;
    safe[key] = redactSensitiveFields(child);
  }
  return safe;
}

function isExternalMutation(pathname, method) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  if (pathname === '/api/settings' || pathname === '/api/settings/giphy-key' || pathname === '/api/channel/select' || pathname === '/api/room-chat/settings') return false;
  if (pathname === '/api/operations/preview' || pathname === '/api/operations/run' || /\/cancel$/.test(pathname)) return false;
  return pathname.startsWith('/api/action/')
    || pathname.startsWith('/api/room-chat/')
    || pathname.startsWith('/api/operations/run')
    || /^\/api\/channel\/(join|leave)$/.test(pathname)
    || pathname === '/api/platform/create-room'
    || /^\/api\/platform\/houses\/[^/]+\/(follow|unfollow)$/.test(pathname)
    || /^\/api\/account\/phone\/(start|complete)$/.test(pathname)
    || pathname === '/api/hallway/hide'
    || /^\/api\/(social|houses|chats|profile)(\/|$)/.test(pathname);
}

function uniqueUsers(users) {
  const seen = new Set();
  return (users || []).filter((user) => {
    const id = String(user?.user_id ?? '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function excludeSelfUsers(users) {
  const profile = getProfile();
  const myId = profile && (profile.userId || (profile.user && profile.user.user_id));
  return !myId ? users : users.filter((user) => String(user.user_id) !== String(myId));
}

function excludeProtectedUsers(users) {
  const settings = state.getSettings();
  if (!settings.protectedListEnabled) return users;
  const protectedList = state.getList('protected');
  if (!protectedList.length) return users;
  return users.filter((user) => !protectedList.some((item) => `${user.name || ''} ${user.username || ''}`.toLowerCase().includes(String(item.value).toLowerCase())));
}

function operationPlan(body = {}) {
  const room = poller.getState();
  if (!room.connected || !poller.getChannel()) throw Object.assign(new Error('مفيش غرفة متصلة لتنفيذ العملية'), { status: 400 });
  const kind = String(body.kind || '');
  const targetIds = new Set((body.targetIds || []).map(String));
  const filterTargets = (users) => targetIds.size ? users.filter((user) => targetIds.has(String(user.user_id))) : users;
  const base = {
    kind,
    channel: poller.getChannel(),
    intervalMs: Math.min(5000, Math.max(600, Number(body.intervalMs) || 800)),
    requiredCapability: null,
    label: '',
    items: [],
  };

  if (kind === 'reaction-sequence') {
    if (!room.self?.isInRoom) throw Object.assign(new Error('الحساب لازم يكون منضم للغرفة قبل إرسال التفاعلات'), { status: 409 });
    const values = (Array.isArray(body.sequence) ? body.sequence : [body.value])
      .map((value) => String(value || '').trim()).filter(Boolean).slice(0, 5);
    if (!values.length) throw Object.assign(new Error('اختار تفاعل واحد على الأقل'), { status: 400 });
    const cycles = Math.min(3, Math.max(1, Number(body.cycles) || 1));
    const scope = ['speakers', 'listeners', 'selected'].includes(body.scope) ? body.scope : 'speakers';
    let users = scope === 'listeners' ? room.listeners : scope === 'selected' ? [...room.speakers, ...room.listeners] : room.speakers;
    users = uniqueUsers(filterTargets(users));
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (const user of users) {
        for (const value of values) base.items.push({ key: `${user.user_id}:${cycle}:${value}`, userId: user.user_id, user, value });
      }
    }
    base.items = base.items.slice(0, 60);
    base.label = 'حملة تفاعلات محدودة';
    return base;
  }

  if (kind === 'invite-listeners') {
    base.requiredCapability = 'can_edit_handraise_queue';
    let users = uniqueUsers(filterTargets(room.listeners || []));
    const settings = state.getSettings();
    const freeSeats = settings.speakerCapEnabled ? Math.max(0, settings.speakerCap - (room.speakers || []).length) : 30;
    users = users.slice(0, Math.min(30, freeSeats));
    base.items = users.map((user) => ({ key: String(user.user_id), userId: user.user_id, user }));
    base.label = 'دعوة جمهور إلى المسرح';
    return base;
  }

  if (kind === 'lower-speakers') {
    base.requiredCapability = 'can_remove_speakers';
    const users = filterTargets(excludeSelfUsers(excludeProtectedUsers(room.speakers || [])))
      .filter((user) => !user.is_moderator).slice(0, 30);
    base.items = users.map((user) => ({ key: String(user.user_id), userId: user.user_id, user }));
    base.label = 'إعادة المسرح إلى وضع هادئ';
    return base;
  }

  if (kind === 'kick-blacklisted') {
    base.requiredCapability = 'can_remove_speakers';
    const blacklist = state.getList('blacklist');
    const pool = excludeSelfUsers(excludeProtectedUsers([...(room.speakers || []), ...(room.listeners || [])]));
    const users = filterTargets(pool.filter((user) => blacklist.some((item) => `${user.name || ''} ${user.username || ''}`.toLowerCase().includes(String(item.value).toLowerCase())))).slice(0, 20);
    base.items = users.map((user) => ({ key: String(user.user_id), userId: user.user_id, user }));
    base.label = 'إزالة عناصر القائمة السوداء الحاضرين';
    return base;
  }

  throw Object.assign(new Error('نوع العملية غير مدعوم'), { status: 400 });
}

// ---------- السيرفر ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

    if (state.getSettings().serverReadOnlyMode && isExternalMutation(pathname, req.method)) {
      return sendJSON(res, 423, { error: 'وضع القراءة فقط مفعل على السيرفر — أوقفه من الإعدادات قبل تنفيذ أمر حقيقي' });
    }

    if (pathname === '/api/log/export' && req.method === 'GET') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="modpanel-log.jsonl"' });
      return res.end(fullApiLog.export());
    }
    if (pathname.startsWith('/api/room-chat')) {
      if (pathname === '/api/room-chat' && req.method === 'GET') return sendJSON(res, 200, roomChat.status());
      if (pathname === '/api/room-chat/messages' && req.method === 'GET') return sendJSON(res, 200, await roomChat.messages(url.searchParams.get('context'), url.searchParams.get('cursor')));
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (pathname === '/api/room-chat/settings') return sendJSON(res, 200, roomChat.updateSettings(body));
        if (pathname === '/api/room-chat/send') return sendJSON(res, 200, await roomChat.send(body.context, body.message));
        if (pathname === '/api/room-chat/delete') return sendJSON(res, 200, await roomChat.remove(body.context, body.messageId));
        if (pathname === '/api/room-chat/welcome') return sendJSON(res, 202, { operation: roomChat.welcome(body.context, body.scope) });
        if (pathname === '/api/room-chat/like') return sendJSON(res, 200, await roomChat.like(body.context, body.messageId, body.liked));
      }
    }

    // ---- مركز حقيقة الـ API والتشخيص المحلي (لا ينفذ probes خارجية) ----
    if (pathname === '/api/platform/endpoints' && req.method === 'GET') {
      return sendJSON(res, 200, { endpoints: endpointRegistry.listEndpoints(), summary: endpointRegistry.endpointSummary() });
    }
    if (pathname === '/api/platform/diagnostics' && req.method === 'GET') {
      const room = poller.getState();
      const identity = account.getActiveIdentity();
      return sendJSON(res, 200, {
        checkedAt: new Date().toISOString(),
        server: { port: Number(PORT), readOnly: !!state.getSettings().serverReadOnlyMode, node: process.version },
        account: { available: !!identity?.user, mode: identity?.mode || 'unknown' },
        room: { connected: !!room.connected, channel: room.channel || null, role: room.myRole || null, members: (room.speakers || []).length + (room.listeners || []).length },
        registry: endpointRegistry.endpointSummary(),
        operations: operationManager.listOperations().slice(0, 5),
      });
    }
    if (pathname === '/api/platform/compatibility' && req.method === 'GET') {
      const profile = getProfile() || {};
      const headers = buildHeaders(profile) || {};
      return sendJSON(res, 200, {
        checkedAt: new Date().toISOString(),
        activeClient: { appVersion: headers['CH-AppVersion'] || null, appBuild: headers['CH-AppBuild'] || null, userAgent: headers['User-Agent'] || null },
        modernRoomClient: MODERN_ROOM_CLIENT,
        contracts: endpointRegistry.endpointSummary(),
        notes: ['لا تُعرض هيدرز الهوية أو التوكن', 'عمليات الغرفة المؤكدة تستخدم بصمة العميل الحديث فقط'],
      });
    }
    if (pathname === '/api/platform/create-room' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.confirmCandidate) return sendJSON(res, 409, { error: 'يلزم تأكيد استخدام العقد المرشح يدويًا' });
      const topic = String(body.topic || '').trim();
      if (!topic || topic.length > 120) return sendJSON(res, 400, { error: 'عنوان الغرفة مطلوب وبحد أقصى 120 حرفًا' });
      try {
        const result = await apiPost('/create_channel', {
          is_social_mode: body.mode === 'social', is_private: body.mode === 'private',
          club_id: body.clubId || null, user_ids: [], event_id: null, topic,
        });
        state.appendAudit({ action: 'create-room', channel: result.channel, value: topic });
        return sendJSON(res, 200, { ok: true, room: redactSensitiveFields(result) });
      } catch (err) { return sendJSON(res, err.status || 502, { error: err.message }); }
    }
    if (pathname === '/api/platform/houses/search' && req.method === 'GET') {
      const query = String(url.searchParams.get('q') || '').trim();
      if (query.length < 2) return sendJSON(res, 400, { error: 'اكتب حرفين على الأقل' });
      try {
        const result = await apiPost('/search_clubs', { cofollows_only: false, following_only: false, followers_only: false, query });
        return sendJSON(res, 200, { houses: result.clubs || result.social_clubs || result.results || [], contract: 'candidate' });
      } catch (err) { return sendJSON(res, err.status || 502, { error: err.message }); }
    }
    const platformHouseFollowMatch = pathname.match(/^\/api\/platform\/houses\/([^/]+)\/(follow|unfollow)$/);
    if (platformHouseFollowMatch && req.method === 'POST') {
      const [, clubId, action] = platformHouseFollowMatch;
      try {
        const result = await apiPost(action === 'follow' ? '/follow_club' : '/unfollow_club', { club_id: clubId, source_topic_id: null });
        state.appendAudit({ action: `${action}-house`, targetId: clubId });
        return sendJSON(res, 200, { ok: true, result: redactSensitiveFields(result) });
      } catch (err) { return sendJSON(res, err.status || 502, { error: err.message }); }
    }
    if (pathname === '/api/platform/friends-compare' && req.method === 'GET') {
      try {
        const profile = getProfile();
        const myId = profile.userId || profile.user?.user_id;
        const [followersRes, feedRes] = await Promise.all([apiPost('/get_followers', { user_id: myId }), apiPost('/get_feed_v3', {})]);
        const followerIds = new Set((followersRes.users || []).map((user) => String(user.user_id)));
        const inferred = new Map();
        for (const room of (feedRes.items || []).map((item) => item.channel || item).filter((room) => room?.channel)) {
          for (const user of room.users || []) if (followerIds.has(String(user.user_id))) inferred.set(String(user.user_id), { ...user, room: { channel: room.channel, topic: room.topic } });
        }
        let direct = [], directError = null;
        try { const result = await apiPost('/get_online_friends', {}); direct = result.users || result.friends || []; } catch (err) { directError = err.message; }
        const directIds = new Set(direct.map((user) => String(user.user_id)));
        return sendJSON(res, 200, { direct, inferred: [...inferred.values()], overlap: [...inferred.keys()].filter((id) => directIds.has(id)).length, directAvailable: !directError, directError });
      } catch (err) { return sendJSON(res, err.status || 502, { error: err.message }); }
    }
    if (pathname === '/api/account/clubhouse-settings' && req.method === 'GET') {
      try {
        const result = await apiPost('/get_settings', {});
        return sendJSON(res, 200, { settings: redactSensitiveFields(result) });
      } catch (err) {
        return sendJSON(res, err.status || 502, { error: err.message });
      }
    }

    // ---- محرك العمليات الآمن: معاينة، تشغيل محدود، متابعة، وإلغاء ----
    if (pathname === '/api/operations' && req.method === 'GET') {
      return sendJSON(res, 200, { operations: operationManager.listOperations() });
    }
    if (pathname === '/api/operations/preview' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const plan = operationPlan(body);
        return sendJSON(res, 200, {
          kind: plan.kind, label: plan.label, intervalMs: plan.intervalMs,
          total: plan.items.length, requiredCapability: plan.requiredCapability,
          targets: uniqueUsers(plan.items.map((item) => item.user)).map((user) => ({ user_id: user.user_id, name: user.name, username: user.username })),
          sequence: plan.kind === 'reaction-sequence' ? [...new Set(plan.items.map((item) => item.value))] : [],
        });
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    }
    if (pathname === '/api/operations/run' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        if (state.getSettings().serverReadOnlyMode && !body.dryRun) {
          return sendJSON(res, 423, { error: 'وضع القراءة فقط مفعل على السيرفر — الـDry Run والمعاينة فقط متاحان' });
        }
        const plan = operationPlan(body);
        const room = poller.getState();
        if (plan.requiredCapability && !room.capabilities?.[plan.requiredCapability]) {
          return sendJSON(res, 403, { error: 'Clubhouse لم يمنح الحساب الصلاحية المطلوبة لهذه العملية' });
        }
        const operationContext = poller.getContext(), operationProfile = getProfile();
        const worker = async (item) => {
          if (operationContext !== poller.getContext() || operationProfile !== getProfile() || state.getSettings().serverReadOnlyMode) {
            throw Object.assign(new Error('اتغير اتصال الغرفة أو الحساب أو وضع القراءة فقط'), { status: 409, stopOperation: true });
          }
          if (plan.requiredCapability && !poller.getState().capabilities?.[plan.requiredCapability]) throw Object.assign(new Error('الصلاحية المطلوبة لم تعد متاحة'), { status: 403, stopOperation: true });
          if (plan.kind === 'reaction-sequence') return actions.sendReaction(plan.channel, item.user, item.value);
          if (plan.kind === 'invite-listeners') return actions.inviteUser(plan.channel, item.user);
          if (plan.kind === 'lower-speakers') return actions.lowerUser(plan.channel, item.user);
          if (plan.kind === 'kick-blacklisted') return actions.kickUser(plan.channel, item.user);
          throw new Error('نوع العملية غير مدعوم');
        };
        const operation = operationManager.createOperation({
          kind: plan.kind, label: plan.label, items: plan.items, worker,
          intervalMs: plan.intervalMs, dryRun: !!body.dryRun,
          metadata: { channel: plan.channel, targetCount: uniqueUsers(plan.items.map((item) => item.user)).length },
        });
        state.appendAudit({ action: body.dryRun ? 'operation-preview' : 'operation-start', channel: plan.channel, value: plan.kind, total: plan.items.length, operationId: operation.id });
        return sendJSON(res, body.dryRun ? 200 : 202, { operation });
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    }
    const operationMatch = pathname.match(/^\/api\/operations\/([^/]+)$/);
    if (operationMatch && req.method === 'GET') {
      const operation = operationManager.getOperation(operationMatch[1]);
      return operation ? sendJSON(res, 200, { operation }) : sendJSON(res, 404, { error: 'العملية غير موجودة' });
    }
    const operationCancelMatch = pathname.match(/^\/api\/operations\/([^/]+)\/cancel$/);
    if (operationCancelMatch && req.method === 'POST') {
      const operation = operationManager.cancelOperation(operationCancelMatch[1]);
      return operation ? sendJSON(res, 200, { operation }) : sendJSON(res, 404, { error: 'العملية غير موجودة' });
    }

    // ---- الملف الشخصي (بدون كشف التوكن) ----
    if (pathname === '/api/profile' && req.method === 'GET') {
      const p = getProfile();
      if (!p) return sendJSON(res, 503, { error: profileError() || 'مفيش بيانات جلسة Clubdeck' });
      return sendJSON(res, 200, { user: p.user, deviceId: p.deviceId, appVersion: p.appVersion });
    }

    // ---- الحساب النشط: حالة + تبديل بتوكين + رجوع لحساب Clubdeck ----
    if (pathname === '/api/account/status' && req.method === 'GET') {
      return sendJSON(res, 200, { ...account.getActiveIdentity(), accounts: account.listAccounts() });
    }
    if (pathname === '/api/accounts' && req.method === 'GET') return sendJSON(res, 200, { active: account.getActiveIdentity(), accounts: account.listAccounts() });
    if (pathname === '/api/account/login-token' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const user = body.username
          ? await account.useCustomTokenByUsername(body.token, body.username)
          : await account.useCustomToken(body.token, body.userId);
        poller.stop(); // أي غرفة متصلة كانت بحساب مختلف - نوقفها عشان منستمرش نراقبها بهوية غلط
        return sendJSON(res, 200, { ok: true, user, mode: 'custom' });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    }
    if (pathname === '/api/account/phone/start' && req.method === 'POST') {
      const body = await readBody(req);
      try { return sendJSON(res, 200, { ok: true, auth: await account.startPhoneAuth(body.phoneNumber) }); }
      catch (err) { return sendJSON(res, err.status || 400, { error: err.message }); }
    }
    if (pathname === '/api/account/phone/complete' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const user = await account.completePhoneAuth(body.phoneNumber, body.verificationCode);
        poller.stop();
        return sendJSON(res, 200, { ok: true, user, mode: 'custom' });
      } catch (err) { return sendJSON(res, err.status || 400, { error: err.message }); }
    }
    const accountSwitchMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/activate$/);
    if (accountSwitchMatch && req.method === 'POST') {
      try {
        const identity = account.switchAccount(decodeURIComponent(accountSwitchMatch[1]));
        poller.stop();
        return sendJSON(res, 200, { ok: true, identity });
      } catch (err) { return sendJSON(res, 404, { error: err.message }); }
    }
    // ---- البروفايل الكامل ----
    if (pathname === '/api/profile/full' && req.method === 'GET') {
      try {
        const p = getProfile();
        const myId = p.userId || (p.user && p.user.user_id);
        const full = await apiPost('/get_profile', { user_id: myId });
        return sendJSON(res, 200, { profile: full.user_profile || {} });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    if (pathname === '/api/profile/bio' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const result = await apiPost('/update_bio', { bio: body.bio });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    // ---- تعديل الاسم الظاهر ----
    if (pathname === '/api/profile/name' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const result = await apiPost('/update_name', { name: body.name });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    // ---- تغيير اليوزرنيم (@) - تغيير ظاهر للعامة، منفّذه المستخدم بنفسه من الواجهة ----
    if (pathname === '/api/profile/username' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const result = await apiPost('/update_username', { username: body.username });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    // ---- بروفايل كامل لأي مستخدم (للمعاينة السريعة) - مش بس بروفايلي أنا ----
    const profileViewMatch = pathname.match(/^\/api\/profile\/view\/([^/]+)$/);
    if (profileViewMatch && req.method === 'GET') {
      try {
        const full = await apiPost('/get_profile', { user_id: Number(profileViewMatch[1]) });
        return sendJSON(res, 200, { profile: full.user_profile || {} });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/events') {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      sseClients.add(res);
      res.write(`event: state\ndata: ${JSON.stringify(poller.getState())}\n\n`);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname === '/api/channels' && req.method === 'GET') {
      try {
        // ملحوظة: /get_channels القديم رجّع 404 فعلياً وقت الاختبار - استبدلناه بـ /get_feed_v3
        // اللي هو المصدر الحقيقي لقائمة الغرف الحية حسب الاختبار المباشر.
        const feed = await apiPost('/get_feed_v3', {});
        const channels = (feed.items || [])
          .map((it) => it.channel || it)
          .filter((c) => c && (c.channel || c.channel_id));
        return sendJSON(res, 200, { channels });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- الهالواي: نفس /get_feed_v3 لكن بشكل غني (للصفحة الرئيسية) ----
    if (pathname === '/api/hallway' && req.method === 'GET') {
      try {
        const feed = await apiPost('/get_feed_v3', {});
        const rooms = (feed.items || [])
          .map((it) => it.channel || it)
          .filter((c) => c && c.channel)
          .map((c) => ({
            channel: c.channel,
            topic: c.topic,
            numSpeakers: c.num_speakers,
            numAll: c.num_all,
            isReplayEnabled: c.is_replay_enabled,
            isSocialMode: c.is_social_mode === true || c.is_social_club_lounge === true,
            directSpeakAvailable: c.is_social_mode === true || c.is_social_club_lounge === true || c.is_automatic_speaker_approval_available === true,
            speakers: (c.users || []).slice(0, 8),
            club: c.social_club ? { id: c.social_club.social_club_id, name: c.social_club.name, photo: c.social_club.photo_url } : null,
          }));
        return sendJSON(res, 200, { rooms });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- لوحة مراقبة عدة غرف: حالة سريعة (قراءة فقط) لأي غرفة بالاسم، من غير ما نتصل بيها أو نغيّر
    // الغرفة المتصلة حالياً - بتستخدم في التبويب الجديد "تحكم متقدم" لمتابعة أكتر من غرفة بنظرة واحدة ----
    if (pathname === '/api/room/quick-status' && req.method === 'GET') {
      const channel = url.searchParams.get('channel');
      if (!channel) return sendJSON(res, 400, { error: 'channel مطلوب' });
      try {
        const raw = await apiPost('/get_channel', { channel });
        return sendJSON(res, 200, {
          channel,
          topic: raw.topic || raw.title || '',
          numAll: raw.num_all ?? (raw.users || []).length,
          numSpeakers: raw.num_speakers ?? 0,
          ended: false,
        });
      } catch (err) {
        return sendJSON(res, 200, { channel, ended: true, error: err.message });
      }
    }

    // ---- الهاوسات: مبنية على حقل social_clubs/clubs جوه /get_profile بتاعك (مفيش endpoint منفصل) ----
    if (pathname === '/api/houses' && req.method === 'GET') {
      try {
        const p = getProfile();
        const myId = p.userId || (p.user && p.user.user_id);
        const full = await apiPost('/get_profile', { user_id: myId });
        const up = full.user_profile || {};
        return sendJSON(res, 200, { houses: up.social_clubs || [], clubs: up.clubs || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    // ---- إنشاء هاوس جديد ----
    if (pathname === '/api/houses' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name) return sendJSON(res, 400, { error: 'اسم الهاوس مطلوب' });
      try {
        const result = await apiPost('/create_social_club', { name: body.name, description: body.description || '' });
        state.appendAudit({ action: 'create-house', value: body.name });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    // ---- مغادرة هاوس ----
    const leaveHouseMatch = pathname.match(/^\/api\/houses\/([^/]+)\/leave$/);
    if (leaveHouseMatch && req.method === 'POST') {
      try {
        const result = await apiPost('/leave_social_club', { social_club_id: leaveHouseMatch[1] });
        state.appendAudit({ action: 'leave-house', channel: leaveHouseMatch[1] });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- الرسائل الخاصة (DMs) ----
    if (pathname === '/api/chats' && req.method === 'GET') {
      try {
        const location = url.searchParams.get('location') === 'requests' ? 'requests' : 'chats';
        const res2 = await apiGet('/get_chats', { location });
        return sendJSON(res, 200, { chats: res2.chats || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    const chatMsgMatch = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
    if (chatMsgMatch && req.method === 'GET') {
      try {
        const res2 = await apiGet('/get_chat_messages', { chat_id: chatMsgMatch[1] });
        return sendJSON(res, 200, { messages: res2.messages || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    if (chatMsgMatch && req.method === 'POST') {
      const body = await readBody(req);
      try {
        // ملحوظة: شكل الـ body تخمين مبني على شكل الرسايل اللي بنقراها (message_body) - أول إرسال حي هيأكد
        const result = await apiPost('/send_chat_message', { chat_id: chatMsgMatch[1], message_body: body.text });
        state.appendAudit({ action: 'dm-send', targetId: chatMsgMatch[1] });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- بحث عن مستخدمين ----
    if (pathname === '/api/search' && req.method === 'GET') {
      try {
        const q = url.searchParams.get('q') || '';
        const res2 = await apiPost('/search_users', { query: q });
        return sendJSON(res, 200, { users: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- متحدثون مقترحون في الغرفة الحالية ----
    if (pathname === '/api/suggested-speakers' && req.method === 'GET') {
      const channel = poller.getChannel();
      // بنتأكد إننا فعلاً متصلين (مش بس إن channel متسجل) - عشان لو الاتصال وقع
      // لأي سبب، منضربش Clubhouse بنداء هيترفض أكيد.
      if (!channel || !poller.getState().connected) return sendJSON(res, 200, { users: [] });
      try {
        const res2 = await apiPost('/get_suggested_speakers', { channel });
        return sendJSON(res, 200, { users: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- حذف محادثة ----
    const deleteChatMatch = pathname.match(/^\/api\/chats\/([^/]+)$/);
    if (deleteChatMatch && req.method === 'DELETE') {
      try {
        const result = await apiPost('/delete_conversation', { conversation_id: deleteChatMatch[1] });
        state.appendAudit({ action: 'delete-chat', targetId: deleteChatMatch[1] });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- قبول/رفض طلب رسالة ----
    const dmReqMatch = pathname.match(/^\/api\/chats\/requests\/([^/]+)\/(accept|hide)$/);
    if (dmReqMatch && req.method === 'POST') {
      const [, chatId, kind] = dmReqMatch;
      try {
        const result = kind === 'accept'
          ? await apiPost('/accept_dm_conversation_request', { chat_id: chatId })
          : await apiPost('/hide_dm_conversation_request', { chat_id: chatId });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    // ---- قبول كل طلبات الرسائل المعلّقة دفعة واحدة ----
    if (pathname === '/api/chats/requests/accept-all' && req.method === 'POST') {
      try {
        const listRes = await apiGet('/get_chats', { location: 'requests' });
        const requests = listRes.chats || [];
        const results = [];
        for (const c of requests) {
          try {
            await apiPost('/accept_dm_conversation_request', { chat_id: c.chat_id });
            results.push({ chatId: c.chat_id, ok: true });
          } catch (err) {
            results.push({ chatId: c.chat_id, ok: false, error: err.message });
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        return sendJSON(res, 200, { results });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- المتابعون ----
    if (pathname === '/api/social/followers' && req.method === 'GET') {
      try {
        const p = getProfile();
        const myId = p.userId || (p.user && p.user.user_id);
        const res2 = await apiPost('/get_followers', { user_id: myId });
        return sendJSON(res, 200, { users: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- مين من متابعينك أونلاين دلوقتي وفي أنهي غرفة (بيقارن بالغرف المفتوحة في الفيد) ----
    // ملحوظة: الفيد بيرجع بس معاينة (عينة) من أعضاء كل غرفة مش القائمة الكاملة، فممكن
    // ميلقاش صديق مستمع بس في غرفة كبيرة مش ظاهر في المعاينة - مش نقص فعلي في حسابه.
    if (pathname === '/api/social/friends-online' && req.method === 'GET') {
      try {
        const friends = await friendsWatcher.getFriendsOnline();
        return sendJSON(res, 200, { friends });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- تاب الأصدقاء والإشعارات: إشعارات محفوظة قابلة للنقر + آخر ظهور رصده Clubhouse mod by Darhous محليًا ----
    if (pathname === '/api/notifications' && req.method === 'GET') {
      return sendJSON(res, 200, { list: state.getNotifications() });
    }
    const notifReadMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (notifReadMatch && req.method === 'POST') {
      return sendJSON(res, 200, { list: state.markNotificationRead(decodeURIComponent(notifReadMatch[1])) });
    }
    if (pathname === '/api/notifications/read-all' && req.method === 'POST') {
      return sendJSON(res, 200, { list: state.markNotificationRead('all') });
    }
    if (pathname === '/api/notifications' && req.method === 'DELETE') {
      return sendJSON(res, 200, { list: state.clearNotifications() });
    }
    if (pathname === '/api/friends/sightings' && req.method === 'GET') {
      return sendJSON(res, 200, { sightings: state.getFriendSightings() });
    }
    const friendMuteMatch = pathname.match(/^\/api\/friends\/([^/]+)\/mute$/);
    if (friendMuteMatch && req.method === 'POST') {
      const body = await readBody(req);
      return sendJSON(res, 200, { sighting: state.setFriendMuted(decodeURIComponent(friendMuteMatch[1]), !!body.muted) });
    }

    // ---- متابعة / إلغاء متابعة / ويف / حظر عام / فك حظر ----
    const socialMatch = pathname.match(/^\/api\/social\/(follow|unfollow|wave|block|unblock)\/([^/]+)$/);
    if (socialMatch && req.method === 'POST') {
      const [, kind, userId] = socialMatch;
      const endpoint = { follow: '/follow', unfollow: '/unfollow', wave: '/send_wave', block: '/block', unblock: '/unblock' }[kind];
      try {
        const result = await apiPost(endpoint, { user_id: Number(userId) });
        state.appendAudit({ action: `social-${kind}`, targetId: userId });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- قائمة المحظورين (حسابي أنا) ----
    if (pathname === '/api/social/blocked' && req.method === 'GET') {
      try {
        const res2 = await apiPost('/get_blocked_users', {});
        return sendJSON(res, 200, { users: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- متابعون مشتركون بيني وبين أي مستخدم ----
    const mutualMatch = pathname.match(/^\/api\/social\/mutual\/([^/]+)$/);
    if (mutualMatch && req.method === 'GET') {
      try {
        const res2 = await apiPost('/get_mutual_follows', { user_id: Number(mutualMatch[1]) });
        return sendJSON(res, 200, { users: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- اكتشف أشخاص مقترحين للمتابعة ----
    if (pathname === '/api/social/discover' && req.method === 'GET') {
      try {
        const res2 = await apiPost('/get_suggested_follows_all', {});
        return sendJSON(res, 200, { users: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- مقترحات دعوة ----
    if (pathname === '/api/social/suggested-invites' && req.method === 'GET') {
      try {
        const res2 = await apiPost('/get_group_suggested_invites', {});
        const list = (res2.suggestions || []).map((s) => s.user).filter(Boolean);
        return sendJSON(res, 200, { users: list });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- الموجات (Waves) المرسلة/المستقبلة ----
    if (pathname === '/api/waves' && req.method === 'GET') {
      try {
        const type = url.searchParams.get('type') === 'sent' ? '/get_initiated_waves' : '/get_received_waves';
        const res2 = await apiGet(type, {});
        return sendJSON(res, 200, { waves: res2.waves || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- تعديل وصف هاوس ----
    const houseDescMatch = pathname.match(/^\/api\/houses\/([^/]+)\/description$/);
    if (houseDescMatch && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const result = await apiPost('/update_social_club_description', { social_club_id: houseDescMatch[1], description: body.description });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- ريبلايز هاوس معيّن ----
    const replaysMatch = pathname.match(/^\/api\/houses\/([^/]+)\/replays$/);
    if (replaysMatch && req.method === 'GET') {
      try {
        const res2 = await apiGet('/get_replays', { social_club_id: replaysMatch[1] });
        return sendJSON(res, 200, { replays: res2.replays || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- أعضاء هاوس معيّن ----
    const membersMatch = pathname.match(/^\/api\/houses\/([^/]+)\/members$/);
    if (membersMatch && req.method === 'GET') {
      try {
        const res2 = await apiPost('/get_social_club_members', { social_club_id: membersMatch[1] });
        return sendJSON(res, 200, { members: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- تعيين/إلغاء أدمن هاوس ----
    const adminMatch = pathname.match(/^\/api\/houses\/([^/]+)\/admin\/([^/]+)$/);
    if (adminMatch) {
      const [, houseId, userId] = adminMatch;
      try {
        if (req.method === 'POST') {
          const result = await apiPost('/add_club_admin', { social_club_id: houseId, user_id: Number(userId) });
          state.appendAudit({ action: 'house-add-admin', channel: houseId, targetId: userId });
          return sendJSON(res, 200, { ok: true, result });
        }
        if (req.method === 'DELETE') {
          const result = await apiPost('/remove_club_admin', { social_club_id: houseId, user_id: Number(userId) });
          state.appendAudit({ action: 'house-remove-admin', channel: houseId, targetId: userId });
          return sendJSON(res, 200, { ok: true, result });
        }
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/channel/select' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.channel) return sendJSON(res, 400, { error: 'channel مطلوب' });
      const channel = await resolveRoomLink(body.channel);
      await roomConnection.select(channel);
      return sendJSON(res, 200, { ok: true, channel });
    }

    // ---- أوامر الحساب نفسه داخل الغرفة: دخول / رفع إيد / قبول الدعوة / الرجوع للجمهور ----
    if (pathname === '/api/channel/join' && req.method === 'POST') {
      const body = await readBody(req);
      const input = body.channel || poller.getChannel();
      if (!input) return sendJSON(res, 400, { error: 'اختار غرفة الأول' });
      const channel = await resolveRoomLink(input);
      try {
        const result = await roomConnection.join(channel);
        return sendJSON(res, 200, { ok: true, channel, result });
      } catch (err) {
        return sendJSON(res, err.status || 502, { error: err.message, retryAfterMs: err.retryAfterMs || null });
      }
    }

    if (pathname === '/api/action/audience-reply' && req.method === 'POST') {
      const channel = poller.getChannel();
      const s = poller.getState();
      if (!channel || !s.connected || !s.self?.isInRoom) return sendJSON(res, 400, { error: 'الحساب مش موجود جوه الغرفة' });
      const body = await readBody(req);
      if (!['raise', 'unraise'].includes(body.action)) return sendJSON(res, 400, { error: 'action لازم يكون raise أو unraise' });
      try {
        if (body.action === 'unraise') {
          const result = await actions.audienceReply(channel, { unraiseHands: true });
          return sendJSON(res, 200, { ok: true, mode: 'handraise', result });
        }
        if (s.directSpeakAvailable) {
          const result = await actions.becomeSpeaker(channel);
          let microphone = { attempted: true, enabled: false };
          try {
            const micResult = await actions.setMicrophoneEnabled(channel, true);
            microphone = { attempted: true, enabled: micResult?.success !== false };
          } catch (err) {
            microphone = { attempted: true, enabled: false, error: err.message };
          }
          return sendJSON(res, 200, { ok: true, mode: 'direct-speaker', result, microphone });
        }
        const result = await actions.audienceReply(channel, { raiseHands: true });
        return sendJSON(res, 200, { ok: true, mode: 'handraise', result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/action/accept-speaker-invite' && req.method === 'POST') {
      const channel = poller.getChannel();
      const s = poller.getState();
      if (!channel || !s.connected || !s.self?.isInRoom) return sendJSON(res, 400, { error: 'الحساب مش موجود جوه الغرفة' });
      if (!s.self.isInvitedAsSpeaker) return sendJSON(res, 409, { error: 'مفيش دعوة تحدث معلقة دلوقتي' });
      try {
        const result = await actions.acceptSpeakerInvite(channel);
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/action/move-to-audience' && req.method === 'POST') {
      const channel = poller.getChannel();
      const s = poller.getState();
      if (!channel || !s.connected || !s.self?.isSpeaker) return sendJSON(res, 400, { error: 'الحساب مش موجود على المسرح' });
      const p = getProfile();
      const userId = p && (p.userId || (p.user && p.user.user_id));
      if (!userId) return sendJSON(res, 503, { error: 'تعذر تحديد هوية الحساب الحالي' });
      const user = findUser(userId);
      try {
        const result = await actions.moveToAudience(channel, user);
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- مغادرة حقيقية من الغرفة على سيرفر Clubhouse نفسه (مش بس وقف المراقبة المحلية) ----
    if (pathname === '/api/channel/leave' && req.method === 'POST') {
      const channel = poller.getChannel();
      if (!channel) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        const result = await roomConnection.leave(channel);
        state.appendAudit({ action: 'leave-channel', channel });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, err.status || 502, { error: err.message, retryAfterMs: err.retryAfterMs || null });
      }
    }

    // ---- إخفاء غرفة من الهالواي بتاعي ----
    if (pathname === '/api/hallway/hide' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.channel) return sendJSON(res, 400, { error: 'channel مطلوب' });
      try {
        const result = await apiPost('/hide_channel', { channel: body.channel });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- أكشنات جماعية (بتستبعد المحميين من قائمة "protected" وحسابك نفسك دايماً) ----
    function excludeProtected(users) {
      const settings = state.getSettings();
      if (!settings.protectedListEnabled) return users;
      const protectedList = state.getList('protected');
      if (!protectedList.length) return users;
      return users.filter((u) => !protectedList.some((p) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(String(p.value).toLowerCase())));
    }
    function excludeSelf(users) {
      const p = getProfile();
      const myId = p && (p.userId || (p.user && p.user.user_id));
      if (!myId) return users;
      return users.filter((u) => String(u.user_id) !== String(myId));
    }
    if (pathname === '/api/action/mute-all' && req.method === 'POST') {
      const s = poller.getState();
      const results = await actions.bulk(excludeSelf(excludeProtected(s.speakers || [])), (u) => actions.muteUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }
    if (pathname === '/api/action/invite-all' && req.method === 'POST') {
      const s = poller.getState();
      const settings = state.getSettings();
      let queue = s.raiseQueue || [];
      if (settings.speakerCapEnabled && settings.speakerCap > 0) queue = queue.slice(0, Math.max(0, settings.speakerCap - (s.speakers || []).length));
      const results = await actions.bulk(queue, (u) => actions.inviteUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }
    // ---- دعوة جماعية لكل المستمعين الموجودين دلوقتي (مش بس اللي رافعين إيدهم) ----
    if (pathname === '/api/action/invite-all-listeners' && req.method === 'POST') {
      const s = poller.getState();
      const results = await actions.bulk(s.listeners || [], (u) => actions.inviteUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }
    // ---- موافقة جماعية بشرط: دعوة أشخاص محددين بالـ id بس (من الطابور/المستمعين/النسخة الاحتياطية)
    // - بيخدم "استثني حد من الموافقة الجماعية" و"استرجاع آخر نسخة من الطابور" مع بعض ----
    if (pathname === '/api/action/invite-ids' && req.method === 'POST') {
      const body = await readBody(req);
      const ids = new Set((body.ids || []).map(String));
      if (!ids.size) return sendJSON(res, 400, { error: 'مفيش IDs متبعتة' });
      const s = poller.getState();
      const pool = [...(s.raiseQueue || []), ...(s.listeners || []), ...poller.getQueueBackup()];
      const seen = new Set();
      const targets = [];
      for (const u of pool) {
        if (ids.has(String(u.user_id)) && !seen.has(u.user_id)) { seen.add(u.user_id); targets.push(u); }
      }
      const results = await actions.bulk(targets, (u) => actions.inviteUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }
    // ---- آخر نسخة غير فاضية محفوظة من طابور رفع الإيد (قراءة فقط) ----
    if (pathname === '/api/queue/backup' && req.method === 'GET') {
      return sendJSON(res, 200, { users: poller.getQueueBackup() });
    }
    if (pathname === '/api/action/lower-all' && req.method === 'POST') {
      const s = poller.getState();
      const results = await actions.bulk(excludeSelf(excludeProtected(s.speakers || [])), (u) => actions.lowerUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }
    // ---- دور واحد بس من الطابور (بدل قبول الكل مرة واحدة) ----
    if (pathname === '/api/action/invite-next' && req.method === 'POST') {
      const s = poller.getState();
      const next = (s.raiseQueue || [])[0];
      if (!next) return sendJSON(res, 200, { ok: false, error: 'الطابور فاضي' });
      try {
        await actions.inviteUser(poller.getChannel(), next);
        return sendJSON(res, 200, { ok: true, user: next });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    // ---- وضع الهدوء: كتم + قفل رفع الإيد + جدولة فتح تلقائي بعد X دقيقة ----
    if (pathname === '/api/action/quiet-mode' && req.method === 'POST') {
      const body = await readBody(req);
      const minutes = Number(body.minutes) || 5;
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        const s = poller.getState();
        await actions.bulk(excludeProtected(s.speakers || []), (u) => actions.muteUser(channel, u));
        await actions.setHandraiseLock(channel, true);
        const at = new Date(Date.now() + minutes * 60000).toISOString();
        state.addSchedule({ type: 'unlock-handraise', at, channel });
        return sendJSON(res, 200, { ok: true, until: at });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    if (pathname === '/api/action/reaction-all' && req.method === 'POST') {
      if (guardBroadcastReactionCooldown(res)) return;
      const body = await readBody(req);
      const s = poller.getState();
      const everyone = [...(s.speakers || []), ...(s.listeners || [])];
      const results = await actions.bulk(everyone, (u) => actions.sendReaction(poller.getChannel(), u, body.value));
      return sendJSON(res, 200, { results });
    }

    // Clubhouse يقبل الترقية للموجودين على المسرح؛ المستمعون يفضلوا مستمعين لحد ما يقبلوا دعوة التحدث.
    if (pathname === '/api/action/promote-all' && req.method === 'POST') {
      const channel = poller.getChannel();
      const s = poller.getState();
      if (!channel || !s.connected) return sendJSON(res, 400, { error: 'مفيش غرفة متصلة' });
      if (s.myRole !== 'moderator') return sendJSON(res, 403, { error: 'الأمر ده متاح للمودريتور فقط' });
      const targets = excludeSelf(s.speakers || []).filter((u) => !u.is_moderator);
      const results = await actions.bulk(targets, (u) => actions.promoteModerator(channel, u));
      return sendJSON(res, 200, {
        results,
        eligible: targets.length,
        skippedListeners: (s.listeners || []).length,
      });
    }

    // ---- أكشن فردي: /api/action/user/<id>/<mute|invite|lower|reaction|kick|promote> ----
    const userActionMatch = pathname.match(/^\/api\/action\/user\/([^/]+)\/(mute|invite|lower|reaction|kick|promote|demote)$/);
    if (userActionMatch && req.method === 'POST') {
      const [, userId, kind] = userActionMatch;
      const user = findUser(userId);
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        if (kind === 'mute') await actions.muteUser(channel, user);
        if (kind === 'invite') await actions.inviteUser(channel, user);
        if (kind === 'lower') await actions.lowerUser(channel, user);
        if (kind === 'kick') await actions.kickUser(channel, user);
        if (kind === 'promote') await actions.promoteModerator(channel, user);
        if (kind === 'demote') await actions.demoteModerator(channel, user);
        if (kind === 'reaction') {
          const body = await readBody(req);
          await actions.sendReaction(channel, user, body.value);
        }
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- رياكت GIF لشخص معيّن (عقد مرشح — giphy_id بيتلصق يدوي، Clubhouse mod by Darhous مفيهوش بحث Giphy) ----
    const gifReactionMatch = pathname.match(/^\/api\/action\/user\/([^/]+)\/gif-reaction$/);
    if (gifReactionMatch && req.method === 'POST') {
      const user = findUser(gifReactionMatch[1]);
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      const body = await readBody(req);
      if (!body.giphyId) return sendJSON(res, 400, { error: 'معرّف GIF مطلوب' });
      try {
        await actions.sendGifReaction(channel, user, String(body.giphyId));
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- إيموجي بجانب اسمك في الغرفة المتصلة (عقد مرشح) ----
    if (pathname === '/api/action/channel-emoji' && req.method === 'POST') {
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      const body = await readBody(req);
      if (!body.emoji) return sendJSON(res, 400, { error: 'الإيموجي مطلوب' });
      try {
        await actions.setChannelEmoji(channel, String(body.emoji));
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    if (pathname === '/api/action/channel-emoji/clear' && req.method === 'POST') {
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        await actions.clearChannelEmoji(channel);
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- جيب أي حد (من نتايج البحث الاجتماعي مثلاً) للغرفة المتصلة حالياً ----
    const bringMatch = pathname.match(/^\/api\/action\/bring-to-room\/([^/]+)$/);
    if (bringMatch && req.method === 'POST') {
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        await actions.bringToRoom(channel, bringMatch[1]);
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- رفع جماعي لكل الـ VIP الموجودين فعلاً بين المستمعين دلوقتي ----
    if (pathname === '/api/action/invite-all-vip' && req.method === 'POST') {
      const s = poller.getState();
      const vip = state.getList('vip');
      const targets = (s.listeners || []).filter((u) => vip.some((v) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(String(v.value).toLowerCase())));
      const results = await actions.bulk(targets, (u) => actions.inviteUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }

    // ---- طرد جماعي لكل القايمة السوداء الموجودين فعلاً في الغرفة دلوقتي (سبيكرز أو مستمعين) ----
    if (pathname === '/api/action/kick-all-blacklisted' && req.method === 'POST') {
      const s = poller.getState();
      const blacklist = state.getList('blacklist');
      const everyone = [...(s.speakers || []), ...(s.listeners || [])];
      const targets = everyone.filter((u) => blacklist.some((b) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(String(b.value).toLowerCase())));
      const results = await actions.bulk(targets, (u) => actions.kickUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }

    // ---- ترحيب فوري بكل الموجودين دلوقتي: اسم كل واحد + قلب، بفاصل أبطأ من البلك العادي عشان الأمان ----
    if (pathname === '/api/action/welcome-all' && req.method === 'POST') {
      if (guardBroadcastReactionCooldown(res)) return;
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      const s = poller.getState();
      const everyone = uniqueUsers([...(s.speakers || []), ...(s.listeners || [])]);
      const WELCOME_ALL_CAP = 50;
      const targets = everyone.slice(0, WELCOME_ALL_CAP);
      welcomeReactionRunning = true;
      try {
        const results = await actions.bulk(targets, (u) => actions.sendReaction(channel, u, `${u.name || u.username || 'صديق'} ❤️`), 5000);
        return sendJSON(res, 200, { results, total: everyone.length, capped: everyone.length > WELCOME_ALL_CAP });
      } finally { welcomeReactionRunning = false; }
    }

    // ---- بث GIF على كل الحاضرين — Clubhouse نفسه معندوش endpoint جماعي لـGIF، فبنبعته لكل شخص لوحده ----
    if (pathname === '/api/action/gif-reaction-all' && req.method === 'POST') {
      if (guardBroadcastReactionCooldown(res)) return;
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      const body = await readBody(req);
      if (!body.giphyId) return sendJSON(res, 400, { error: 'معرّف GIF مطلوب' });
      const s = poller.getState();
      const targets = [...(s.speakers || []), ...(s.listeners || [])];
      const results = await actions.bulk(targets, (u) => actions.sendGifReaction(channel, u, String(body.giphyId)));
      return sendJSON(res, 200, { results });
    }

    // ---- تفعيل/تعطيل الشات النصي داخل الغرفة ----
    if (pathname === '/api/action/room-messages' && req.method === 'POST') {
      const body = await readBody(req);
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        await actions.setRoomMessages(channel, !!body.enabled);
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- إضافة/حذف رابط مرفق بالغرفة ----
    if (pathname === '/api/action/room-link' && req.method === 'POST') {
      const body = await readBody(req);
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      if (!body.link) return sendJSON(res, 400, { error: 'الرابط مطلوب' });
      try {
        const result = await actions.addRoomLink(channel, body.link);
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    if (pathname === '/api/action/room-link' && req.method === 'DELETE') {
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        await actions.removeRoomLink(channel);
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- فحص صلاحية رابط قبل إضافته (قراءة فقط - آمن) ----
    if (pathname === '/api/check-link' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const result = await apiPost('/check_channel_link', { link: body.link });
        return sendJSON(res, 200, { ok: true, result });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- آخر المتكلمين في غرفك الأخيرة (قراءة فقط) ----
    if (pathname === '/api/recent-speakers' && req.method === 'GET') {
      try {
        const res2 = await apiGet('/get_recent_channels_speakers', {});
        return sendJSON(res, 200, { users: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- عارضين الريبلاي للغرفة المتصلة (قراءة فقط) ----
    // ملحوظة: Clubhouse بيرفض الطلب ده لغرفة لسه شغالة (مفيش ريبلاي لغرفة متسجّلتش وانتهت لسه)
    // فبنرجّع قايمة فاضية بدل خطأ - ده وضع طبيعي مش عطل.
    if (pathname === '/api/room/replayers' && req.method === 'GET') {
      const channel = poller.getChannel();
      if (!channel) return sendJSON(res, 200, { users: [] });
      if (!poller.getState().raw?.is_replay) return sendJSON(res, 200, { users: [], available: false, reason: 'الغرفة مباشرة؛ بيانات مستمعي الريبلاي غير متاحة' });
      try {
        const res2 = await apiPost('/get_channel_replayers', { channel });
        return sendJSON(res, 200, { users: res2.users || [] });
      } catch (err) {
        return sendJSON(res, 200, { users: [] });
      }
    }

    // ---- رفع أول N بس من طابور رفع الإيد ----
    if (pathname === '/api/action/invite-next-n' && req.method === 'POST') {
      const body = await readBody(req);
      const n = Math.max(1, Number(body.n) || 1);
      const s = poller.getState();
      const targets = (s.raiseQueue || []).slice(0, n);
      const results = await actions.bulk(targets, (u) => actions.inviteUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }

    // ---- كتم كل السبيكرز عدا المودريتورز ----
    if (pathname === '/api/action/mute-non-mods' && req.method === 'POST') {
      const s = poller.getState();
      const targets = (s.speakers || []).filter((u) => !u.is_moderator);
      const results = await actions.bulk(targets, (u) => actions.muteUser(poller.getChannel(), u));
      return sendJSON(res, 200, { results });
    }

    // ---- تحكمات إضافية على الغرفة: قفل رفع الإيد / عنوان / إنهاء ----
    if (pathname === '/api/action/handraise-lock' && req.method === 'POST') {
      const body = await readBody(req);
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        await actions.setHandraiseLock(channel, !!body.locked);
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    if (pathname === '/api/action/room-title' && req.method === 'POST') {
      const body = await readBody(req);
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        await actions.setRoomTitle(channel, body.title);
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }
    if (pathname === '/api/action/end-room' && req.method === 'POST') {
      const channel = poller.getChannel();
      if (!channel || !poller.getState().connected) return sendJSON(res, 400, { error: 'مفيش غرفة متختارة' });
      try {
        await actions.endRoom(channel);
        poller.stop();
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- قوائم: vip / blacklist / presets / protected / shifts (نوبات مودريتور) / modbackup (مودريتور احتياطي) ----
    const listMatch = pathname.match(/^\/api\/(vip|blacklist|presets|protected|shifts|modbackup)$/);
    if (listMatch) {
      const name = listMatch[1];
      if (req.method === 'GET') return sendJSON(res, 200, { list: state.getList(name) });
      if (req.method === 'POST') {
        const body = await readBody(req);
        return sendJSON(res, 200, { list: state.addToList(name, body.value) });
      }
    }
    const listDeleteMatch = pathname.match(/^\/api\/(vip|blacklist|presets|protected|shifts|modbackup)\/([^/]+)$/);
    if (listDeleteMatch && req.method === 'DELETE') {
      const [, name, id] = listDeleteMatch;
      return sendJSON(res, 200, { list: state.removeFromList(name, id) });
    }

    // ---- الإعدادات العامة (كتم تلقائي لأي سبيكر جديد...) ----
    if (pathname === '/api/settings' && req.method === 'GET') {
      return sendJSON(res, 200, state.getSettings());
    }
    if (pathname === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req);
      const [key] = Object.keys(body);
      if (key === 'serverReadOnlyMode' && body[key]) operationManager.cancelAllOperations();
      return sendJSON(res, 200, state.setSetting(key, body[key]));
    }

    // ---- مفتاح Giphy API (محلي، منفصل عن settings.json عشان مايتحفظش في Git) ----
    if (pathname === '/api/settings/giphy-key' && req.method === 'GET') {
      return sendJSON(res, 200, { key: state.getSecrets().giphyApiKey || '' });
    }
    if (pathname === '/api/settings/giphy-key' && req.method === 'POST') {
      const body = await readBody(req);
      state.setSecret('giphyApiKey', String(body.key || '').trim());
      return sendJSON(res, 200, { ok: true });
    }

    // ---- بحث GIF عبر Giphy (محتاج مفتاح API متسجّل) ----
    if (pathname === '/api/gif/search' && req.method === 'GET') {
      const key = state.getSecrets().giphyApiKey;
      if (!key) return sendJSON(res, 400, { error: 'محتاج تحط مفتاح Giphy API الأول من الإعدادات' });
      const q = String(url.searchParams.get('q') || '').trim();
      if (!q) return sendJSON(res, 400, { error: 'اكتب كلمة للبحث' });
      try {
        const giphyRes = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=15&rating=pg-13`);
        const json = await giphyRes.json();
        if (!giphyRes.ok) return sendJSON(res, 502, { error: json.message || `Giphy رفض الطلب (${giphyRes.status})` });
        const results = (json.data || []).map((g) => ({
          id: g.id,
          title: g.title || '',
          preview: g.images?.fixed_height_small?.url || g.images?.preview_gif?.url || g.images?.original?.url,
        }));
        return sendJSON(res, 200, { results });
      } catch (err) {
        return sendJSON(res, 502, { error: err.message });
      }
    }

    // ---- الجدولة ----
    if (pathname === '/api/schedule' && req.method === 'GET') {
      return sendJSON(res, 200, { list: state.getSchedule() });
    }
    if (pathname === '/api/schedule' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJSON(res, 200, { list: state.addSchedule(body) });
    }
    const schedDeleteMatch = pathname.match(/^\/api\/schedule\/([^/]+)$/);
    if (schedDeleteMatch && req.method === 'DELETE') {
      return sendJSON(res, 200, { list: state.removeSchedule(schedDeleteMatch[1]) });
    }

    // ---- سجل الأكشنات ----
    if (pathname === '/api/audit-log' && req.method === 'GET') {
      return sendJSON(res, 200, { list: state.getAudit() });
    }

    // ---- سجل تراكمي لشخص معين عبر كل الغرف (من سجل الأكشنات المحفوظ - آخر 500 حركة) ----
    const userHistoryMatch = pathname.match(/^\/api\/user-history\/([^/]+)$/);
    if (userHistoryMatch && req.method === 'GET') {
      const id = userHistoryMatch[1];
      const entries = state.getAudit().filter((a) => String(a.targetId) === String(id));
      const counts = {};
      for (const a of entries) counts[a.action] = (counts[a.action] || 0) + 1;
      // getAudit() بيرجع الأحدث الأول (unshift عند الإضافة)، فآخر عنصر هو أقدم تفاعل مسجّل
      const firstSeen = entries.length ? entries[entries.length - 1].time : null;
      return sendJSON(res, 200, { total: entries.length, counts, recent: entries.slice(0, 10), firstSeen });
    }

    // ---- الأرشيف ----
    if (pathname === '/api/archive' && req.method === 'GET') {
      return sendJSON(res, 200, { list: state.listArchives() });
    }
    const archiveDetailMatch = pathname.match(/^\/api\/archive\/([^/]+)$/);
    if (archiveDetailMatch && req.method === 'GET') {
      const data = state.readArchive(archiveDetailMatch[1]);
      if (!data) return sendJSON(res, 404, { error: 'not found' });
      return sendJSON(res, 200, { archive: data });
    }
    if (archiveDetailMatch && req.method === 'DELETE') {
      state.deleteArchive(archiveDetailMatch[1]);
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { error: 'not found' });
  } catch (err) {
    return sendJSON(res, err.status || 500, { error: err.message, retryAfterMs: err.retryAfterMs || null });
  }
});

server.listen(PORT, () => {
  console.log(`Clubhouse mod by Darhous شغال على http://localhost:${PORT}`);
  friendsWatcher.start();
});
