/* The gate's three remaining faces, all with real sessions against the
   Auth emulator: a different account is blocked, a wiped session shows
   the gate again and the same account re-verifies without rewriting the
   link, and a remembered session skips the gate on later taps.

   Needs (see tests/README.md):
     firebase emulators:start --only auth               # 127.0.0.1:9099
     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
       CARD_STORE=file CARD_FILE=.data-test/gate-edge-cards.json \
       STUDIO_PASSPHRASE=testpassphrase PORT=8098 node server.js */
import { chromium } from 'playwright';
import { signInGoogle, clearSession } from './auth-session.mjs';

const BASE = 'http://localhost:8098';
const PASS = 'testpassphrase';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

/* a clinician view of the full record */
const signin = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passphrase: PASS })
});
const cookie = (signin.headers.get('set-cookie') || '').split(';')[0];
const record = () => fetch(`${BASE}/api/cards/edge.t`, { headers: { Cookie: cookie } })
  .then(r => r.json());

await fetch(`${BASE}/api/cards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ slug: 'edge.t', name: 'Edge', status: 'active', pens: [{ template: 'nad' }] })
});

const b = await chromium.launch();

/* 1 — the owner signs in and links */
const ownerCtx = await b.newContext();
const op = await ownerCtx.newPage();
await op.goto(`${BASE}/`);
await signInGoogle(op, { identity: 'edge-owner' });
await op.goto(`${BASE}/edge.t`);
await op.waitForSelector('body.resolved', { timeout: 25000 });
check('owner opens the card with no gate', await op.locator('#auth-gate').count() === 0);

let rec = await record();
check('the card is linked', !!rec.activatedBy, JSON.stringify(rec.activatedBy));
const ownerUid = rec.activatedBy.uid;
const at1 = rec.activatedBy.at;

/* 2 — a later tap on the same device skips the gate */
await op.goto(`${BASE}/edge.t`);
await op.waitForSelector('body.resolved', { timeout: 25000 });
check('remembered session skips the gate on the next tap',
  await op.locator('#auth-gate').count() === 0);

/* 3 — a different account is blocked */
const strangerCtx = await b.newContext();
const sp = await strangerCtx.newPage();
await sp.goto(`${BASE}/`);
await signInGoogle(sp, { identity: 'edge-stranger' });
await sp.goto(`${BASE}/edge.t`);
await sp.waitForSelector('#auth-gate', { timeout: 25000 });
check('different account is blocked',
  (await sp.getAttribute('#auth-gate', 'data-state')) === 'blocked');
const stuckText = await sp.textContent('#auth-gate');
check('blocked screen says the card is already activated', /already activated/i.test(stuckText));
const actions = await sp.locator('#auth-gate a').count();
check('blocked screen has exactly one action', actions === 1, `actions=${actions}`);
check('the one action is message the atelier',
  (await sp.locator('#auth-gate a').getAttribute('href') || '').startsWith('sms:'));
rec = await record();
check('the block did not overwrite the link',
  rec.activatedBy.uid === ownerUid && rec.activatedBy.at === at1,
  JSON.stringify(rec.activatedBy));

/* 4 — the owner's session is wiped (ITP): the gate returns, the same
   account re-verifies, and nothing is rewritten */
await clearSession(op);
await op.goto(`${BASE}/edge.t`);
await op.waitForSelector('#auth-gate', { timeout: 25000 });
check('a wiped session shows the gate again',
  (await op.getAttribute('#auth-gate', 'data-state')) === 'welcome');
await signInGoogle(op, { identity: 'edge-owner' });
await op.reload();
await op.waitForSelector('body.resolved', { timeout: 25000 });
check('re-signing in with the same account opens the card',
  await op.locator('#auth-gate').count() === 0);
rec = await record();
check('the link was not rewritten',
  rec.activatedBy.uid === ownerUid && rec.activatedBy.at === at1,
  JSON.stringify(rec.activatedBy));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — blocked strangers, remembered sessions, and verify-only re-links.');
process.exit(bad ? 1 : 0);
