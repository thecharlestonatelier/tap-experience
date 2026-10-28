/* The first-tap activation link, against a running service and the Auth
   emulator: a Google ID token links a card exactly once, a second POST
   with the same account verifies and writes nothing, a different account
   is refused, the public card read never shows who a card belongs to,
   and a Studio save keeps the link.

   Needs (see tests/README.md):
     firebase emulators:start --only auth          # 127.0.0.1:9099
     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
       CARD_STORE=file CARD_FILE=.data-test/activate-cards.json \
       STUDIO_PASSPHRASE=testpassphrase PORT=8095 node server.js

   The emulator mints real users and real ID tokens: the Admin SDK on the
   service verifies them exactly as it will in production. The provider
   stamped on an emulator token is `custom`; a real Google sign-in stamps
   `google.com` — the service copies whatever the token carries. */
import admin from 'firebase-admin';
import { assertAuthEmulatorUp } from './emulator-guard.mjs';

await assertAuthEmulatorUp();

const BASE = 'http://localhost:8095';
const PASS = 'testpassphrase';
const AUTH_EMU = 'http://127.0.0.1:9099';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

admin.initializeApp({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'atelier-tap'
});

/* Arrange — a user with a name, and an ID token for it */
async function mint(name) {
  const uid = `t${Math.random().toString(36).slice(2, 10)}`;
  const user = await admin.auth().createUser({ uid, email: `${uid}@example.com`, displayName: name });
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(
    `${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true })
    });
  const json = await r.json();
  if (!r.ok || !json.idToken) throw new Error(`token exchange failed: ${r.status}`);
  return { uid: user.uid, idToken: json.idToken };
}

const post = (path, body, headers = {}) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
  body: JSON.stringify(body)
});

/* Arrange — a fresh card every run (so the test can be run twice), a
   clinician session to write it, and two contending accounts */
const SUFFIX = Math.random().toString(36).slice(2, 8);
const SLUG = `auth${SUFFIX}.t`;

const signin = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passphrase: PASS })
});
const cookie = (signin.headers.get('set-cookie') || '').split(';')[0];

await fetch(`${BASE}/api/cards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ slug: SLUG, name: 'Auth', status: 'active', pens: [{ template: 'nad' }] })
});

const alice = await mint('Alice Example');
const bob = await mint('Bob Example');

const full = () => fetch(`${BASE}/api/cards/${SLUG}`, { headers: { Cookie: cookie } }).then(r => r.json());

/* Act — post no token */
let r = await post(`/api/activate/${SLUG}`, {});
/* Assert — refused */
check('missing token refused', r.status === 400);

/* Act — post a nonsense token */
r = await post(`/api/activate/${SLUG}`, { idToken: 'not-a-token' });
/* Assert — refused */
check('bad token refused', r.status === 400);

/* Act — point a real token at an unknown card */
r = await post('/api/activate/nope.x', { idToken: alice.idToken });
/* Assert — refused */
check('unknown card refused', r.status === 404);

/* Act — the first link */
r = await post(`/api/activate/${SLUG}`, { idToken: alice.idToken });
const first = await r.json();
/* Assert — accepted, and the record holds exactly the four link fields */
check('first link accepted', r.status === 200 && first.ok && first.result === 'linked', JSON.stringify(first));

let rec = await full();
check('link fields written',
  rec.activatedBy &&
  rec.activatedBy.uid === alice.uid &&
  rec.activatedBy.provider === 'custom' &&
  rec.activatedBy.name === 'Alice Example' &&
  /^\d{4}-\d{2}-\d{2}T/.test(rec.activatedBy.at || ''),
  JSON.stringify(rec.activatedBy));
check('link holds exactly the four fields',
  Object.keys(rec.activatedBy).sort().join() === 'at,name,provider,uid',
  Object.keys(rec.activatedBy).join(','));
const at1 = rec.activatedBy.at;

/* Act — the same account again */
r = await post(`/api/activate/${SLUG}`, { idToken: alice.idToken });
const again = await r.json();
/* Assert — verified, and nothing written */
check('same uid verifies', r.status === 200 && again.result === 'verified', JSON.stringify(again));
rec = await full();
check('no second write', rec.activatedBy.at === at1, `${rec.activatedBy.at} vs ${at1}`);

/* Act — a different account */
r = await post(`/api/activate/${SLUG}`, { idToken: bob.idToken });
/* Assert — refused, and the link stands */
check('different uid refused', r.status === 409, JSON.stringify(await r.json().catch(() => ({}))));
rec = await full();
check('link unchanged after refusal',
  rec.activatedBy.uid === alice.uid && rec.activatedBy.at === at1);

/* Act — read the card the way a tap does, with no cookie */
const pub = await fetch(`${BASE}/api/card/${SLUG}`).then(x => x.json());
/* Assert — who it belongs to never leaves */
check('public card read hides activation', pub.activatedBy === undefined && pub.name === 'Auth');

/* Act — a Studio save */
r = await fetch(`${BASE}/api/cards/${SLUG}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ name: 'Auth Renamed' })
});
const saved = await r.json();
/* Assert — accepted, and the link survives */
check('studio save accepted', r.status === 200, JSON.stringify(saved));
check('studio save keeps link',
  saved.activatedBy && saved.activatedBy.uid === alice.uid && saved.activatedBy.at === at1,
  JSON.stringify(saved.activatedBy));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — links once, verifies the same account, refuses another, hides and preserves the link.');
process.exit(bad ? 1 : 0);
