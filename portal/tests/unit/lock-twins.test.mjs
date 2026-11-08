/* QA explorer proving tests — the writeCard pen lock against twin pens.
 *
 * Two same-template pens (ghk#0 / ghk#1) share ONE dose-log key (the
 * template `ghk`), which is fine for the log. But the writeCard lock keys
 * BOTH the start-date comparison and the pen-time comparison on
 * `pen.template` too, so the two pens collapse into one entry:
 *
 *   - beforePens = new Map(existing.pens.map(p => [p.template || p.id, p]))
 *     keeps only the LAST twin, so the first twin's start-date check is made
 *     against the second twin's start date.
 *   - beforeTimes / nextTimes are keyed `ghk`, while the studio's per-pen time
 *     rows store twin times under `ghk#0` / `ghk#1` — so a time change on a
 *     twin is never compared and never locked.
 *
 * Runs the real server in-process against a file store, like route.test.mjs;
 * no emulator needed. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-qax-twins-'));
process.env.CARD_STORE = 'file';
process.env.CARD_FILE = path.join(tmp, 'cards.json');
process.env.DOSE_FILE = path.join(tmp, 'doses.json');
process.env.SUB_FILE = path.join(tmp, 'subs.json');
process.env.FEED_FILE = path.join(tmp, 'feeds.json');
process.env.STUDIO_PASSPHRASE = 'testpassphrase';
process.env.PUSH_RUN_SECRET = 'test-run-secret';

/* VAPID keys so push.js is "configured" at module load. */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
const jwk = privateKey.export({ format: 'jwk' });
process.env.VAPID_PUBLIC_KEY = Buffer.from(pubRaw).toString('base64url');
process.env.VAPID_PRIVATE_KEY = jwk.d;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const { server } = await import('../../server.js');

let base;
let studioCookie;

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await req('POST', '/api/session', { body: { passphrase: 'testpassphrase' } });
  assert.equal(r.status, 200);
  studioCookie = r.headers.getSetCookie().find(c => c.startsWith('ca_studio=')).split(';')[0];
});

after(() => server.close());

async function req(method, pathname, { body, headers } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: Object.assign(
      body !== undefined ? { 'Content-Type': 'application/json' } : {},
      headers || {},
    ),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  if (text) { try { parsed = JSON.parse(text); } catch { /* not json */ } }
  return { status: res.status, headers: res.headers, body: parsed };
}
const studio = () => ({ Cookie: studioCookie });

/* Finding A — the per-pen TIME lock is fail-open for twin pens.
 *
 * The patient card locks BOTH twins' time chips once one twin logs a first
 * dose (pen-time-chips-twins.mjs), so the server half should refuse a time
 * change on either twin the same way. It does not: it compares
 * beforeTimes['ghk'] vs nextTimes['ghk'] — two undefineds — and never sees
 * the change stored under 'ghk#0'. */
test('a logged twin pen refuses a per-pen time change (pen_time_locked)', async () => {
  const slug = `twl${Date.now().toString(36)}.t`;
  await req('POST', '/api/cards', {
    headers: studio(),
    body: {
      slug, name: 'Twin Lock',
      pens: [{ template: 'ghk', startDate: '2026-05-01' }, { template: 'ghk', startDate: '2026-05-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { 'ghk#0': '08:00', 'ghk#1': '09:00' } },
    },
  });
  await req('POST', '/api/dose', {
    body: { slug, template: 'ghk', units: 1, at: '2026-05-01T08:00:00.000Z', day: '2026-05-01' },
  });

  const res = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk', startDate: '2026-05-01' }, { template: 'ghk', startDate: '2026-05-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { 'ghk#0': '10:00', 'ghk#1': '09:00' } },
    },
  });

  assert.equal(res.status, 409, 'expected 409 pen_time_locked for a logged twin');
  assert.equal(res.body.error, 'pen_time_locked');
});

/* Finding B — the per-pen START lock is false-positive for twin pens.
 *
 * beforePens collapses both twins to the last one, so the first twin's start
 * date is compared against the second twin's. A save that changes nothing
 * about a start date (here: a note) is refused with a spurious 409. */
test('a no-op save on twins with distinct start days is not falsely locked', async () => {
  const slug = `tws${Date.now().toString(36)}.t`;
  await req('POST', '/api/cards', {
    headers: studio(),
    body: {
      slug, name: 'Twin Start',
      pens: [{ template: 'ghk', startDate: '2026-05-01' }, { template: 'ghk', startDate: '2026-06-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: {} },
    },
  });
  await req('POST', '/api/dose', {
    body: { slug, template: 'ghk', units: 1, at: '2026-05-01T08:00:00.000Z', day: '2026-05-01' },
  });

  const res = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      note: 'unrelated edit',
      pens: [{ template: 'ghk', startDate: '2026-05-01' }, { template: 'ghk', startDate: '2026-06-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: {} },
    },
  });

  assert.equal(res.status, 200, 'expected an unrelated edit to save, not a spurious 409');
});
