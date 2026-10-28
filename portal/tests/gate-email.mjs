/* The email + password path end to end, against a running service and the
   Auth emulator: sign-up through the gate links the card with provider
   'password' and the typed name; an existing email suggests sign-in and
   flips the form; a wrong password and an unknown email show one uniform
   message; and a password reset (Admin generatePasswordResetLink ->
   oobCode -> confirmPasswordReset in the browser) lets the patient back
   in without touching activatedBy. Needs (see tests/README.md):

     firebase emulators:start --only auth               # 127.0.0.1:9099
     SEED_FILE=.data-test/gate-email-cards.json npm run seed
     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
       CARD_STORE=file CARD_FILE=.data-test/gate-email-cards.json \
       STUDIO_PASSPHRASE=testpassphrase PORT=8093 node server.js */
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { signInGoogle, signInEmail, signUpEmail } from './auth-session.mjs';
import { assertAuthEmulatorUp } from './emulator-guard.mjs';

await assertAuthEmulatorUp();

/* Arrange — the harness, a fresh email identity, and a clinician view of
   the full records */
const BASE = 'http://localhost:8093';
const PASS = 'testpassphrase';
const EMAIL = `eleanor-${Date.now().toString(36)}@example.com`;
const PASSWORD = 'password123';
const NEW_PASSWORD = 'newpassword456';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'atelier-tap' });

const signin = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passphrase: PASS })
});
const cookie = (signin.headers.get('set-cookie') || '').split(';')[0];
const record = slug => fetch(`${BASE}/api/cards/${slug}`, { headers: { Cookie: cookie } })
  .then(r => r.json());

const browser = await chromium.launch();
const newCtx = async () => browser.newContext({ viewport: { width: 420, height: 900 } });
let gateAt1 = null;

/* open the email form on a card and (optionally) flip to sign-in */
async function openEmailForm(page, { signIn = false } = {}) {
  await page.waitForSelector('#auth-gate', { timeout: 25000 });
  await page.locator('#auth-gate [data-email]').click();
  if (signIn) await page.locator('#auth-gate a:has-text("Already have an account")').click();
}

/* Act — sign up through the gate with a typed name */
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/gate.t`);
  await openEmailForm(page);
  await page.locator('#auth-gate input[autocomplete="name"]').fill('Eleanor Test');
  await page.locator('#auth-gate input[type="email"]').fill(EMAIL);
  await page.locator('#auth-gate input[type="password"]').fill(PASSWORD);
  await page.locator('#auth-gate button:has-text("Create account")').click();
  await page.waitForSelector('body.resolved', { timeout: 25000 });
  /* Assert — the card opens, linked as provider password with the typed name */
  check('sign-up opens the card', await page.locator('#auth-gate').count() === 0);
  let rec = await record('gate.t');
  check('link is provider password',
    rec.activatedBy && rec.activatedBy.provider === 'password', JSON.stringify(rec.activatedBy));
  check('the typed name is stored', rec.activatedBy && rec.activatedBy.name === 'Eleanor Test',
    JSON.stringify(rec.activatedBy && rec.activatedBy.name));
  gateAt1 = rec.activatedBy.at;
  await ctx.close();
}

/* Act — the same email on another card, signing up again */
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/edge.t`);
  await openEmailForm(page);
  await page.locator('#auth-gate input[autocomplete="name"]').fill('Eleanor Again');
  await page.locator('#auth-gate input[type="email"]').fill(EMAIL);
  await page.locator('#auth-gate input[type="password"]').fill(PASSWORD);
  await page.locator('#auth-gate button:has-text("Create account")').click();
  await page.locator('#auth-gate [data-form-error]').filter({ hasText: 'already has an account' })
    .waitFor({ timeout: 10000 });
  /* Assert — it suggests sign-in and flips the form */
  check('an existing email suggests sign-in', true);
  const flipped = await page.locator('#auth-gate button:has-text("Sign in")').count();
  check('the form flips to sign-in', flipped === 1, `sign-in buttons=${flipped}`);

  /* Act — sign in instead */
  await page.locator('#auth-gate input[type="password"]').fill(PASSWORD);
  await page.locator('#auth-gate button:has-text("Sign in")').click();
  await page.waitForSelector('body.resolved', { timeout: 25000 });
  /* Assert — the second card links to the same account */
  const edge = await record('edge.t');
  const gate = await record('gate.t');
  check('signing in links the second card to the same account',
    edge.activatedBy && edge.activatedBy.uid === gate.activatedBy.uid,
    JSON.stringify(edge.activatedBy));
  await ctx.close();
}

