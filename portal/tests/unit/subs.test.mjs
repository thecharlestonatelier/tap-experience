/* Characterization pin for portal/store/subs.js.
   Pins the subscription sanitizer, the endpoint-derived id, and the
   dueNow scheduler guard. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import subs from '../../store/subs.js';

const now = Date.parse('2026-03-15T12:00:00Z');

test('idFor is a stable 32-char sha256 of the endpoint', () => {
  assert.equal(subs.idFor('https://web.push.apple.com/abc'),
    '3333140aac13e319742cc23ced811fe2');
});

test('sanitizeSub keeps a well-formed subscription', () => {
  const out = subs.sanitizeSub({
    sub: { endpoint: 'https://e.com/x', keys: { p256dh: 'pk', auth: 'au' } },
    due: [], tz: 'America/New_York',
  }, 'phil.h');
  assert.equal(out.id, '94ef2cbbf778601d3b154c719cf078ee');
  assert.equal(out.slug, 'phil.h');
  assert.deepEqual(out.sub, { endpoint: 'https://e.com/x', keys: { p256dh: 'pk', auth: 'au' } });
  assert.deepEqual(out.due, []);
  assert.equal(out.sentUpTo, '');
  assert.equal(out.tz, 'America/New_York');
});

test('sanitizeSub rejects a non-https endpoint and missing keys', () => {
  assert.equal(subs.sanitizeSub({
    sub: { endpoint: 'http://e.com/x', keys: { p256dh: 'pk', auth: 'au' } },
  }, 'phil.h'), null);
  assert.equal(subs.sanitizeSub({ sub: { endpoint: 'https://e.com/x' } }, 'phil.h'), null);
});

test('dueNow skips what is already sent', () => {
  assert.equal(subs.dueNow({
    due: ['2026-03-15T10:00:00.000Z'],
    sentUpTo: '2026-03-15T11:00:00.000Z',
  }, now), null);
});

test('dueNow ignores future instants', () => {
  assert.equal(subs.dueNow({ due: ['2026-03-16T10:00:00.000Z'] }, now), null);
});

test('dueNow picks the instant due right now', () => {
  assert.equal(subs.dueNow({ due: ['2026-03-15T12:00:00.000Z'] }, now),
    '2026-03-15T12:00:00.000Z');
});

test('dueNow drops a stale reminder', () => {
  assert.equal(subs.dueNow({ due: ['2026-03-14T01:00:00.000Z'] }, now), null);
});
