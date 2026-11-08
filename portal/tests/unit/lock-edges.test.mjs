/* QA designer — issue #11, server half of the per-protocol start/time lock.

   Defensive tests over `writeCard` in portal/server.js, in the same style as
   route.test.mjs: a real in-process server on a file store, seeded per test.

   The gap list asks for, specifically:
   - PATCH returns the same pen_start_locked / pen_time_locked 409 as PUT;
   - a pen with no logged dose changes its start and time freely;
   - `settings.force` also overrides a time change;
   - twin pens of one template keep independent per-pen times (`ghk#0` vs
     `ghk#1` — the keys the phone and the Studio editor use);
   - a stale body that changes `pens` but omits `settings` still 409s;
   - the 409 body names the pen in `pen`.

   The lock keys a pen by `pen.template || pen.id` and arms once any dose with
   that template is logged. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-qa-writecard-'));
process.env.CARD_STORE = 'file';
process.env.CARD_FILE = path.join(tmp, 'cards.json');
process.env.DOSE_FILE = path.join(tmp, 'doses.json');
process.env.SUB_FILE = path.join(tmp, 'subs.json');
process.env.FEED_FILE = path.join(tmp, 'feeds.json');
process.env.STUDIO_PASSPHRASE = 'testpassphrase';
process.env.AGENT_TOKEN = 'test-agent-token';
process.env.PUSH_RUN_SECRET = 'test-run-secret';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
const jwk = privateKey.export({ format: 'jwk' });
process.env.VAPID_PUBLIC_KEY = Buffer.from(pubRaw).toString('base64url');
process.env.VAPID_PRIVATE_KEY = jwk.d;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

fs.writeFileSync(path.join(tmp, 'cards.json'), JSON.stringify({}, null, 2));

const { server } = await import('../../server.js');

let base;
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await signIn();
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

let studioCookie = null;
async function signIn() {
  const r = await req('POST', '/api/session', { body: { passphrase: 'testpassphrase' } });
  assert.equal(r.status, 200);
  studioCookie = r.headers.getSetCookie().find(c => c.startsWith('ca_studio=')).split(';')[0];
  return studioCookie;
}
const studio = () => ({ Cookie: studioCookie });

async function mint(slug, pens, settings) {
  const r = await req('POST', '/api/cards', {
    headers: studio(),
    body: { slug, name: slug, pens, settings },
  });
  assert.equal(r.status, 201);
  return r;
}

async function dose(slug, template, day) {
  const r = await req('POST', '/api/dose', {
    body: { slug, template, units: 1, at: `${day}T08:00:00.000Z`, day },
  });
  assert.equal(r.status, 200);
  return r;
}

test('PATCH returns the same pen_start_locked and pen_time_locked 409 as PUT', async () => {
  const slug = 'qa-patch.l';
  await mint(slug, [{ template: 'ghk', startDate: '2026-05-01' }],
    { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:00' } });
  await dose(slug, 'ghk', '2026-05-01');

  const start = await req('PATCH', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk', startDate: '2026-05-03' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:00' } },
    },
  });
  assert.equal(start.status, 409);
  assert.equal(start.body.error, 'pen_start_locked');
  assert.equal(start.body.pen, 'ghk');

  const time = await req('PATCH', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk', startDate: '2026-05-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { ghk: '09:00' } },
    },
  });
  assert.equal(time.status, 409);
  assert.equal(time.body.error, 'pen_time_locked');
  assert.equal(time.body.pen, 'ghk');
});

test('a pen with no logged dose changes its start day and time freely', async () => {
  const slug = 'qa-nodose.l';
  await mint(slug, [{ template: 'ghk', startDate: '2026-05-01' }],
    { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:00' } });

  const r = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk', startDate: '2026-06-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:30' } },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.pens[0].startDate, '2026-06-01');
  assert.equal(r.body.settings.penTimes.ghk, '08:30');
});

test('settings.force also overrides a time change on a logged pen', async () => {
  const slug = 'qa-force-time.l';
  await mint(slug, [{ template: 'ghk', startDate: '2026-05-01' }],
    { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:00' } });
  await dose(slug, 'ghk', '2026-05-01');

  const blocked = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk', startDate: '2026-05-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { ghk: '09:00' } },
    },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'pen_time_locked');

  const forced = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk', startDate: '2026-05-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { ghk: '09:00' }, force: true },
    },
  });
  assert.equal(forced.status, 200);
  assert.equal(forced.body.settings.penTimes.ghk, '09:00');
});

test('twin pens keep independent per-pen times under distinct keys', async () => {
  const slug = 'qa-twins.l';
  await mint(slug, [{ template: 'ghk' }, { template: 'ghk' }],
    { startDate: '2026-05-01', times: {}, penTimes: { 'ghk#0': '08:00', 'ghk#1': '09:00' } });

  // Change only ghk#1's time; ghk#0 must survive untouched.
  const r = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk' }, { template: 'ghk' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { 'ghk#0': '08:00', 'ghk#1': '10:30' } },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.penTimes['ghk#0'], '08:00');
  assert.equal(r.body.settings.penTimes['ghk#1'], '10:30');
});

test('a stale body that changes pens but omits settings still 409s', async () => {
  const slug = 'qa-stale.l';
  await mint(slug, [{ template: 'ghk', startDate: '2026-05-01' }],
    { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:00' } });
  await dose(slug, 'ghk', '2026-05-01');

  // No `settings` key at all — a client that never learned about settings.
  const r = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: { pens: [{ template: 'ghk', startDate: '2026-05-03' }] },
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'pen_start_locked');
  assert.equal(r.body.pen, 'ghk');
});

test('a dose for one template does not lock a different pen', async () => {
  const slug = 'qa-two-pens.l';
  await mint(slug,
    [{ template: 'ghk', startDate: '2026-05-01' }, { template: 'glow', startDate: '2026-05-01' }],
    { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:00', glow: '20:00' } });
  await dose(slug, 'ghk', '2026-05-01');

  // The un-dosed glow pen moves freely.
  const glow = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk', startDate: '2026-05-01' }, { template: 'glow', startDate: '2026-06-02' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:00', glow: '20:30' } },
    },
  });
  assert.equal(glow.status, 200);
  assert.equal(glow.body.pens[1].startDate, '2026-06-02');
  assert.equal(glow.body.settings.penTimes.glow, '20:30');

  // The dosed ghk pen still refuses.
  const ghk = await req('PUT', `/api/cards/${slug}`, {
    headers: studio(),
    body: {
      pens: [{ template: 'ghk', startDate: '2026-06-01' }, { template: 'glow', startDate: '2026-05-01' }],
      settings: { startDate: '2026-05-01', times: {}, penTimes: { ghk: '08:00', glow: '20:00' } },
    },
  });
  assert.equal(ghk.status, 409);
  assert.equal(ghk.body.error, 'pen_start_locked');
  assert.equal(ghk.body.pen, 'ghk');
});
