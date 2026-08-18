/* ==================================================================
   WEB PUSH
   ------------------------------------------------------------------
   Sends a notification to a phone that asked for one. No library: Node's
   crypto has everything the specifications need, and a service handling
   patient data is better off without a dependency tree for one feature.

   Three specifications meet here.

     RFC 8292  VAPID — an ES256 JWT that identifies this server to Apple
               and Google, so a stolen endpoint cannot be pushed to by
               anybody else.
     RFC 8291  Message encryption — ECDH against the key the browser gave
               us, HKDF to derive a content key, AES-128-GCM to seal it.
               Apple and Google forward the ciphertext without being able
               to read it.
     RFC 8188  aes128gcm content coding — the envelope the ciphertext
               travels in.

   WHAT MAY GO IN A PAYLOAD
   ------------------------
   Nothing about the patient. The push services are not covered by the
   atelier's BAA, and a notification also renders on a locked screen where
   anyone can read it. So the body says a dose is due and nothing more —
   no drug, no dial number, no name. Tapping it opens the portal, which is
   behind the card address and holds the detail.

   sendPush() enforces this: it takes a title and body it is given, and
   the callers in server.js build those from fixed strings.
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

/* ---------- sending ----------
   Resolves to { ok, status, gone }. `gone` means the phone threw the
   subscription away — uninstalled, reset, permission revoked — and the
   caller should stop keeping it. Everything else is worth a retry later. */

async function sendPush(sub, { title, body, url, tag } = {}) {
  if (!configured()) throw new Error('vapid_not_configured');
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('bad_subscription');
  }

  const payload = JSON.stringify({ title, body, url, tag });
  const ciphertext = encrypt(payload, sub.keys.p256dh, sub.keys.auth);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: Object.assign({
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(ciphertext.length),
      // Wake the phone even if it is idle; a dose reminder is time-critical.
      'Urgency': 'high',
      // Four hours. A reminder that arrives the next morning is noise.
      'TTL': '14400'
    }, vapidHeaders(sub.endpoint)),
    body: ciphertext
  });

  // 404 and 410 are the two ways a push service says "this one is dead".
  const gone = res.status === 404 || res.status === 410;
  return { ok: res.ok, status: res.status, gone };
}

module.exports = { configured, generateKeys, sendPush, publicKey: () => PUBLIC_KEY };
