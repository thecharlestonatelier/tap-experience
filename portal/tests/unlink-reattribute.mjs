/* Unlink is a reattribution, not a retirement: after the clinician clears
   a wrong link, a DIFFERENT account must be able to claim the card, and
   the old uid must be gone. activate.mjs proves the first link; unlink.mjs
   clears it and re-links the SAME account; this suite closes the gap the
   spec's "next sign-in links the new account" names but neither covers.

   Needs (see tests/README.md):
     firebase emulators:start --only auth               # 127.0.0.1:9099
     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
       CARD_STORE=file CARD_FILE=.data-test/unlink-cards.json \
       STUDIO_PASSPHRASE=testpassphrase PORT=8090 node server.js */
import admin from 'firebase-admin';
import { assertAuthEmulatorUp } from './emulator-guard.mjs';

await assertAuthEmulatorUp();

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
  const uid = `r${Math.random().toString(36).slice(2, 10)}`;
  const user = await admin.auth().createUser({ uid, email: `${uid}@example.com`, displayName: name });
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(
    `${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const json = await r.json();
  if (!r.ok || !json.idToken) throw new Error(`token exchange failed: ${r.status}`);
  return { uid: user.uid, idToken: json.idToken };
}

/* Arrange — two accounts that will contend for one card, a clinician
   session, and a fresh card */
const first = await mint('First Owner');
const second = await mint('Second Owner');
const signin = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passphrase: PASS })
});
const cookie = signin.headers.get('set-cookie').split(';')[0];
const H = { 'Content-Type': 'application/json', Cookie: cookie };
const SUFFIX = Math.random().toString(36).slice(2, 8);
const SLUG = `rea${SUFFIX}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: SLUG, name: 'Reattribute', pens: [{ template: 'ghk' }], settings: { startDate: '2026-10-22' } }) });

/* Act 1 — the first account links the card */
let r = await fetch(`${BASE}/api/activate/${SLUG}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idToken: first.idToken }) });
const firstOutcome = await r.json();
/* Assert 1 */
check('the first account links the card', r.ok && firstOutcome.result === 'linked', JSON.stringify(firstOutcome));

/* Act 2 — the clinician clears the wrong link */
r = await fetch(`${BASE}/api/cards/${SLUG}/unlink`, { method: 'POST', headers: H });
/* Assert 2 */
check('unlink accepted', r.ok, `HTTP ${r.status}`);

/* Act 3 — a different account claims the freed card */
r = await fetch(`${BASE}/api/activate/${SLUG}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idToken: second.idToken }) });
const secondOutcome = await r.json();
/* Assert 3 — the claim is accepted and the record moved to the new owner */
check('a different account can claim the freed card', r.ok && secondOutcome.result === 'linked', JSON.stringify(secondOutcome));
const rec = await (await fetch(`${BASE}/api/cards/${SLUG}`, { headers: { Cookie: cookie } })).json();
check('the new owner is on the record', rec.activatedBy && rec.activatedBy.uid === second.uid,
  JSON.stringify(rec.activatedBy));
check('the old uid is gone', rec.activatedBy && rec.activatedBy.uid !== first.uid,
  JSON.stringify(rec.activatedBy));

console.log(bad ? `\n${bad} failing` : '\nPASS — a cleared link can be claimed by a new account.');
process.exit(bad ? 1 : 0);
