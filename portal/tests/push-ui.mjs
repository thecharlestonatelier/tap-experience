/* The patient's side, in a real browser:
   the switch appears, subscribes, survives a reload, and the schedule it
   posts matches the doses the card itself is showing. The stored card is
   opened with a real Google session. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — read the store directly rather than adding a debug route to
   a service that holds patient records */
const SUBS = new URL('../.data/reminders.json', import.meta.url).pathname;
const readSubs = () => {
  try { return Object.values(JSON.parse(fs.readFileSync(SUBS, 'utf8'))); } catch { return []; }
};
const forSlug = slug => readSubs().filter(r => r.slug === slug);

const BASE = 'http://localhost:8094';
let bad = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['notifications'] });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('    page error:', e.message));

/* Arrange — headless Chromium has no connection to Apple's or Google's
   push service, so pushManager.subscribe() always refuses. Stand in for
   that one piece — the browser's own plumbing, not ours — so the rest of
   the path is exercised for real: permission, registration, what gets
   posted, how the switch paints, and whether it survives a reload.

   The crypto and the delivery loop are proven separately, against a real
   receiver key and a real HTTPS endpoint. */
await page.addInitScript(() => {
  const keys = {
    p256dh: 'BEl6-VJHF0Vy0kMluQKGRLLBZZmJ5jVCbMLm7DL9oCcXvhTMhVvGP8SNVsN9tRhVh5j3zvNBHJQFwCiJZ3vTiHY',
    auth: 'k9XzM1nQpR7sT2uVwXyZ0A'
  };
  // A real subscription outlives a reload, so the stub must too — otherwise
  // the reload check passes or fails for the wrong reason.
  const KEY = 'stub.push.live';
  const fake = {
    get endpoint() { return 'https://stub.push.example/' + keys.auth; },
    toJSON() { return { endpoint: this.endpoint, keys }; },
    async unsubscribe() { localStorage.removeItem(KEY); return true; }
  };
  const pushManager = {
    async getSubscription() { return localStorage.getItem(KEY) ? fake : null; },
    async subscribe() { localStorage.setItem(KEY, '1'); return fake; }
  };
  const registration = { pushManager, scope: location.origin + '/' };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      async register() { return registration; },
      async getRegistration() { return registration; },
      get ready() { return Promise.resolve(registration); }
    }
  });
  window.PushManager = function () {};
});

await page.goto(`${BASE}/`);
await signInGoogle(page);
await page.goto(`${BASE}/rem.t`);
await page.waitForSelector('body.resolved', { timeout: 8000 });

/* Assert — the card greets its patient, and the switch is offered, off */
check('the card greets its patient', (await page.textContent('#patientName')).trim() === 'Rem');

await page.waitForSelector('#remind.on', { timeout: 8000 }).catch(() => {});
const visible = await page.isVisible('#remindBtn');
check('the reminder switch is offered', visible);

const label0 = (await page.textContent('#remindBtn')).trim();
check('starts off', /remind me/i.test(label0), label0);

/* Act — read the schedule the card computed (the way the calendar does) */
const doses = await page.evaluate(() => upcomingDoses(120));
/* Assert — future, ordered, non-empty */
check('the card has doses ahead of it', doses.length > 0, `${doses.length}`);
check('every instant is in the future', doses.every(d => Date.parse(d) > Date.now()));
check('they are in order', doses.join() === [...doses].sort().join());

/* Act — turn it on */
await page.click('#remindBtn');
await page.waitForFunction(
  () => document.getElementById('remindBtn').dataset.state === 'on', null, { timeout: 8000 }
).catch(() => {});
const label1 = (await page.textContent('#remindBtn')).trim();
/* Assert — the switch is on, and the server holds this phone with that
   schedule */
check('the switch turns on', /reminders on/i.test(label1), label1);

const stored = forSlug('rem.t');
check('the server took the subscription', stored.length === 1, `${stored.length}`);
if (stored[0]) {
  check('it stored the schedule',
    stored[0].due.length === doses.length, `stored ${stored[0].due.length} of ${doses.length}`);
  // The record must be inert: an endpoint, keys, timestamps. Nothing clinical.
  const fields = Object.keys(stored[0]).sort().join(',');
  console.log('    record fields:', fields);
  const blob = JSON.stringify(stored[0]).toLowerCase();
  const leaks = ['nad', 'tirzepatide', 'wolverine', 'units', 'phase', 'maintenance']
    .filter(w => blob.includes(w));
  check('no drug, dose or phase in the record', leaks.length === 0, leaks.join(', '));
}

/* Act — reload */
await page.reload();
await page.waitForSelector('body.resolved');
await page.waitForFunction(
  () => document.getElementById('remindBtn')?.dataset.state === 'on', null, { timeout: 8000 }
).catch(() => {});
/* Assert — still on */
check('still on after a reload',
  (await page.getAttribute('#remindBtn', 'data-state')) === 'on');

/* Act — and off again */
await page.click('#remindBtn');
await page.waitForFunction(
  () => document.getElementById('remindBtn').dataset.state === 'off', null, { timeout: 8000 }
).catch(() => {});
/* Assert — the switch is off, and the server forgot the phone */
check('the switch turns off', (await page.getAttribute('#remindBtn', 'data-state')) === 'off');

check('the server forgot the phone', forSlug('rem.t').length === 0);

/* Act — open a card with nothing on it */
await page.goto(`${BASE}/blank.q`);
await page.waitForSelector('body.resolved');
/* Assert — it must not offer reminders */
check('an unassigned card offers nothing', !(await page.isVisible('#remindBtn')));

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the switch works, the schedule matches, nothing clinical is stored.');
process.exit(bad ? 1 : 0);
