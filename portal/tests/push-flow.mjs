/* The reminder loop, end to end, against a running server:
   subscribe -> the sweep fires once -> it does not fire twice ->
   a retired card stops -> a dead phone is dropped. */
import crypto from 'node:crypto';

/* Arrange — the harness */
const BASE = 'http://localhost:8096';
const PASS = 'testpassphrase';
const SECRET = 'run-secret';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const b64u = b => Buffer.from(b).toString('base64url');

/* Arrange — sign in as the clinician, and a card to belong to */
const signin = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passphrase: PASS })
});
const cookie = (signin.headers.get('set-cookie') || '').split(';')[0];

await fetch(`${BASE}/api/cards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ slug: 'rem.t', name: 'Rem', status: 'active', pens: [{ template: 'nad' }] })
});

/* Arrange — a phone, and the instants that will matter */
const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const makeSub = tail => ({
  endpoint: `https://localhost:9443/${tail}`,
  keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) }
});

/* Act — read the published VAPID key */
const key = await fetch(`${BASE}/api/push/key`).then(r => r.json());
/* Assert — the server advertises one */
check('server advertises a VAPID key', key.available === true && !!key.key);

const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const lastWeek = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

/* Act — subscribe a phone with a stale instant among the due list */
const sub1 = makeSub('phone-one');
let r = await fetch(`${BASE}/api/push/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'rem.t', sub: sub1, due: [lastWeek, fiveMinAgo, tomorrow], tz: 'America/New_York' })
});
const saved = await r.json();
/* Assert — accepted, stale instants dropped */
check('subscribe accepted', r.status === 201);
check('stale instants are dropped', saved.due === 2, `kept ${saved.due}`);

/* Act — subscribe a phone to an unknown card */
r = await fetch(`${BASE}/api/push/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'nope.x', sub: makeSub('phone-x'), due: [fiveMinAgo] })
});
/* Assert — refused */
check('unknown card refused', r.status === 404);

/* Act — run the sweep with no secret */
r = await fetch(`${BASE}/api/push/run`, { method: 'POST' });
/* Assert — not open to the world */
check('sweep needs the secret', r.status === 401);

/* Act — run the sweep properly */
r = await fetch(`${BASE}/api/push/run`, { method: 'POST', headers: { 'x-push-secret': SECRET } });
const run1 = await r.json();
console.log('    run 1:', JSON.stringify(run1));
/* Assert — the due dose fires once */
check('one reminder sent', run1.sent === 1, JSON.stringify(run1));

/* Act — immediately again */
r = await fetch(`${BASE}/api/push/run`, { method: 'POST', headers: { 'x-push-secret': SECRET } });
const run2 = await r.json();
console.log('    run 2:', JSON.stringify(run2));
/* Assert — it must not repeat */
check('the same dose is not sent twice', run2.sent === 0, JSON.stringify(run2));

/* Act — a dose from this morning, long past, then the sweep */
const sub2 = makeSub('phone-two');
const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
await fetch(`${BASE}/api/push/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'rem.t', sub: sub2, due: [sixHoursAgo] })
});
r = await fetch(`${BASE}/api/push/run`, { method: 'POST', headers: { 'x-push-secret': SECRET } });
const run3 = await r.json();
/* Assert — too stale to fire this afternoon */
check('a reminder six hours stale is not delivered', run3.sent === 0, JSON.stringify(run3));

/* Act — subscribe a third phone, then retire the card */
const sub3 = makeSub('phone-three');
await fetch(`${BASE}/api/push/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'rem.t', sub: sub3, due: [new Date(Date.now() - 60000).toISOString()] })
});
await fetch(`${BASE}/api/cards/rem.t`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ status: 'retired' })
});
r = await fetch(`${BASE}/api/push/run`, { method: 'POST', headers: { 'x-push-secret': SECRET } });
const run4 = await r.json();
console.log('    run 4:', JSON.stringify(run4));
/* Assert — nothing sent, and the phones are forgotten */
check('a retired card sends nothing', run4.sent === 0, JSON.stringify(run4));
check('its phones are forgotten', run4.dropped >= 1, JSON.stringify(run4));

/* Act — unsubscribe */
r = await fetch(`${BASE}/api/push/unsubscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ endpoint: sub1.endpoint })
});
/* Assert — accepted */
check('unsubscribe accepted', r.status === 200);

console.log(bad ? `\n${bad} FAILED` : '\nPASS — fires once, never twice, never stale, stops when retired.');
process.exit(bad ? 1 : 0);
