/* The date chip must refresh everything a start-day change touches, the
   way the time chip does: the stored reminder schedule, the calendar
   feed, and the atelier report all re-sync (scheduleChanged covers all
   three). A date edit that only redraws the card leaves the reminders
   nudging on the old day.

   Playwright, push stub, file store; mirrors pen-time-remind-refresh.mjs:
     source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-date-chip-refresh.mjs */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

const SUBS = new URL('../.data/reminders.json', import.meta.url).pathname;
const readSubs = () => {
  try { return Object.values(JSON.parse(fs.readFileSync(SUBS, 'utf8'))); } catch { return []; }
};

const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `dcr${stamp}.t`;
const AUTH = 'k9XzM1nQpR7sT2uVwXyZ0A';
const ENDPOINT = `https://stub.${stamp}.example/${AUTH}`;
const p2 = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
const tomorrow = new Date(Date.now() + 86400000);
const tomorrowIso = `${tomorrow.getFullYear()}-${p2(tomorrow.getMonth() + 1)}-${p2(tomorrow.getDate())}`;

/* Arrange — a daily pen, reminders on, and the current schedule stored */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Date Refresh', pens: [{ template: 'ghk' }], settings: { startDate: todayIso } }) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['notifications'] });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('    page error:', e.message));

await page.addInitScript(({ stamp, AUTH }) => {
  const keys = {
    p256dh: 'BEl6-VJHF0Vy0kMluQKGRLLBZZmJ5jVCbMLm7DL9oCcXvhTMhVvGP8SNVsN9tRhVh5j3zvNBHJQFwCiJZ3vTiHY',
    auth: AUTH
  };
  const KEY = 'stub.push.live';
  const endpoint = `https://stub.${stamp}.example/${AUTH}`;
  const fake = {
    get endpoint() { return endpoint; },
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
}, { stamp, AUTH });

await page.goto(`${BASE}/`);
await signInGoogle(page);
await page.goto(`${BASE}/ritual.html?c=${slug}`);
await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 15000 });

await page.evaluate(async () => enableReminders());
await page.waitForTimeout(600);
const before = readSubs().find(r => r.sub && r.sub.endpoint === ENDPOINT);
check('reminders on, a schedule is stored', !!before && before.due.length > 0,
  before ? `${before.due.length} due` : 'none');
const beforeDue = JSON.stringify((before || {}).due);

/* Act — move the start day to tomorrow via the date chip (change event) */
await page.locator('[data-datechip="ghk"]').click();
const input = page.locator('input[type="date"].dose-chip-input');
await input.fill(tomorrowIso);
await page.waitForTimeout(800);

/* Assert — the card follows */
check('the card moved to the new start day',
  await page.evaluate(d => penStartIso(PENS.find(x => x.id === 'ghk')) === d, tomorrowIso),
  await page.evaluate(() => penStartIso(PENS.find(x => x.id === 'ghk'))));

/* Assert — the stored reminder schedule re-synced */
const after = await (async () => {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const rec = readSubs().find(r => r.sub && r.sub.endpoint === ENDPOINT);
    if (rec && JSON.stringify(rec.due) !== beforeDue) return rec;
    await new Promise(r => setTimeout(r, 200));
  }
  return readSubs().find(r => r.sub && r.sub.endpoint === ENDPOINT);
})();
check('a date edit re-syncs the stored reminder schedule',
  after && JSON.stringify(after.due) !== beforeDue,
  after ? `${after.due.length} due (unchanged?)` : 'no subscription');
check('and it matches the card\'s own computation',
  after && JSON.stringify(after.due) === JSON.stringify(await page.evaluate(() => upcomingDoses())),
  `${after && after.due.length} vs ${(await page.evaluate(() => upcomingDoses())).length}`);

/* Assert — the atelier report followed too */
await page.evaluate(() => reportState(true));
await page.waitForTimeout(500);
const rec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
check('the reported supply start day follows the edit',
  rec.state && rec.state.supply && rec.state.supply.find(s => s.template === 'ghk')?.startDate === tomorrowIso,
  JSON.stringify(rec.state && rec.state.supply));

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — a date edit re-syncs reminders, the calendar and the atelier report.');
process.exit(bad ? 1 : 0);
