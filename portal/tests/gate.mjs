/* The welcome gate appears for an assigned stored card and never for a
   fragment card or a legacy card. Needs (see tests/README.md):

     firebase emulators:start --only auth               # 127.0.0.1:9099
     CARD_STORE=file CARD_FILE=.data-test/gate-cards.json PORT=8097 node server.js
   with a stored card seeded at gate.t (name + pens) and no session. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:8097';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const b = await chromium.launch();
const page = await b.newPage();

/* a stored card with no session: the gate */
await page.goto(`${BASE}/gate.t`);
await page.waitForSelector('#auth-gate', { timeout: 25000 });
const state = await page.getAttribute('#auth-gate', 'data-state');
check('stored card shows the welcome gate', state === 'welcome', state);

const title = await page.textContent('#auth-gate h1');
check('welcome copy is present', /Welcome to The Charleston Atelier/.test(title), title);

const buttons = await page.locator('#auth-gate button').count();
check('exactly one Google button', buttons === 1, `buttons=${buttons}`);

const google = await page.textContent('#auth-gate button');
check('button says Sign in with Google', /Sign in with Google/.test(google), google);

const sms = await page.locator('#auth-gate a[href^="sms:"]').count();
check('message-the-atelier link is an sms: deep link', sms >= 1, `sms links=${sms}`);

/* a fragment card: no gate */
await page.goto(`${BASE}/#Gate~nad`);
await page.waitForSelector('body.resolved', { timeout: 25000 });
const fragGate = await page.locator('#auth-gate').count();
check('fragment card shows no gate', fragGate === 0, `gate count=${fragGate}`);

/* a legacy card: no gate */
await page.goto(`${BASE}/?card=legacy`);
await page.waitForSelector('body.resolved', { timeout: 25000 });
const legacyGate = await page.locator('#auth-gate').count();
check('legacy card shows no gate', legacyGate === 0, `gate count=${legacyGate}`);

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the gate appears for a stored card and nowhere else.');
process.exit(bad ? 1 : 0);
