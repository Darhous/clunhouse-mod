'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('HTTP wiring: chat read/send/delete/settings, stale context and read-only guard (no live API)', async (t) => {
  const source = `
    const {EventEmitter}=require('events');
    const stub=(name,exports)=>{const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
    const settings={};
    const profile={userId:1,user:{user_id:1,name:'Test'}};
    const room={connected:true,channel:'fixture',speakers:[{user_id:1,name:'Test',is_moderator:true}],listeners:[],self:{isInRoom:true,isModerator:true},raw:{is_chat_enabled:true}};
    stub('./lib/account',{getActiveProfile:()=>profile,getActiveIdentity:()=>({userId:1,user:profile.user})});
    stub('./lib/state',{getSettings:()=>settings,setSetting:(k,v)=>{settings[k]=v;return settings;},appendAudit:()=>{}});
    stub('./lib/poller',{bus:new EventEmitter(),getState:()=>room,getChannel:()=>room.channel,getContext:()=>1,start:()=>{},stop:()=>{}});
    stub('./lib/friendsWatcher',{bus:new EventEmitter(),start:()=>{}});
    stub('./lib/chClient',{log:new EventEmitter(),buildHeaders:()=>({}),MODERN_ROOM_CLIENT:{},
      apiGet:async(p,q)=>({success:true,messages:[{message_id:'123',message:'test',user_profile:{user_id:1,name:'Test'}}],next_cursor:null}),
      apiPost:async(p,b,profile,validate)=>{validate?.();return {success:true,echo:b};}});
    const actions=require('./lib/actions');
    actions.bulk=async(targets,worker,delayMs)=>targets.map(user=>({user,ok:true,delayMs}));
    const http=require('http'),original=http.createServer;
    http.createServer=(...args)=>{const s=original(...args);s.on('listening',()=>console.log('TEST_PORT='+s.address().port));return s;};
    require('./server');
  `;
  const child = spawn(process.execPath, ['-e', source], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timer = setTimeout(() => reject(new Error('fixture server timeout: ' + errors)), 10000);
    child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/TEST_PORT=(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${errors}`)); });
    child.on('error', reject);
  });
  const api = async (route, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const state = await api('/api/room-chat');
  assert.equal(state.status, 200); assert.equal(state.body.canSend, true);
  const context = state.body.context;
  const messages = await api('/api/room-chat/messages?context=' + context);
  assert.equal(messages.body.messages[0].text, 'test');
  assert.equal((await api('/api/room-chat/send', { context, message: 'hello' })).body.result.echo.message, 'hello');
  assert.equal((await api('/api/room-chat/delete', { context, messageId: '123' })).status, 200);
  assert.equal((await api('/api/room-chat/send', { context: 'stale', message: 'hello' })).status, 409);
  assert.equal((await api('/api/room-chat/like', { context, messageId: '123', liked: true })).status, 200);
  assert.equal((await api('/api/room-chat/like', { context, messageId: '123', liked: false })).status, 200);
  const joins = await Promise.all(Array.from({ length: 20 }, () => api('/api/channel/join', { channel: 'fixture' })));
  assert.ok(joins.every(result => result.status === 200 && result.body.result.alreadyJoined));
  const effects = await api('/api/action/welcome-all', {});
  assert.equal(effects.status, 200); assert.equal(effects.body.results[0].delayMs, 5000);
  await api('/api/room-chat/welcome', { context, scope: 'all' });
  let result = await api('/api/room-chat');
  assert.equal(result.body.operation.succeeded, 1);
  await api('/api/room-chat/welcome', { context, scope: 'all' });
  result = await api('/api/room-chat');
  assert.equal(result.body.operation.skipped, 1); assert.equal(result.body.operation.succeeded, 0); assert.equal(result.body.operation.failed, 0);
  assert.equal((await api('/api/room-chat/settings', { template: 'أهلا {الاسم}', autoWelcome: false })).status, 200);
  await api('/api/settings', { serverReadOnlyMode: true });
  assert.equal((await api('/api/room-chat/send', { context, message: 'hello' })).status, 423);
  assert.equal((await api('/api/room-chat/settings', { autoWelcome: false })).status, 200);
  const log = await fetch(`http://127.0.0.1:${port}/api/log/export`);
  assert.equal(log.status, 200); assert.match(await log.text(), /modpanel-log-v2/);
});
