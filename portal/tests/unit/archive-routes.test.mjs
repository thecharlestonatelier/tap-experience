/* QA designer defensive tests — issue #12 per-pen archive endpoint edges.

   Runs the real server in-process against a file store (the same style as
   portal/tests/unit/route.test.mjs) and pins the /api/archive endpoint and
   its interaction with a card save:

     gap 1 — an added-pen id carrying `+` (bpc+<base36>) archives and
             restores through the endpoint, and survives a card save.
     gap 2 — a twin pen pair uses ghk#0 / ghk#1 keys, never the bare ghk;
             the bare key is refused, one twin restores without the other.
     gap 3 — endpoint edges: a well-formed id not on the card is 400; a
             phantom twin key (ghk#0 on a single-pen card) is 400;
             archived:{} clears; archived:[] and archived:null preserve;
             a force/rev-bumping settings save preserves the archive. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-qa-archive-'));
process.env.CARD_STORE = 'file';
process.env.CARD_FILE = path.join(tmp, 'cards.json');
process.env.DOSE_FILE = path.join(tmp, 'doses.json');
process.env.SUB_FILE = path.join(tmp, 'subs.json');
process.env.FEED_FILE = path.join(tmp, 'feeds.json');
process.env.TOMBSTONE_FILE = path.join(tmp, 'tombstones.json');
process.env.STUDIO_PASSPHRASE = 'testpassphrase';
process.env.AGENT_TOKEN = 'test-agent-token';
process.env.PUSH_RUN_SECRET = 'test-run-secret';

/* VAPID key pair so the push routes are "configured" at module load. */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
const jwk = privateKey.export({ format: 'jwk' });
process.env.VAPID_PUBLIC_KEY = Buffer.from(pubRaw).toString('base64url');
process.env.VAPID_PRIVATE_KEY = jwk.d;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const now = new Date().toISOString();
const card = (slug, name, opts = {}) => Object.assign({
  slug, name, startDate: null, status: 'active', note: '',
  pens: [], added: [], dropped: [], archived: {}, createdAt: now, updatedAt: now,
}, opts);

fs.writeFileSync(path.join(tmp, 'cards.json'), JSON.stringify({
  'twin.a': card('twin.a', 'Twin', { pens: [{ template: 'ghk' }, { template: 'ghk' }] }),
  'added.a': card('added.a', 'Added', { added: [{ id: 'bpc+abc123xyz', template: 'bpc' }] }),
  'edge.a': card('edge.a', 'Edge', { pens: [{ template: 'ghk' }] }),
}, null, 2));

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
const TS = /^\d{4}-\d{2}-\d{2}T/;

/* ---------- gap 1: added-pen ids carry `+` ---------- */

test('an added pen id with `+` archives and restores through the endpoint', async () => {
  const id = 'bpc+abc123xyz';
  const a = await req('POST', '/api/archive/added.a', { body: { id } });
  assert.equal(a.status, 200);
  assert.match(a.body.archived[id], TS, 'the + key is accepted and timestamped');

  const pub = await req('GET', '/api/card/added.a');
  assert.match(pub.body.archived[id], TS, 'the public view carries the + key');

  const d = await req('DELETE', '/api/archive/added.a', { headers: studio(), body: { id } });
  assert.equal(d.status, 200);
  assert.equal(d.body.archived[id], undefined, 'restore clears the + key');
});

test('an added pen with a `+` key survives a card save round-trip', async () => {
  const id = 'bpc+abc123xyz';
  await req('POST', '/api/archive/added.a', { body: { id } });
  const r = await req('PUT', '/api/cards/added.a', { headers: studio(), body: { note: 'kept' } });
  assert.equal(r.status, 200);
  assert.match(r.body.archived[id], TS, 'sanitizeArchived keeps the + key across a save');
  await req('DELETE', '/api/archive/added.a', { headers: studio(), body: { id } });
});

/* ---------- gap 2: twin pens use ghk#0 / ghk#1 ---------- */

