/* ==================================================================
   WEB PUSH — TRANSPORT
   ------------------------------------------------------------------
   Delivers one encrypted notification to a phone that asked for one.
   The cryptography is in lib/push-crypto.js; this file does the single
   fetch that hands the sealed payload to Apple's or Google's push service.

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

const { configured, generateKeys, publicKey, encrypt, vapidHeaders } = require('./push-crypto');
const { allowedPushEndpoint } = require('./push-endpoint');

/* ---------- sending ----------
   Resolves to { ok, status, gone }. `gone` means the phone threw the
   subscription away — uninstalled, reset, permission revoked — and the
   caller should stop keeping it. Everything else is worth a retry later. */

async function sendPush(sub, { title, body, url, tag } = {}) {
  if (!configured()) throw new Error('vapid_not_configured');
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('bad_subscription');
  }
  if (!allowedPushEndpoint(sub.endpoint)) throw new Error('bad_endpoint');

  const payload = JSON.stringify({ title, body, url, tag });
  const ciphertext = encrypt(payload, sub.keys.p256dh, sub.keys.auth);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    // A push endpoint never redirects; following one would let an allowed
    // origin hand the request to an arbitrary host.
    redirect: 'error',
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

module.exports = { configured, generateKeys, sendPush, publicKey };
