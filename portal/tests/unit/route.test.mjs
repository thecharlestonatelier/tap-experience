/* Characterization pin for portal/server.js `route` (the request router).
   Runs the real server in-process against a file store and pins every
   deterministic route's response, so the router can be split into a route
   table without changing behaviour. Firebase-dependent paths (valid idToken,
   auth-helper proxy, wallet buildPass) are left to the manual suites. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-route-'));
process.env.CARD_STORE = 'file';
process.env.CARD_FILE = path.join(tmp, 'cards.json');
process.env.DOSE_FILE = path.join(tmp, 'doses.json');
process.env.SUB_FILE = path.join(tmp, 'subs.json');
process.env.FEED_FILE = path.join(tmp, 'feeds.json');
process.env.STUDIO_PASSPHRASE = 'testpassphrase';
process.env.AGENT_TOKEN = 'test-agent-token';
process.env.PUSH_RUN_SECRET = 'test-run-secret';

/* A VAPID key pair, so the push routes are "configured" and their branches
   are exercised (push.js reads these at module load). */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
const jwk = privateKey.export({ format: 'jwk' });
process.env.VAPID_PUBLIC_KEY = Buffer.from(pubRaw).toString('base64url');
process.env.VAPID_PRIVATE_KEY = jwk.d;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const now = new Date().toISOString();
const card = (slug, name, opts = {}) => Object.assign({
  slug, name, startDate: null, status: 'active', note: '',
  pens: [], added: [], dropped: [], createdAt: now, updatedAt: now,
}, opts);

/* Seed two cards before the store is opened: an active card and a blank. */
fs.writeFileSync(path.join(tmp, 'cards.json'), JSON.stringify({
  'active.a': card('active.a', 'Active', { pens: [{ template: 'ghk' }] }),
  'blank.b': card('blank.b', '', { status: 'blank' }),
  'retired.c': card('retired.c', 'Retired', { status: 'retired' }),
}, null, 2));

const { server } = await import('../../server.js');

let base;
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await signIn();
});
after(() => server.close());

async function req(method, pathname, { body, raw, headers } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: Object.assign(
      body !== undefined ? { 'Content-Type': 'application/json' } : {},
      raw !== undefined ? { 'Content-Type': 'text/calendar; charset=utf-8' } : {},
      headers || {},
    ),
    body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
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
  const cookies = r.headers.getSetCookie();
  const cookie = cookies.find(c => c.startsWith('ca_studio='));
  studioCookie = cookie.split(';')[0];
  return studioCookie;
}
const studio = () => ({ Cookie: studioCookie });

/* ---------- health ---------- */

test('GET /health reports the file store as reachable', async () => {
  const r = await req('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.store, 'file');
  assert.equal(r.body.reachable, true);
  assert.equal(typeof r.body.startedAt, 'string');
});

/* ---------- public card routes ---------- */

test('GET /api/card/<slug> serves the public view', async () => {
  const r = await req('GET', '/api/card/active.a');
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, 'active.a');
  assert.equal(r.body.name, 'Active');
  assert.equal(r.body.note, undefined); // clinician note never leaves
});

test('GET /api/card/<missing> returns 404', async () => {
  const r = await req('GET', '/api/card/missing.x');
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'not_found', slug: 'missing.x' });
});

test('GET /api/card/<invalid> returns 400', async () => {
  const r = await req('GET', '/api/card/not-a-slug!!');
  assert.equal(r.status, 400);
});

test('POST /api/tap/<slug> records the tap with 204', async () => {
  const r = await req('POST', '/api/tap/active.a');
  assert.equal(r.status, 204);
});

test('POST /api/tap/<missing> returns 404', async () => {
  const r = await req('POST', '/api/tap/missing.x');
  assert.equal(r.status, 404);
});

test('GET /v/<payload> serves the vial page', async () => {
  const r = await req('GET', '/v/lot123');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
});

test('GET /v/<bad> returns 404', async () => {
  const r = await req('GET', '/v/not valid!');
  assert.equal(r.status, 404);
});

