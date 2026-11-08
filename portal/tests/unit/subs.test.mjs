/* Characterization pin for portal/store/subs.js.
   Pins the subscription sanitizer, the endpoint-derived id, and the
   dueNow scheduler guard. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

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

test('dueNow picks the most recent qualifying instant', () => {
  const t1 = '2026-03-15T11:00:00.000Z';
  const t2 = '2026-03-15T11:50:00.000Z';
  assert.equal(subs.dueNow({ due: [t1, t2] }, now), t2);
});

test('dueNow stops at the first future instant', () => {
  assert.equal(subs.dueNow({ due: ['2026-03-15T11:00:00.000Z', '2026-03-15T13:00:00.000Z'] }, now),
    '2026-03-15T11:00:00.000Z');
});

test('sanitizeSub cleans, dedups and sorts the due list', () => {
  const future = new Date(Date.now() + 3600000).toISOString();
  const stale = new Date(Date.now() - 48 * 3600000).toISOString();
  const out = subs.sanitizeSub({
    sub: { endpoint: 'https://e/x', keys: { p256dh: 'pk', auth: 'au' } },
    due: [future, 'bad', future, stale],
  }, 'x.y');
  assert.deepEqual(out.due, [future]);
});

test('a resubscribe keeps createdAt and sentUpTo', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-subs-'));
  process.env.CARD_STORE = 'file';
  process.env.SUB_FILE = path.join(tmp, 'subs.json');
  const store = subs.openSubs();
  const base = {
    id: 's1', slug: 'x.y',
    sub: { endpoint: 'https://e/x', keys: { p256dh: 'p', auth: 'a' } },
    due: [], sentUpTo: '2026-01-01T00:00:00.000Z', tz: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  await store.put(base);
  const merged = await store.put({ ...base, sentUpTo: '', createdAt: '2027-01-01T00:00:00.000Z' });
  assert.equal(merged.createdAt, base.createdAt);
  assert.equal(merged.sentUpTo, base.sentUpTo);
});
