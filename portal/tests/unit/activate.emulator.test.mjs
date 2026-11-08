/* Pin handleActivate's token path against the Firebase Auth emulator.
   `npm test` runs this under `firebase emulators:exec`, which starts the
   emulators and tears them down, so the harness owns their lifecycle here.
   Run directly via `node --test`, it reads FIREBASE_AUTH_EMULATOR_HOST and
   skips if the emulator is not reachable. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_AUTH_EMULATOR_HOST = HOST;
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'atelier-tap';

const reachable = await (async () => {
  try { await fetch(`http://${HOST}/`, { signal: AbortSignal.timeout(2000) }); return true; }
  catch { return false; }
})();

if (!reachable) {
  test('activate pin (skipped: no auth emulator)', { skip: `auth emulator not reachable at ${HOST}` }, () => {});
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-activate-'));
  process.env.CARD_STORE = 'file';
  process.env.CARD_FILE = path.join(tmp, 'cards.json');
  process.env.STUDIO_PASSPHRASE = 'testpassphrase';
  const now = new Date().toISOString();
  fs.writeFileSync(process.env.CARD_FILE, JSON.stringify({
    'act.a': { slug: 'act.a', name: 'Act', status: 'active', startDate: null, note: '',
               pens: [], added: [], dropped: [], createdAt: now, updatedAt: now },
    'noname.a': { slug: 'noname.a', name: 'NoName', status: 'active', startDate: null, note: '',
                  pens: [], added: [], dropped: [], createdAt: now, updatedAt: now },
  }, null, 2));

  const { server } = await import('../../server.js');
  const admin = (await import('firebase-admin')).default;
  admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });

  let base;
  before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  async function mint(name) {
    const uid = `t${Math.random().toString(36).slice(2, 10)}`;
    const profile = { uid, email: `${uid}@example.com` };
    if (name) profile.displayName = name;
    await admin.auth().createUser(profile);
    const custom = await admin.auth().createCustomToken(uid);
    const r = await fetch(
      `http://${HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: custom, returnSecureToken: true }) });
    const body = await r.json();
    if (!r.ok || !body.idToken) throw new Error(`token exchange failed: ${r.status}`);
    return { uid, idToken: body.idToken };
  }
  const post = (p, body) => fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function signIn() {
    const r = await fetch(base + '/api/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: 'testpassphrase' }) });
    return (r.headers.getSetCookie().find(c => c.startsWith('ca_studio=')) || '').split(';')[0];
  }

  test('activate refuses a missing token', async () => {
    const r = await post('/api/activate/act.a', {});
    assert.equal(r.status, 400);
  });

  test('activate refuses a nonsense token', async () => {
    const r = await post('/api/activate/act.a', { idToken: 'not-a-token' });
    assert.equal(r.status, 400);
  });

  test('activate refuses an unknown card', async () => {
    const alice = await mint('Alice');
    const r = await post('/api/activate/nope.x', { idToken: alice.idToken });
    assert.equal(r.status, 404);
  });

  test('activate links once, verifies the same account, refuses another', async () => {
    const alice = await mint('Alice Example');
    const bob = await mint('Bob Example');

    let r = await post('/api/activate/act.a', { idToken: alice.idToken });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, result: 'linked' });

    r = await post('/api/activate/act.a', { idToken: alice.idToken });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).result, 'verified');

    r = await post('/api/activate/act.a', { idToken: bob.idToken });
    assert.equal(r.status, 409);
  });

  test('activate links a token with no display name', async () => {
    const user = await mint();
    const r = await post('/api/activate/noname.a', { idToken: user.idToken });
    assert.equal(r.status, 200);
    const cookie = await signIn();
    const card = await (await fetch(base + '/api/cards/noname.a', { headers: { Cookie: cookie } })).json();
    assert.equal(card.activatedBy.uid, user.uid);
    assert.equal(card.activatedBy.name, '');
  });
}
