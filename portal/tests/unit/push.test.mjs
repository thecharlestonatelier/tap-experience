/* Characterization pin for portal/lib/push.js sendPush control flow.
   The full RFC 8291 round-trip lives in tests/push-crypto.mjs; this pins
   the guard, the success shape, and the gone/retry decision. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/* push.js reads its VAPID pair at module load, so set it first. */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
const jwk = privateKey.export({ format: 'jwk' });
process.env.VAPID_PUBLIC_KEY = Buffer.from(pubRaw).toString('base64url');
process.env.VAPID_PRIVATE_KEY = jwk.d;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const push = (await import('../../lib/push.js')).default;

const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const sub = {
  endpoint: 'https://push.example.com/x',
  keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
};

const withFetch = async (status, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: status >= 200 && status < 300, status });
  try { return await fn(); } finally { globalThis.fetch = real; }
};

test('sendPush reports a live endpoint as sent', async () => {
  const out = await withFetch(201, () => push.sendPush(sub, { title: 't', body: 'b', url: '/u', tag: 'dose' }));
  assert.deepEqual(out, { ok: true, status: 201, gone: false });
});

test('sendPush treats 404 and 410 as gone', async () => {
  assert.equal((await withFetch(404, () => push.sendPush(sub, {}))).gone, true);
  assert.equal((await withFetch(410, () => push.sendPush(sub, {}))).gone, true);
});

test('sendPush does not treat a busy service as gone', async () => {
  const out = await withFetch(429, () => push.sendPush(sub, {}));
  assert.deepEqual(out, { ok: false, status: 429, gone: false });
});

test('sendPush refuses an incomplete subscription', async () => {
  await assert.rejects(() => push.sendPush(null, {}), /bad_subscription/);
  await assert.rejects(() => push.sendPush({ endpoint: 'x' }, {}), /bad_subscription/);
});

test('sendPush sends a VAPID authorization header', async () => {
  let authorization = null;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    authorization = opts.headers.Authorization;
    return { ok: true, status: 201 };
  };
  try {
    await push.sendPush(sub, { title: 't', body: 'b' });
  } finally { globalThis.fetch = real; }
  assert.match(authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
});
