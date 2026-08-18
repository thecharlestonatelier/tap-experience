/* The reminder loop, end to end, against a running server:
   subscribe -> the sweep fires once -> it does not fire twice ->
   a retired card stops -> a dead phone is dropped. */
import crypto from 'node:crypto';

const BASE = 'http://localhost:8096';
const PASS = 'testpassphrase';
const SECRET = 'run-secret';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const b64u = b => Buffer.from(b).toString('base64url');

/* sign in as the clinician */
const signin = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passphrase: PASS })
});
const cookie = (signin.headers.get('set-cookie') || '').split(';')[0];

/* a card to belong to */
await fetch(`${BASE}/api/cards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ slug: 'rem.t', name: 'Rem', status: 'active', pens: [{ template: 'nad' }] })
});

/* a phone */
const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const makeSub = tail => ({
  endpoint: `https://localhost:9443/${tail}`,
  keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) }
});

const key = await fetch(`${BASE}/api/push/key`).then(r => r.json());
check('server advertises a VAPID key', key.available === true && !!key.key);

/* a dose five minutes ago, and one tomorrow */
const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const lastWeek = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

const sub1 = makeSub('phone-one');
let r = await fetch(`${BASE}/api/push/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'rem.t', sub: sub1, due: [lastWeek, fiveMinAgo, tomorrow], tz: 'America/New_York' })
});
const saved = await r.json();
check('subscribe accepted', r.status === 201);
check('stale instants are dropped', saved.due === 2, `kept ${saved.due}`);

/* an unknown card must not be subscribable */
r = await fetch(`${BASE}/api/push/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'nope.x', sub: makeSub('phone-x'), due: [fiveMinAgo] })
});
check('unknown card refused', r.status === 404);

/* the sweep is not open to the world */
r = await fetch(`${BASE}/api/push/run`, { method: 'POST' });
check('sweep needs the secret', r.status === 401);

/* fire */
r = await fetch(`${BASE}/api/push/run`, { method: 'POST', headers: { 'x-push-secret': SECRET } });
const run1 = await r.json();
console.log('    run 1:', JSON.stringify(run1));
check('one reminder sent', run1.sent === 1, JSON.stringify(run1));

/* immediately again — must not repeat */
r = await fetch(`${BASE}/api/push/run`, { method: 'POST', headers: { 'x-push-secret': SECRET } });
const run2 = await r.json();
console.log('    run 2:', JSON.stringify(run2));
check('the same dose is not sent twice', run2.sent === 0, JSON.stringify(run2));

/* a dose from this morning, long past, must not fire this afternoon */
const sub2 = makeSub('phone-two');
const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
await fetch(`${BASE}/api/push/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'rem.t', sub: sub2, due: [sixHoursAgo] })
});
r = await fetch(`${BASE}/api/push/run`, { method: 'POST', headers: { 'x-push-secret': SECRET } });
const run3 = await r.json();
check('a reminder six hours stale is not delivered', run3.sent === 0, JSON.stringify(run3));

/* retiring the card stops the reminders */
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
check('a retired card sends nothing', run4.sent === 0, JSON.stringify(run4));
check('its phones are forgotten', run4.dropped >= 1, JSON.stringify(run4));

/* unsubscribe */
r = await fetch(`${BASE}/api/push/unsubscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ endpoint: sub1.endpoint })
});
check('unsubscribe accepted', r.status === 200);

console.log(bad ? `\n${bad} FAILED` : '\nPASS — fires once, never twice, never stale, stops when retired.');
process.exit(bad ? 1 : 0);
