'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../lib/endpointRegistry');
const operations = require('../lib/operationManager');
const { safeLogBody } = require('../lib/chClient');

test('endpoint registry distinguishes verified, candidate, and unsupported contracts', () => {
  assert.equal(registry.getEndpoint('get_channel').status, 'verified');
  assert.equal(registry.getEndpoint('/create_channel').status, 'candidate');
  assert.equal(registry.getEndpoint('get_channels').status, 'unsupported');
  assert.equal(registry.getEndpoint('start_phone_number_auth').status, 'human');
  assert.equal(registry.getEndpoint('email_auth').status, 'unsupported');
  const summary = registry.endpointSummary();
  assert.ok(summary.total >= 50);
  assert.ok(summary.byStatus.verified > 0);
});

test('API logs redact account credentials recursively', () => {
  const safe = safeLogBody({
    phone_number: '+201000000000', verification_code: '1234',
    nested: { auth_token: 'secret', accessToken: 'also-secret', ordinary: 'visible' },
  });
  assert.equal(safe.phone_number, '[REDACTED]');
  assert.equal(safe.verification_code, '[REDACTED]');
  assert.equal(safe.nested.auth_token, '[REDACTED]');
  assert.equal(safe.nested.accessToken, '[REDACTED]');
  assert.equal(safe.nested.ordinary, 'visible');
  assert.doesNotMatch(JSON.stringify(safe), /201000000000|1234|secret/);
});

test('operation manager clamps intervals and supports dry-run without invoking worker', async () => {
  let calls = 0;
  const operation = operations.createOperation({
    kind: 'test-preview', label: 'معاينة', dryRun: true, intervalMs: 1,
    items: [{ key: 'one', userId: 1 }], worker: async () => { calls++; },
  });
  assert.equal(operation.status, 'preview');
  assert.equal(operation.intervalMs, 600);
  assert.equal(calls, 0);
});
