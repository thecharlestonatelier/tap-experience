/* Pin the push delivery loops (runReminders, notifyAtelier). sendPush encrypts
   to a real browser key, so only the push service's fetch is stubbed; the
   encryption and the guard paths run for real. Requests to the in-process
   server still go through the real fetch. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-push-'));
process.env.CARD_STORE = 'file';
process.env.CARD_FILE = path.join(tmp, 'cards.json');
process.env.SUB_FILE = path.join(tmp, 'subs.json');
process.env.STUDIO_PASSPHRASE = 'testpassphrase';
process.env.PUSH_RUN_SECRET = 'test-run-secret';

/* push.js reads the VAPID pair at module load, so set it first. */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
process.env.VAPID_PUBLIC_KEY = Buffer.from(pubRaw).toString('base64url');
process.env.VAPID_PRIVATE_KEY = privateKey.export({ format: 'jwk' }).d;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const now = new Date().toISOString();
const card = (slug, status = 'active') => ({
  slug, name: slug, status, startDate: null, note: '',
  pens: [], added: [], dropped: [], createdAt: now, updatedAt: now,
});
fs.writeFileSync(process.env.CARD_FILE, JSON.stringify({
  'rem.c': card('rem.c'),
  'ret.c': card('ret.c', 'retired'),
}, null, 2));

const { server } = await import('../../server.js');

let base;
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function req(method, p, { body, headers } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: Object.assign(body !== undefined ? { 'Content-Type': 'application/json' } : {}, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  if (text) { try { parsed = JSON.parse(text); } catch { /* not json */ } }
  return { status: res.status, body: parsed, headers: res.headers };
}

const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const pushKeys = {
  p256dh: ua.getPublicKey().toString('base64url'),
  auth: crypto.randomBytes(16).toString('base64url'),
};
const subscription = endpoint => ({ endpoint, keys: pushKeys });
const dueNowIso = () => new Date(Date.now() - 60000).toISOString();

/* Stub only the push service; status 'throw' simulates an unreachable one. */
async function withPush(status, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://push.example.com/')) {
      if (status === 'throw') throw new Error('push unreachable');
      return { ok: status >= 200 && status < 300, status };
    }
    return real(url, opts);
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const run = () => req('POST', '/api/push/run', { headers: { 'x-push-secret': 'test-run-secret' } });
const subscribe = (slug, endpoint) =>
  req('POST', '/api/push/subscribe', { body: { slug, sub: subscription(endpoint), due: [dueNowIso()] } });

let studioCookie = null;
async function signIn() {
  const r = await req('POST', '/api/session', { body: { passphrase: 'testpassphrase' } });
  studioCookie = r.headers.getSetCookie().find(c => c.startsWith('ca_studio=')).split(';')[0];
  return studioCookie;
}

test('runReminders sends to a due phone', async () => {
  await subscribe('rem.c', 'https://push.example.com/a');
  const r = await withPush(201, run);
  assert.equal(r.status, 200);
  assert.ok(r.body.sent >= 1);
});

test('runReminders drops a phone the push service says is gone', async () => {
  await subscribe('rem.c', 'https://push.example.com/gone');
  const r = await withPush(410, run);
  assert.equal(r.status, 200);
  assert.ok(r.body.dropped >= 1);
});

test('runReminders drops a retired card phone', async () => {
  await signIn();
  await req('POST', '/api/cards', { headers: { Cookie: studioCookie }, body: { slug: 'late.c', name: 'Late' } });
  await subscribe('late.c', 'https://push.example.com/late');
  await req('PUT', '/api/cards/late.c', { headers: { Cookie: studioCookie }, body: { status: 'retired' } });
  const r = await run();
  assert.equal(r.status, 200);
  assert.ok(r.body.dropped >= 1);
});

test('runReminders counts a failed send', async () => {
  await subscribe('rem.c', 'https://push.example.com/fail');
  const r = await withPush('throw', run);
  assert.equal(r.status, 200);
  assert.ok(r.body.failed >= 1);
});

test('notifyAtelier sends to a subscribed atelier phone', async () => {
  await signIn();
  await req('POST', '/api/push/atelier', {
    headers: { Cookie: studioCookie },
    body: { sub: subscription('https://push.example.com/atelier'), due: [] },
  });
  const r = await withPush(201, () => req('POST', '/api/added/rem.c', { body: { dropped: ['ghk'] } }));
  assert.equal(r.status, 200);
});

test('notifyAtelier drops a gone atelier phone', async () => {
  const r = await withPush(410, () => req('POST', '/api/added/rem.c', { body: { dropped: ['b12'] } }));
  assert.equal(r.status, 200);
  const phones = await req('GET', '/api/push/atelier', { headers: { Cookie: studioCookie } });
  assert.equal(phones.body.on, 0);
});
