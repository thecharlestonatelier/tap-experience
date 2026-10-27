/* The welcome gate appears for an assigned stored card and never for a
   fragment card or a legacy card. It offers two paths — Google and email
   — and the email form validates before anything reaches the SDK. Needs
   (see tests/README.md):

     firebase emulators:start --only auth               # 127.0.0.1:9099
     CARD_STORE=file CARD_FILE=.data-test/gate-cards.json PORT=8097 node server.js
   with a stored card seeded at gate.t (name + pens) and no session. */
import { chromium } from 'playwright';

/* Arrange — the harness, and a listener that counts activate posts */
const BASE = 'http://localhost:8097';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const b = await chromium.launch();
const page = await b.newPage();
const activatePosts = [];
page.on('request', req => {
  if (/\/api\/activate\//.test(req.url())) activatePosts.push(req.url());
});

/* Act — open a stored card with no session */
await page.goto(`${BASE}/gate.t`);
await page.waitForSelector('#auth-gate', { timeout: 25000 });
/* Assert — the welcome gate, with its copy and both paths */
const state = await page.getAttribute('#auth-gate', 'data-state');
check('stored card shows the welcome gate', state === 'welcome', state);

const title = await page.textContent('#auth-gate h1');
check('welcome copy is present', /Welcome to The Charleston Atelier/.test(title), title);

const googleButtons = await page.locator('#auth-gate button:has-text("Sign in with Google")').count();
check('exactly one Google button', googleButtons === 1, `google buttons=${googleButtons}`);

const emailAffordance = await page.locator('#auth-gate [data-email]').count();
check('the email path is offered', emailAffordance === 1, `email affordances=${emailAffordance}`);

const sms = await page.locator('#auth-gate a[href^="sms:"]').count();
check('message-the-atelier link is an sms: deep link', sms >= 1, `sms links=${sms}`);

/* Act — open the email form */
await page.locator('#auth-gate [data-email]').click();
/* Assert — the form opens in sign-up mode, name field showing */
check('the email form opens', (await page.getAttribute('#auth-gate', 'data-state')) === 'email');

const signupName = await page.locator('#auth-gate input[autocomplete="name"]').isVisible();
check('sign-up mode shows the name field', signupName);

/* Act — switch to sign-in mode */
await page.locator('#auth-gate a:has-text("Already have an account")').click();
/* Assert — the name field hides, forgot-password shows */
const signinName = await page.locator('#auth-gate input[autocomplete="name"]').isVisible();
check('sign-in mode hides the name field', !signinName);
const forgot = await page.locator('#auth-gate a:has-text("Forgot password")').isVisible();
check('sign-in mode shows forgot-password', forgot);

/* Act — back to sign-up, and submit a malformed email and a short password */
await page.locator('#auth-gate a:has-text("New here")').click();
await page.locator('#auth-gate input[type="email"]').fill('not-an-email');
await page.locator('#auth-gate input[type="password"]').fill('short');
await page.locator('#auth-gate button:has-text("Create account")').click();
/* Assert — field errors, and nothing reached the SDK or the service */
const emailErr = await page.locator('#auth-gate [data-field-error]').filter({ hasText: 'valid email' }).isVisible();
const passErr = await page.locator('#auth-gate [data-field-error]').filter({ hasText: 'at least 8' }).isVisible();
check('a malformed email is rejected with a field error', emailErr);
check('a short password is rejected with a field error', passErr);
check('nothing reached the SDK or the service on invalid input', activatePosts.length === 0, `${activatePosts.length} activate posts`);

/* Act — open a fragment card */
await page.goto(`${BASE}/#Gate~nad`);
await page.waitForSelector('body.resolved', { timeout: 25000 });
/* Assert — no gate */
const fragGate = await page.locator('#auth-gate').count();
check('fragment card shows no gate', fragGate === 0, `gate count=${fragGate}`);

/* Act — open a legacy card */
await page.goto(`${BASE}/?card=legacy`);
await page.waitForSelector('body.resolved', { timeout: 25000 });
/* Assert — no gate */
const legacyGate = await page.locator('#auth-gate').count();
check('legacy card shows no gate', legacyGate === 0, `gate count=${legacyGate}`);

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the gate offers Google and email, validates first, and appears for a stored card only.');
process.exit(bad ? 1 : 0);
