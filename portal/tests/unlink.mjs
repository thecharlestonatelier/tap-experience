/* The clinician's link reset: a passphrase-protected POST clears a card's
   activatedBy and nothing else, an unauthenticated POST is refused, and
   the next sign-in links the card again. Needs (see tests/README.md):

     firebase emulators:start --only auth               # 127.0.0.1:9099
     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
       CARD_STORE=file CARD_FILE=.data-test/unlink-cards.json \
       STUDIO_PASSPHRASE=testpassphrase PORT=8090 node server.js */
import admin from 'firebase-admin';

const BASE = 'http://localhost:8090';
const PASS = 'testpassphrase';
const AUTH_EMU = 'http://127.0.0.1:9099';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'atelier-tap' });

async function mint(name) {
  const uid = `u${Math.random().toString(36).slice(2, 10)}`;
  await admin.auth().createUser({ uid, email: `${uid}@example.com`, displayName: name });
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(
    `${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true })
    });
  const json = await r.json();
  if (!r.ok || !json.idToken) throw new Error(`token exchange failed: ${r.status}`);
  return { uid, idToken: json.idToken };
}

const signin = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passphrase: PASS })
});
const cookie = (signin.headers.get('set-cookie') || '').split(';')[0];

await fetch(`${BASE}/api/cards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ slug: 'unlink.t', name: 'Unlink', status: 'active', pens: [{ template: 'nad' }] })
});

const alice = await mint('Alice Example');
const full = () => fetch(`${BASE}/api/cards/unlink.t`, { headers: { Cookie: cookie } })
  .then(r => r.json());
const post = (path, headers = {}) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
  body: '{}'
});

/* link the card, then try the reset without a session */
let r = await fetch(`${BASE}/api/activate/unlink.t`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idToken: alice.idToken })
});
check('card links first', r.status === 200, JSON.stringify(await r.json()));
check('link is on the record', !!(await full()).activatedBy);

r = await post('/api/cards/unlink.t/unlink');
check('unlink without a session is refused', r.status === 401, `status ${r.status}`);

/* the clinician clears it */
r = await post('/api/cards/unlink.t/unlink', { Cookie: cookie });
check('unlink accepted', r.status === 200, JSON.stringify(await r.json()));
check('link is gone', !(await full()).activatedBy);
check('nothing else on the card moved', ((await full()).pens || []).length === 1);

/* the next sign-in links again */
r = await fetch(`${BASE}/api/activate/unlink.t`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idToken: alice.idToken })
});
const relinked = await r.json();
check('the next sign-in links again', r.status === 200 &&
  relinked.result === 'linked', JSON.stringify(relinked));

/* an unknown card is a 404, not a write */
r = await post('/api/cards/nope.x/unlink', { Cookie: cookie });
check('unknown card unlink is refused', r.status === 404, `status ${r.status}`);

console.log(bad ? `\n${bad} FAILED` : '\nPASS — the clinician can clear a wrong link, nobody else can, and the next sign-in re-links.');
process.exit(bad ? 1 : 0);
