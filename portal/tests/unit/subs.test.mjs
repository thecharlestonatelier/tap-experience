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
    sub: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'pk', auth: 'au' } },
    due: [], tz: 'America/New_York',
  }, 'phil.h');
  assert.equal(out.id, 'ff1fb28f3bb00e75861a9578e8f138fa');
  assert.equal(out.slug, 'phil.h');
  assert.deepEqual(out.sub, { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'pk', auth: 'au' } });
  assert.deepEqual(out.due, []);
  assert.equal(out.sentUpTo, '');
  assert.equal(out.tz, 'America/New_York');
});

test('sanitizeSub rejects a non-https endpoint and missing keys', () => {
  assert.equal(subs.sanitizeSub({
    sub: { endpoint: 'http://e.com/x', keys: { p256dh: 'pk', auth: 'au' } },
  }, 'phil.h'), null);
  assert.equal(subs.sanitizeSub({ sub: { endpoint: 'https://fcm.googleapis.com/x' } }, 'phil.h'), null);
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
    sub: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'pk', auth: 'au' } },
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
    sub: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } },
    due: [], sentUpTo: '2026-01-01T00:00:00.000Z', tz: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  await store.put(base);
  const merged = await store.put({ ...base, sentUpTo: '', createdAt: '2027-01-01T00:00:00.000Z' });
  assert.equal(merged.createdAt, base.createdAt);
  assert.equal(merged.sentUpTo, base.sentUpTo);
});

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('subs default the collection name', () => {
  assert.equal(subs.COLLECTION, 'reminders');
});

test('sanitizeSub stamps ISO created and updated times', () => {
  const out = subs.sanitizeSub({ sub: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }, due: [] }, 'x');
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
});

test('sanitizeSub rejects a non-string endpoint', () => {
  assert.equal(subs.sanitizeSub({ sub: { endpoint: 5, keys: { p256dh: 'p', auth: 'a' } } }, 'x'), null);
});

test('dueNow treats an instant equal to sentUpTo as sent', () => {
  assert.equal(subs.dueNow({ due: ['2026-03-15T10:00:00.000Z'], sentUpTo: '2026-03-15T10:00:00.000Z' }, now), null);
});

test('dueNow fires an instant exactly at the grace edge', () => {
  assert.equal(subs.dueNow({ due: ['2026-03-15T10:00:00.000Z'] }, now), '2026-03-15T10:00:00.000Z');
});

test('dueNow picks the latest of several', () => {
  assert.equal(subs.dueNow({ due: ['2026-03-15T10:00:00.000Z', '2026-03-15T11:00:00.000Z', '2026-03-15T11:30:00.000Z'] }, now),
    '2026-03-15T11:30:00.000Z');
});

test('the file subs store pings, filters and marks sent', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-subs2-'));
  process.env.CARD_STORE = 'file';
  process.env.SUB_FILE = path.join(tmp, 'subs.json');
  const store = subs.openSubs();
  await store.ping();
  assert.ok(fs.existsSync(path.join(tmp, 'subs.json')));
  const base = (id, slug) => ({ id, slug, sub: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }, due: [], sentUpTo: '', tz: '', createdAt: 't', updatedAt: 't' });
  await store.put(base('a', 'x'));
  await store.put(base('b', 'y'));
  assert.equal((await store.forSlug('x')).length, 1);
  assert.equal((await store.forSlug('nope')).length, 0);
  await store.markSent('a', '2026-01-01T00:00:00.000Z');
  assert.equal((await store.forSlug('x'))[0].sentUpTo, '2026-01-01T00:00:00.000Z');
  await store.markSent('missing', '2026-01-01T00:00:00.000Z');
});