test('POST /api/dose writes a dose', async () => {
  const r = await req('POST', '/api/dose', {
    body: { slug: 'active.a', units: 10, template: 'ghk', day: '2026-03-01', at: '2026-03-01T20:00:00Z' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.duplicate, false);
});

test('POST /api/dose with no units returns 400', async () => {
  const r = await req('POST', '/api/dose', { body: { slug: 'active.a', units: 0 } });
  assert.equal(r.status, 400);
});

test('POST /api/dose for a missing card returns 404', async () => {
  const r = await req('POST', '/api/dose', { body: { slug: 'missing.x', units: 10 } });
  assert.equal(r.status, 404);
});

test('POST /api/added/<slug> saves the added list', async () => {
  const r = await req('POST', '/api/added/active.a', { body: { added: [{ id: 'pen-1', template: 'b12' }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.added, [{ id: 'pen-1', template: 'b12' }]);
});

test('POST /api/added/<missing> returns 404', async () => {
  const r = await req('POST', '/api/added/missing.x', { body: { added: [] } });
  assert.equal(r.status, 404);
});

test('POST /api/ics/<slug> stores a calendar', async () => {
  const r = await req('POST', '/api/ics/active.a', { raw: 'BEGIN:VCALENDAR\nEND:VCALENDAR' });
  assert.equal(r.status, 204);
});

test('POST /api/ics/<missing> returns 404', async () => {
  const r = await req('POST', '/api/ics/missing.x', { raw: 'BEGIN:VCALENDAR\nEND:VCALENDAR' });
  assert.equal(r.status, 404);
});

test('GET /ics/<slug> serves the calendar', async () => {
  const r = await req('GET', '/ics/active.a');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/calendar/);
});

test('POST /api/state/<slug> reports state', async () => {
  const r = await req('POST', '/api/state/active.a', { body: { startDate: '2026-03-01' } });
  assert.equal(r.status, 204);
});

test('POST /api/state/<missing> returns 404', async () => {
  const r = await req('POST', '/api/state/missing.x', { body: { startDate: '2026-03-01' } });
  assert.equal(r.status, 404);
});

test('POST /api/activate/<slug> with no idToken returns 400', async () => {
  const r = await req('POST', '/api/activate/active.a', { body: {} });
  assert.equal(r.status, 400);
});

test('POST /api/activate/<missing> returns 404', async () => {
  const r = await req('POST', '/api/activate/missing.x', { body: { idToken: 'x' } });
  assert.equal(r.status, 404);
});

test('GET /api/logged/<slug> returns the green days', async () => {
  const r = await req('GET', '/api/logged/active.a');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { days: { '2026-03-01': ['ghk'] } });
});

/* ---------- dashboard session ---------- */

test('POST /api/session with the passphrase signs in', async () => {
  const r = await req('POST', '/api/session', { body: { passphrase: 'testpassphrase' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.headers.getSetCookie().some(c => c.startsWith('ca_studio=')), true);
});

test('POST /api/session with a wrong passphrase returns 401', async () => {
  const r = await req('POST', '/api/session', { body: { passphrase: 'wrong' } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'bad_passphrase' });
});

test('GET /api/session reports signed-out when no cookie', async () => {
  const r = await req('GET', '/api/session');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { signedIn: false, required: true });
});

/* ---------- the read-only overview ---------- */

test('GET /api/overview without the bearer token returns 401', async () => {
  const r = await req('GET', '/api/overview');
  assert.equal(r.status, 401);
});

test('GET /api/overview with the token lists non-blank cards', async () => {
  const r = await req('GET', '/api/overview', { headers: { Authorization: 'Bearer test-agent-token' } });
  assert.equal(r.status, 200);
  const slugs = r.body.patients.map(p => p.slug);
  assert.ok(slugs.includes('active.a'));
  assert.ok(slugs.includes('retired.c'));
  assert.ok(!slugs.includes('blank.b'));
});

/* ---------- services ---------- */

test('GET /api/services serves the menu', async () => {
  const r = await req('GET', '/api/services');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.services));
  assert.ok(r.body.services.some(s => s.id === 'prx'));
});

/* ---------- the dashboard (clinician) ---------- */

test('GET /api/cards without a session returns 401', async () => {
  const r = await req('GET', '/api/cards');
  assert.equal(r.status, 401);
});

test('GET /api/cards with a session lists cards with supply', async () => {
  await signIn();
  const r = await req('GET', '/api/cards', { headers: studio() });
  assert.equal(r.status, 200);
  assert.equal(r.body.store, 'file');
  assert.ok(Array.isArray(r.body.cards));
  assert.ok(r.body.cards.some(c => c.slug === 'active.a'));
});

test('POST /api/cards mints a card from a name', async () => {
  const r = await req('POST', '/api/cards', {
    headers: studio(), body: { firstName: 'Phillip', lastName: 'Hurley', unique: false },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.slug, 'phil.h');
});

test('POST /api/cards with a taken slug returns 409', async () => {
  const r = await req('POST', '/api/cards', { headers: studio(), body: { slug: 'active.a' } });
  assert.equal(r.status, 409);
});

test('POST /api/cards with an invalid slug returns 400', async () => {
  const r = await req('POST', '/api/cards', { headers: studio(), body: { slug: 'BAD SLUG!' } });
  assert.equal(r.status, 400);
});

test('GET /api/cards/<slug> reads a card back', async () => {
  const r = await req('GET', '/api/cards/active.a', { headers: studio() });
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, 'active.a');
});

test('PUT /api/cards/<slug> updates a card', async () => {
  const r = await req('PUT', '/api/cards/active.a', { headers: studio(), body: { note: 'hi' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.note, 'hi');
});

test('DELETE /api/cards/<slug> removes a card', async () => {
  const r = await req('DELETE', '/api/cards/retired.c', { headers: studio() });
  assert.equal(r.status, 204);
});

test('GET /api/doses/<slug> with a session reads the log', async () => {
  const r = await req('GET', '/api/doses/active.a', { headers: studio() });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.doses));
});

/* ---------- wallet / push ---------- */

test('GET /api/wallet/status reports unconfigured', async () => {
  const r = await req('GET', '/api/wallet/status');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { available: false });
});

test('GET /api/wallet/<missing> returns 404', async () => {
  const r = await req('GET', '/api/wallet/missing.x');
  assert.equal(r.status, 404);
});

test('GET /api/wallet/<slug> without certs returns 503', async () => {
  const r = await req('GET', '/api/wallet/active.a');
  assert.equal(r.status, 503);
});

test('GET /api/push/key reports configured', async () => {
  const r = await req('GET', '/api/push/key');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(typeof r.body.key, 'string');
});

test('POST /api/push/subscribe saves a subscription', async () => {
  const r = await req('POST', '/api/push/subscribe', {
    body: { slug: 'active.a', sub: { endpoint: 'https://push.example.com/a', keys: { p256dh: 'pk', auth: 'au' } }, due: [] },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.ok, true);
});

test('POST /api/push/subscribe with a bad body returns 400', async () => {
  const r = await req('POST', '/api/push/subscribe', { body: { slug: 'active.a' } });
  assert.equal(r.status, 400);
});

test('POST /api/push/run without the secret returns 401', async () => {
  const r = await req('POST', '/api/push/run');
  assert.equal(r.status, 401);
});

test('POST /api/push/run with the secret runs the sweep', async () => {
  const r = await req('POST', '/api/push/run', { headers: { 'x-push-secret': 'test-run-secret' } });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.sent, 'number');
});

test('POST /api/push/run sweeps a phone due right now', async () => {
  const due = new Date(Date.now() - 60000).toISOString();
  await req('POST', '/api/push/subscribe', {
    body: { slug: 'active.a', sub: { endpoint: 'https://push.example.com/run', keys: { p256dh: 'pk', auth: 'au' } }, due: [due] },
  });
  const r = await req('POST', '/api/push/run', { headers: { 'x-push-secret': 'test-run-secret' } });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.sent, 'number');
});

