'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRoomLink } = require('../lib/roomLink');
test('direct room links and codes resolve without fetching', async () => {
  const noNetwork = () => { throw new Error('unexpected fetch'); };
  assert.equal(await resolveRoomLink(' xkorVvB1 ', noNetwork), 'xkorVvB1');
  assert.equal(await resolveRoomLink('https://www.clubhouse.com/room/xkorVvB1?test=1', noNetwork), 'xkorVvB1');
});
test('official invitation resolves its channel, not the invitation code, without credentials', async () => {
  const fetchMock = async (url, options) => {
    assert.equal(url, 'https://www.clubhouse.com/i/test/NylJKGlt');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers, undefined);
    const json = { props: { pageProps: { routeProps: { channel: { channel: 'xkorVvB1' }, is_live: true } } } };
    return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(json)}</script>`);
  };
  assert.equal(await resolveRoomLink('https://www.clubhouse.com/i/test/NylJKGlt?tracking=1', fetchMock), 'xkorVvB1');
});
test('room resolver rejects nonofficial hosts, credentials, malformed pages and ended rooms', async () => {
  for (const url of ['https://evil.test/i/test/code', 'http://www.clubhouse.com/i/test/code', 'https://u:p@www.clubhouse.com/i/test/code', 'https://www.clubhouse.com:8443/i/test/code', 'https://www.clubhouse.com/other/path', 'https://clubhouse.com.evil.test/room/code']) {
    await assert.rejects(resolveRoomLink(url, () => { throw new Error('must not fetch'); }), { status: 400 });
  }
  await assert.rejects(resolveRoomLink('https://www.clubhouse.com/i/test/code', async () => new Response('bad page')), { status: 502 });
  const ended = { props: { pageProps: { routeProps: { channel: { channel: 'abcd' }, is_live: false } } } };
  await assert.rejects(resolveRoomLink('https://www.clubhouse.com/i/test/code', async () => new Response(`<script id="__NEXT_DATA__">${JSON.stringify(ended)}</script>`)), { status: 410 });
});
