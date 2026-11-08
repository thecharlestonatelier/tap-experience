/* ==================================================================
   WEB PUSH — CRYPTO
   ------------------------------------------------------------------
   The cryptography behind a reminder notification, with no transport.
   Three specifications meet here:

     RFC 8292  VAPID — an ES256 JWT that identifies this server to Apple
               and Google, so a stolen endpoint cannot be pushed to by
               anybody else.
     RFC 8291  Message encryption — ECDH against the key the browser gave
               us, HKDF to derive a content key, AES-128-GCM to seal it.
     RFC 8188  aes128gcm content coding — the envelope the ciphertext
               travels in.

   This half is pure: keys in, ciphertext out. The single `fetch` that
   delivers it lives in lib/push.js, so this module is the domain and that
   one is the transport.
   ================================================================== */

const crypto = require('node:crypto');

const PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT     = process.env.VAPID_SUBJECT || 'mailto:hello@thecharlestonatelier.com';

function configured() { return !!(PUBLIC_KEY && PRIVATE_KEY); }

/* ---------- base64url ---------- */

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function unb64u(str) { return Buffer.from(String(str), 'base64url'); }

/* ---------- keys ----------
   A VAPID key pair is a P-256 key. The public half travels to the browser
   as the 65-byte uncompressed point; the private half is the 32-byte
   scalar. Both are stored base64url so they survive an environment
   variable. */

function generateKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(pubRaw), privateKey: jwk.d };
}

/* Rebuild a usable private key object from the stored 32-byte scalar.
   Node will not import a bare scalar, so go back through JWK — the public
   coordinates come from the public key we already hold. */
function privateKeyObject() {
  const pub = unb64u(PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY is not a 65-byte uncompressed P-256 point');
  }
  return crypto.createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
      d: PRIVATE_KEY
    },
    format: 'jwk'
  });
}

/* ---------- RFC 8292: the VAPID JWT ---------- */

function vapidHeaders(endpoint) {
  const { origin } = new URL(endpoint);
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({
    aud: origin,
    // Twelve hours. Apple rejects anything past 24.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: SUBJECT
  }));
  const signingInput = `${header}.${claims}`;

  // Node signs ECDSA as DER by default; JWS wants the raw r||s pair.
  const der = crypto.sign('sha256', Buffer.from(signingInput), privateKeyObject());
  const sig = derToRaw(der);

  return {
    Authorization: `vapid t=${signingInput}.${b64u(sig)}, k=${PUBLIC_KEY}`
  };
}

function derToRaw(der) {
  // SEQUENCE { INTEGER r, INTEGER s } -> 32-byte r || 32-byte s
  let i = 2;
  if (der[1] & 0x80) i += der[1] & 0x7f;      // long-form length
  const out = Buffer.alloc(64);
  for (const off of [0, 32]) {
    if (der[i++] !== 0x02) throw new Error('malformed ECDSA signature');
    let len = der[i++];
    let start = i;
    // Strip the leading zero a positive INTEGER carries, or left-pad a short one.
    while (len > 32) { start++; len--; }
    der.copy(out, off + (32 - len), start, start + len);
    i = start + len;
  }
  return out;
}

/* ---------- RFC 8291 + 8188: the encrypted payload ---------- */

function hkdf(salt, ikm, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

function encrypt(payload, clientPublicKey, authSecret) {
  const plaintext = Buffer.from(payload, 'utf8');
  const uaPublic = unb64u(clientPublicKey);
  const auth = unb64u(authSecret);

  // An ephemeral key per message, so two notifications share nothing.
  const local = crypto.createECDH('prime256v1');
  local.generateKeys();
  const localPublic = local.getPublicKey();
  const shared = local.computeSecret(uaPublic);

  const salt = crypto.randomBytes(16);

  // RFC 8291 §3.3 — the pseudo-random key mixes in both public keys, so a
  // ciphertext cannot be replayed at a different subscription.
  const prkInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), uaPublic, localPublic
  ]);
  const ikm = hkdf(auth, shared, prkInfo, 32);

  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // A single record: plaintext, then the 0x02 padding delimiter.
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([
    cipher.update(plaintext), cipher.update(Buffer.from([2])),
    cipher.final(), cipher.getAuthTag()
  ]);

  // RFC 8188 §2.1 header: salt | record size | key id length | key id
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(localPublic.length, 20);

  return Buffer.concat([header, localPublic, body]);
}

module.exports = { configured, generateKeys, publicKey: () => PUBLIC_KEY, vapidHeaders, encrypt };
