/* Prove the push crypto, not just that it runs.
   - the VAPID JWT verifies against the published public key
   - the encrypted payload decrypts back to the plaintext, using the
     receiver's private key, exactly as a browser would */
import crypto from 'node:crypto';

// The module reads its keys at load time, so the environment must already
// carry a pair. The runner script generates one and exports it.
const push = (await import(new URL('../lib/push.js', import.meta.url).href)).default;
const keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(String(s), 'base64url');

/* ---------- 1. VAPID JWT ---------- */
// Reach the header builder through a send attempt against a local sink.
const captured = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  captured.url = url; captured.headers = opts.headers; captured.body = opts.body;
  return { ok: true, status: 201 };
};

// A receiver key pair, standing in for the browser.
const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const uaPublic = ua.getPublicKey();
const authSecret = crypto.randomBytes(16);

const sub = {
  endpoint: 'https://web.push.apple.com/abc123',
  keys: { p256dh: b64u(uaPublic), auth: b64u(authSecret) }
};

const PLAINTEXT = JSON.stringify({
  title: 'The Charleston Atelier', body: 'Time for your injection.', url: '/phil.h', tag: 'dose'
});

const out = await push.sendPush(sub, {
  title: 'The Charleston Atelier', body: 'Time for your injection.', url: '/phil.h', tag: 'dose'
});
globalThis.fetch = realFetch;

check('sendPush reports ok', out.ok === true);
check('posts to the endpoint', captured.url === sub.endpoint);
check('declares aes128gcm', captured.headers['Content-Encoding'] === 'aes128gcm');

const auth = captured.headers.Authorization || '';
const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(auth);
check('Authorization is a VAPID token', !!m);

if (m) {
  const [, jwt, k] = m;
  check('published key matches ours', k === keys.publicKey);

  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(unb64u(c));
  check('audience is the push origin', claims.aud === 'https://web.push.apple.com', claims.aud);
  check('subject carried through', claims.sub === 'mailto:test@example.com');
  const hours = (claims.exp - Math.floor(Date.now() / 1000)) / 3600;
  check('expiry inside Apple\'s 24h limit', hours > 0 && hours <= 24, `${hours.toFixed(1)}h`);

  // Verify the signature the way a push service would.
  const pub = unb64u(keys.publicKey);
  const verifier = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk'
  });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), {
    key: verifier, dsaEncoding: 'ieee-p1363'
  }, unb64u(s));
  check('JWT signature verifies', ok);
}

/* ---------- 2. RFC 8291 payload ---------- */
const body = Buffer.from(captured.body);
const salt = body.subarray(0, 16);
const recordSize = body.readUInt32BE(16);
const idlen = body.readUInt8(20);
const serverPublic = body.subarray(21, 21 + idlen);
const ciphertext = body.subarray(21 + idlen);

check('record size is 4096', recordSize === 4096);
check('key id is a P-256 point', idlen === 65 && serverPublic[0] === 0x04);

const shared = ua.computeSecret(serverPublic);
const hkdf = (salt, ikm, info, len) => {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
};
const ikm = hkdf(authSecret, shared,
  Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, serverPublic]), 32);
const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

let decrypted = null, threw = null;
try {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(data), d.final()]);
  // strip the 0x02 padding delimiter
  decrypted = plain.subarray(0, plain.length - 1).toString('utf8');
} catch (e) { threw = e.message; }

check('payload decrypts', decrypted !== null, threw || '');
check('plaintext round-trips', decrypted === PLAINTEXT, decrypted ? '' : 'no output');

if (decrypted) {
  const parsed = JSON.parse(decrypted);
  // The safety rule: nothing clinical, nothing identifying.
  const blob = JSON.stringify(parsed).toLowerCase();
  const forbidden = ['tirzepatide', 'semaglutide', 'nad', 'unit', 'mg', 'dose of', 'phillip', 'jessica'];
  const found = forbidden.filter(w => blob.includes(w));
  check('no drug, dose or name in the payload', found.length === 0, found.join(', '));
}

/* ---------- 3. two messages share nothing ---------- */
globalThis.fetch = async (url, opts) => { captured.body2 = opts.body; return { ok: true, status: 201 }; };
await push.sendPush(sub, { title: 'x', body: 'y', url: '/z', tag: 'dose' });
globalThis.fetch = realFetch;
check('each message uses a fresh ephemeral key',
  !Buffer.from(captured.body).subarray(21, 86).equals(Buffer.from(captured.body2).subarray(21, 86)));

/* ---------- 4. dead endpoints are reported ---------- */
globalThis.fetch = async () => ({ ok: false, status: 410 });
const goneOut = await push.sendPush(sub, { title: 'x', body: 'y' });
globalThis.fetch = realFetch;
check('410 reports gone', goneOut.gone === true && goneOut.ok === false);

globalThis.fetch = async () => ({ ok: false, status: 429 });
const busy = await push.sendPush(sub, { title: 'x', body: 'y' });
globalThis.fetch = realFetch;
check('429 is not treated as gone', busy.gone === false);

console.log(bad ? `\n${bad} FAILED` : '\nPASS — VAPID verifies, payload round-trips, nothing clinical inside.');
process.exit(bad ? 1 : 0);