test('a twin pair archives and restores by its twin key, never the bare template', async () => {
  const a = await req('POST', '/api/archive/twin.a', { body: { id: 'ghk#0' } });
  assert.equal(a.status, 200);
  assert.match(a.body.archived['ghk#0'], TS, 'ghk#0 archives');
  assert.equal(a.body.archived.ghk, undefined, 'the bare key is never written');

  const b = await req('POST', '/api/archive/twin.a', { body: { id: 'ghk#1' } });
  assert.equal(b.status, 200);
  assert.match(b.body.archived['ghk#1'], TS, 'ghk#1 archives independently');

  // The bare template is not a pen id once two share it.
  const bare = await req('POST', '/api/archive/twin.a', { body: { id: 'ghk' } });
  assert.equal(bare.status, 400, 'the bare ghk key is refused on a twin card');

  const d = await req('DELETE', '/api/archive/twin.a', { headers: studio(), body: { id: 'ghk#0' } });
  assert.equal(d.status, 200);
  assert.equal(d.body.archived['ghk#0'], undefined, 'ghk#0 restores');
  assert.match(d.body.archived['ghk#1'], TS, 'ghk#1 stays archived');
});

/* ---------- gap 3: endpoint and save edges ---------- */

test('a well-formed id not on the card is refused with 400', async () => {
  const r = await req('POST', '/api/archive/edge.a', { body: { id: 'b12' } });
  assert.equal(r.status, 400);
});

test('a phantom twin key (ghk#0 on a single-pen card) is refused with 400', async () => {
  const r = await req('POST', '/api/archive/edge.a', { body: { id: 'ghk#0' } });
  assert.equal(r.status, 400, 'ghk#0 does not exist on a card with one ghk pen');
  const ok = await req('POST', '/api/archive/edge.a', { body: { id: 'ghk' } });
  assert.equal(ok.status, 200, 'the bare key is the single pen\u2019s id');
  await req('DELETE', '/api/archive/edge.a', { headers: studio(), body: { id: 'ghk' } });
});

test('a card save with archived:{} clears the archive', async () => {
  await req('POST', '/api/archive/edge.a', { body: { id: 'ghk' } });
  const r = await req('PUT', '/api/cards/edge.a', { headers: studio(), body: { archived: {} } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.archived, {}, 'an explicit empty map clears');
});

test('a card save with archived:[] preserves the archive', async () => {
  await req('POST', '/api/archive/edge.a', { body: { id: 'ghk' } });
  const r = await req('PUT', '/api/cards/edge.a', { headers: studio(), body: { archived: [] } });
  assert.equal(r.status, 200);
  assert.match(r.body.archived.ghk, TS, 'an array is not an archive map and preserves');
  await req('DELETE', '/api/archive/edge.a', { headers: studio(), body: { id: 'ghk' } });
});

test('a card save with archived:null preserves the archive', async () => {
  await req('POST', '/api/archive/edge.a', { body: { id: 'ghk' } });
  const r = await req('PUT', '/api/cards/edge.a', { headers: studio(), body: { archived: null } });
  assert.equal(r.status, 200);
  assert.match(r.body.archived.ghk, TS, 'null is not an archive map and preserves');
  await req('DELETE', '/api/archive/edge.a', { headers: studio(), body: { id: 'ghk' } });
});

test('a force/rev-bumping settings save preserves the archive', async () => {
  await req('POST', '/api/archive/edge.a', { body: { id: 'ghk' } });
  const r = await req('PUT', '/api/cards/edge.a', {
    headers: studio(),
    body: { settings: { startDate: '2026-02-02', times: {}, penTimes: {}, force: true } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.rev, 1, 'the force save bumps the revision');
  assert.match(r.body.archived.ghk, TS, 'the archive survives the rev bump');
  await req('DELETE', '/api/archive/edge.a', { headers: studio(), body: { id: 'ghk' } });
});
