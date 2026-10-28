/* The public card read stays inside publicView() even when the record is
   carrying what a tap and a phone report leave behind — taps,
   firstSeen/lastSeen, days, and the state report — and after the card has
   been activated. public-view-shape.mjs pins the clinician note and the
   treatment record; this pins the counters and the link. The activated
   card is minted through the Auth emulator's REST sign-up, so no
   firebase-admin is needed.

   Node, against a file-store service with the emulator wired:
     source /tmp/qa-env.sh && BASE=http://localhost:8096 node tests/public-view-counters.mjs */
import { readFileSync } from 'node:fs';
import { assertAuthEmulatorUp } from './emulator-guard.mjs';

await assertAuthEmulatorUp();

/* Arrange — a studio session and the harness */
const BASE = process.env.BASE || 'http://localhost:8096';
const AUTH_EMU = 'http://127.0.0.1:9099';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);

/* ---------- 7. the tap and state counters never leave ---------- */

/* Arrange — a card that is tapped twice and reports its state */
const slug = `pvc${stamp}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Counter Probe', pens: [{ template: 'ghk' }] }) });
await fetch(`${BASE}/api/tap/${slug}`, { method: 'POST' });
await fetch(`${BASE}/api/tap/${slug}`, { method: 'POST' });
await fetch(`${BASE}/api/state/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ startDate: '2026-10-20',
    today: [{ pen: 'ghk', template: 'ghk', phase: 'p1', units: 10 }],
    supply: [{ template: 'ghk', dosesLeft: 2, lastDose: '2026-10-19' }] }) });

/* Assert — the counters really are on the record (the clinician's view) */
const full = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
check('the record really carries the counters',
  Number(full.taps) === 2 && !!full.lastSeen && full.days && full.state,
  `taps=${full.taps}`);

/* Act — the public, unauthenticated read */
const pub = await (await fetch(`${BASE}/api/card/${slug}`)).json();
/* Assert — none of the counters ride it */
for (const k of ['taps', 'firstSeen', 'lastSeen', 'days', 'state']) {
  check(`the public read hides ${k}`, !(k in pub), Object.keys(pub).join(', '));
}

/* ---------- 8. activation never leaves either ---------- */

/* Arrange — a fresh card, and a real account via the emulator */
const actSlug = `pva${stamp}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: actSlug, name: 'Activated Probe', pens: [{ template: 'ghk' }] }) });
const email = `pvc-${stamp}@example.com`;
const signup = await fetch(`${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=any`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'password123', returnSecureToken: true })
});
const su = await signup.json();
if (!su.idToken) throw new Error(`emulator sign-up failed: ${signup.status}`);

/* Act — link the card */
const act = await fetch(`${BASE}/api/activate/${actSlug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idToken: su.idToken }) });
const actRes = await act.json();
check('the card is linked', act.status === 200 && actRes.result === 'linked', JSON.stringify(actRes));

/* Assert — the link is on the clinician's record but not the public one */
const actFull = await (await fetch(`${BASE}/api/cards/${actSlug}`, { headers: H })).json();
check('the link is on the record', !!actFull.activatedBy, JSON.stringify(actFull.activatedBy));
const actPub = await (await fetch(`${BASE}/api/card/${actSlug}`)).json();
check('and the public read hides it', !('activatedBy' in actPub), Object.keys(actPub).join(', '));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — counters and the link stay on the clinician\'s side of the wire.');
process.exit(bad ? 1 : 0);