/* Act — a wrong password, then an unknown email */
{
  for (const [label, email, password] of [
    ['wrong password', EMAIL, 'totally-wrong'],
    ['unknown email', 'nobody-here@example.com', PASSWORD]
  ]) {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/est.t`);
    await openEmailForm(page, { signIn: true });
    await page.locator('#auth-gate input[type="email"]').fill(email);
    await page.locator('#auth-gate input[type="password"]').fill(password);
    await page.locator('#auth-gate button:has-text("Sign in")').click();
    await page.locator('#auth-gate [data-form-error]')
      .filter({ hasText: 'wrong, or this email has no account' }).waitFor({ timeout: 10000 });
    /* Assert — one uniform message, and the card does not open */
    check(`${label} shows the uniform message`, true);
    check(`${label} does not open the card`, await page.locator('body.resolved').count() === 0);
    await ctx.close();
  }
}

/* Act — forgot-password: the emulator issues a reset link */
const link = await admin.auth().generatePasswordResetLink(EMAIL);
const oobCode = new URL(link).searchParams.get('oobCode');
check('the emulator issues a reset link with an oobCode', !!oobCode, oobCode);

/* Act — confirm the reset in the browser, then sign in with the new password */
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(async ({ oobCode, NEW_PASSWORD }) => {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js');
    const { getAuth, confirmPasswordReset, connectAuthEmulator } =
      await import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js');
    const { firebaseConfig } = await import('/assets/firebase.js');
    const auth = getAuth(initializeApp(firebaseConfig));
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await confirmPasswordReset(auth, oobCode, NEW_PASSWORD);
  }, { oobCode, NEW_PASSWORD });
  check('the reset code is accepted', true);

  await page.goto(`${BASE}/gate.t`);
  await openEmailForm(page, { signIn: true });
  await page.locator('#auth-gate input[type="email"]').fill(EMAIL);
  await page.locator('#auth-gate input[type="password"]').fill(NEW_PASSWORD);
  await page.locator('#auth-gate button:has-text("Sign in")').click();
  await page.waitForSelector('body.resolved', { timeout: 25000 });
  /* Assert — the card opens, and the link was not rewritten */
  check('the new password opens the card', await page.locator('#auth-gate').count() === 0);
  const rec = await record('gate.t');
  check('the link was not rewritten', rec.activatedBy && rec.activatedBy.at === gateAt1,
    `${rec.activatedBy && rec.activatedBy.at} vs ${gateAt1}`);
  await ctx.close();
}

/* Act — a Google account links est.t first */
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await signInGoogle(page, { identity: 'est-owner' });
  await page.goto(`${BASE}/est.t`);
  await page.waitForSelector('body.resolved', { timeout: 25000 });
  /* Assert — est.t is Google-linked */
  check('a Google account links est.t first',
    (await record('est.t')).activatedBy.provider === 'google.com');
  await ctx.close();

  /* Act — then an email account tries the same card */
  const ctx2 = await newCtx();
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/est.t`);
  await openEmailForm(page2);
  await page2.locator('#auth-gate input[autocomplete="name"]').fill('Email Intruder');
  await page2.locator('#auth-gate input[type="email"]').fill(`intruder-${Date.now().toString(36)}@example.com`);
  await page2.locator('#auth-gate input[type="password"]').fill(PASSWORD);
  await page2.locator('#auth-gate button:has-text("Create account")').click();
  await page2.waitForSelector('#auth-gate[data-state="blocked"]', { timeout: 25000 });
  /* Assert — blocked, the copy names both providers, nothing overwritten */
  check('an email account on a Google-linked card is blocked', true);
  const stuckText = await page2.textContent('#auth-gate');
  check('the stuck copy points at both providers',
    /used Google before/i.test(stuckText) && /used email/i.test(stuckText), stuckText.trim().slice(0, 120));
  check('the link was not overwritten',
    (await record('est.t')).activatedBy.provider === 'google.com');
  await ctx2.close();
}

/* Act — the auth-session helpers drive real sessions too */
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await signInEmail(page, { email: EMAIL, password: NEW_PASSWORD });
  await page.goto(`${BASE}/gate.t`);
  await page.waitForSelector('body.resolved', { timeout: 25000 });
  /* Assert — signInEmail yields a remembered session that opens the card */
  check('signInEmail yields a remembered session that opens the card',
    await page.locator('#auth-gate').count() === 0);
  await ctx.close();

  const ctx2 = await newCtx();
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/`);
  await signUpEmail(page2, {
    email: `fresh-${Date.now().toString(36)}@example.com`,
    password: PASSWORD,
    name: 'Fresh Helper'
  });
  await page2.goto(`${BASE}/fresh.t`);
  await page2.waitForSelector('body.resolved', { timeout: 25000 });
  /* Assert — signUpEmail links a card with the typed name */
  const freshRec = await record('fresh.t');
  check('signUpEmail links a card with the typed name',
    freshRec.activatedBy && freshRec.activatedBy.name === 'Fresh Helper' &&
    freshRec.activatedBy.provider === 'password', JSON.stringify(freshRec.activatedBy));
  await ctx2.close();
}

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — sign-up, sign-in, uniform failures, and reset all hold the link-once model.');
process.exit(bad ? 1 : 0);
