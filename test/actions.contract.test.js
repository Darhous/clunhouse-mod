'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const audits = [];
const clientPath = require.resolve('../lib/chClient');
const statePath = require.resolve('../lib/state');

require.cache[clientPath] = {
  id: clientPath,
  filename: clientPath,
  loaded: true,
  exports: {
    apiPost: async (path, body) => {
      calls.push({ path, body });
      return { success: true };
    },
    apiPostModernRoom: async (path, body) => {
      calls.push({ path, body, modernRoom: true });
      return { success: true };
    },
  },
};
require.cache[statePath] = {
  id: statePath,
  filename: statePath,
  loaded: true,
  exports: {
    appendAudit: (entry) => audits.push(entry),
    getSettings: () => ({}),
    addToList: () => {},
  },
};

const actions = require('../lib/actions');

test('room self-actions use the verified Clubhouse endpoint contracts', async () => {
  await actions.joinChannel('room-code');
  await actions.keepChannelAlive('room-code');
  await actions.audienceReply('room-code', { raiseHands: true });
  await actions.audienceReply('room-code', { unraiseHands: true });
  await actions.becomeSpeaker('room-code');
  await actions.setMicrophoneEnabled('room-code', true);
  await actions.sendReaction('room-code', { user_id: 14, name: 'Target' }, '🔥');
  await actions.acceptSpeakerInvite('room-code');
  await actions.moveToAudience('room-code', { user_id: 42, name: 'Test User' });

  assert.deepEqual(calls, [
    { path: '/join_channel', body: { channel: 'room-code' } },
    { path: '/active_ping', body: { channel: 'room-code' } },
    { path: '/audience_reply', body: { channel: 'room-code', raise_hands: true, unraise_hands: false }, modernRoom: true },
    { path: '/audience_reply', body: { channel: 'room-code', raise_hands: false, unraise_hands: true }, modernRoom: true },
    { path: '/become_speaker', body: { channel: 'room-code' }, modernRoom: true },
    { path: '/update_microphone_enabled', body: { channel: 'room-code', microphone_enabled: true }, modernRoom: true },
    { path: '/emoji_reaction', body: { channel: 'room-code', user_id: 14, emoji: '🔥' }, modernRoom: true },
    { path: '/accept_speaker_invite', body: { channel: 'room-code' } },
    { path: '/uninvite_speaker', body: { channel: 'room-code', user_id: 42 } },
  ]);
  assert.deepEqual(audits.map((entry) => entry.action), [
    'join-channel',
    'raise-hand',
    'lower-hand',
    'become-speaker',
    'microphone-enable',
    'reaction',
    'accept-speaker-invite',
    'move-self-to-audience',
  ]);
});

test('new engagement actions (channel emoji, gif reaction) use the candidate contracts', async () => {
  calls.length = 0;
  audits.length = 0;
  await actions.setChannelEmoji('room-code', '🎟');
  await actions.clearChannelEmoji('room-code');
  await actions.sendGifReaction('room-code', { user_id: 14, name: 'Target' }, 'abc123');

  assert.deepEqual(calls, [
    { path: '/set_user_channel_emoji', body: { channel: 'room-code', emoji: '🎟' } },
    { path: '/remove_user_channel_emoji', body: { channel: 'room-code' } },
    { path: '/gif_reaction', body: { channel: 'room-code', user_id: 14, giphy_id: 'abc123' }, modernRoom: true },
  ]);
  assert.deepEqual(audits.map((entry) => entry.action), ['set-channel-emoji', 'clear-channel-emoji', 'gif-reaction']);
});

test('bulk stops at 429 and reports unattempted targets as skipped', async () => {
  const pollerPath = require.resolve('../lib/poller'), accountPath = require.resolve('../lib/account');
  const profile = { userId: 1 };
  require.cache[pollerPath] = { id: pollerPath, filename: pollerPath, loaded: true, exports: { getContext: () => 1 } };
  require.cache[accountPath] = { id: accountPath, filename: accountPath, loaded: true, exports: { getActiveProfile: () => profile } };
  let count = 0;
  const result = await actions.bulk([{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }], async () => {
    count++; throw Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 30000 });
  }, 0);
  assert.equal(count, 1); assert.equal(result.length, 3);
  assert.equal(result[0].status, 429); assert.equal(result[1].skipped, true); assert.equal(result[2].skipped, true);
});