test('POST /api/push/unsubscribe without an endpoint returns 400', async () => {
  const r = await req('POST', '/api/push/unsubscribe', { body: {} });
  assert.equal(r.status, 400);
});

test('GET /api/push/health with a session reports status', async () => {
  const r = await req('GET', '/api/push/health', { headers: studio() });
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, true);
  assert.equal(typeof r.body.phones, 'number');
});

test('GET /api/push/phones/<slug> with a session counts phones', async () => {
  const r = await req('GET', '/api/push/phones/active.a', { headers: studio() });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.phones, 'number');
});

test('POST /api/blanks mints a batch of blank tags', async () => {
  const r = await req('POST', '/api/blanks', { headers: studio(), body: { count: 2 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.cards.length, 2);
  assert.equal(r.body.cards[0].status, 'blank');
});

/* ---------- more router branches ---------- */

test('DELETE /__/auth/x is refused with 405', async () => {
  const r = await req('DELETE', '/__/auth/handler');
  assert.equal(r.status, 405);
});

test('POST /api/ics/<slug> with a non-calendar body returns 400', async () => {
  const r = await req('POST', '/api/ics/active.a', { raw: 'not a calendar' });
  assert.equal(r.status, 400);
});

test('POST /api/state/<slug> with a non-object body returns 400', async () => {
  const r = await req('POST', '/api/state/active.a', { body: [] });
  assert.equal(r.status, 400);
});

test('POST /api/dose twice is a duplicate, not two doses', async () => {
  const body = { slug: 'active.a', units: 5, template: 'ghk', day: '2026-03-02', at: '2026-03-02T20:00:00Z' };
  await req('POST', '/api/dose', { body });
  const r = await req('POST', '/api/dose', { body });
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true);
});

test('POST /api/added/<slug> dropping a prescribed pen notifies the atelier', async () => {
  const r = await req('POST', '/api/added/active.a', { body: { dropped: ['ghk'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.dropped, ['ghk']);
});

test('GET /api/session with a cookie reports signed in', async () => {
  const r = await req('GET', '/api/session', { headers: studio() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { signedIn: true, required: true });
});

test('POST /api/cards/<slug>/unlink clears the link', async () => {
  const r = await req('POST', '/api/cards/active.a/unlink', { headers: studio() });
  assert.equal(r.status, 200);
});

test('POST /api/push/atelier turns the atelier phone off', async () => {
  const r = await req('POST', '/api/push/atelier', {
    headers: studio(), body: { off: true, endpoint: 'https://push.example.com/x' },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, on: false });
});

test('POST /api/push/atelier turns the atelier phone on', async () => {
  const r = await req('POST', '/api/push/atelier', {
    headers: studio(),
    body: { sub: { endpoint: 'https://push.example.com/y', keys: { p256dh: 'pk', auth: 'au' } }, due: [] },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { ok: true, on: true });
});

test('GET /api/push/atelier reads the atelier subscriptions', async () => {
  const r = await req('GET', '/api/push/atelier', { headers: studio() });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.on, 'number');
});

test('POST /api/push/unsubscribe with an endpoint removes it', async () => {
  const r = await req('POST', '/api/push/unsubscribe', { body: { endpoint: 'https://push.example.com/x' } });
  assert.equal(r.status, 200);
});

test('POST /api/push/test sends to the card phones', async () => {
  const r = await req('POST', '/api/push/test', { headers: studio(), body: { slug: 'active.a' } });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.phones, 'number');
  assert.equal(typeof r.body.sent, 'number');
});

test('GET /api/push/phones/<slug> without a session returns 401', async () => {
  const r = await req('GET', '/api/push/phones/active.a');
  assert.equal(r.status, 401);
});

test('POST /api/activate/<slug> with a non-string idToken returns 400', async () => {
  const r = await req('POST', '/api/activate/active.a', { body: { idToken: 42 } });
  assert.equal(r.status, 400);
});

/* ---------- static portal ---------- */

test('GET / serves the portal index', async () => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
});

test('GET /studio serves the dashboard', async () => {
  const r = await req('GET', '/studio');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
});

test('GET /studio/<file> serves a studio asset', async () => {
  const r = await req('GET', '/studio/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /javascript/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('GET /studio/<missing> falls through to 404', async () => {
  const r = await req('GET', '/studio/missing.js');
  assert.equal(r.status, 404);
});

test('GET /<valid slug> injects the card and serves the portal', async () => {
  const r = await req('GET', '/active.a');
  assert.equal(r.status, 200);
  assert.match(r.body, /window\.__CARD_SLUG__="active\.a"/);
});

test('GET /<blank slug> still opens the portal', async () => {
  const r = await req('GET', '/blank.b');
  assert.equal(r.status, 200);
});

test('GET /<unknown path> returns 404', async () => {
  const r = await req('GET', '/no/such/thing');
  assert.equal(r.status, 404);
});

test('GET /..%2f..%2fetc%2fpasswd refuses the traversal', async () => {
  const r = await req('GET', '/..%2f..%2fetc%2fpasswd');
  assert.equal(r.status, 403);
});

test('POST /<static path> is refused with 405', async () => {
  const r = await req('POST', '/whatever');
  assert.equal(r.status, 405);
});
