/* The reminder re-sync after a time change, pinned rather than assumed:
   with reminders on, changing a pen's time re-posts the schedule and the
   server's stored `due` list moves to the new clock time — nothing keeps
   nudging at the old hour. Mirrors push-ui's stub of the browser's push
   plumbing (headless Chromium refuses to subscribe on its own).

   Playwright, against a file-store service; the card is a named stored
   card, so the suite signs in first:
     source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-time-remind-refresh.mjs */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — read the store directly, the way push-ui does */
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
const slug = `prr${stamp}.t`;
const AUTH = 'k9XzM1nQpR7sT2uVwXyZ0A';
const ENDPOINT = `https://stub.${stamp}.example/${AUTH}`;
const p2 = n => String(n).padStart(2, '0');
const hhmm = iso => { const d = new Date(iso); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const today = new Date();
const todayIso = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;

/* Arrange — a one-pen card to subscribe */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Remind Refresh', pens: [{ template: 'ghk' }], settings: { startDate: todayIso } }) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['notifications'] });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('    page error:', e.message));

/* Arrange — stand in for the browser's push plumbing, with a per-run
   endpoint so this suite's record cannot collide with another's. */
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
await page.goto(`${BASE}/${slug}`);
await page.waitForSelector('body.resolved', { timeout: 8000 });

/* Act — turn reminders on */
await page.waitForSelector('#remindBtn', { timeout: 8000 }).catch(() => {});
await page.click('#remindBtn');
await page.waitForFunction(() => document.getElementById('remindBtn')?.dataset.state === 'on', null, { timeout: 8000 }).catch(() => {});

/* Assert — the server holds this phone with the default 20:00 schedule */
const sub0 = await (async () => {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const rec = readSubs().find(r => r.sub && r.sub.endpoint === ENDPOINT);
    if (rec && (rec.due || []).length) return rec;
    await new Promise(r => setTimeout(r, 200));
  }
  return readSubs().find(r => r.sub && r.sub.endpoint === ENDPOINT) || null;
})();
check('the server took the subscription', !!sub0, sub0 ? `${sub0.due.length} due` : 'none');
check('the stored schedule is the default 20:00 local',
  sub0 && sub0.due.length > 0 && sub0.due.every(iso => hhmm(iso) === '20:00'),
  sub0 ? sub0.due.slice(0, 2).map(hhmm).join(', ') : 'none');

/* Act — the patient changes the pen's time to 21:15 */
await page.evaluate(() => { setPenTime(PENS.find(x => x.id === 'ghk'), '21:15'); });

/* Assert — the stored `due` list re-syncs to the new time */
const sub1 = await (async () => {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const rec = readSubs().find(r => r.sub && r.sub.endpoint === ENDPOINT);
    if (rec && (rec.due || []).length && rec.due.every(iso => hhmm(iso) === '21:15')) return rec;
    await new Promise(r => setTimeout(r, 200));
  }
  return readSubs().find(r => r.sub && r.sub.endpoint === ENDPOINT) || null;
})();
check('after a time change the stored due list moves to 21:15',
  sub1 && sub1.due.length > 0 && sub1.due.every(iso => hhmm(iso) === '21:15'),
  sub1 ? sub1.due.slice(0, 2).map(hhmm).join(', ') : 'none');
check('the re-sync keeps the same schedule (same count, new hour)',
  sub0 && sub1 && sub1.due.length === sub0.due.length,
  `${sub0 && sub0.due.length} -> ${sub1 && sub1.due.length}`);

/* Assert — the stored due matches what the card itself now computes */
const pageDue = await page.evaluate(() => upcomingDoses());
check('the stored due list matches the card\'s own computation',
  sub1 && JSON.stringify(sub1.due) === JSON.stringify(pageDue),
  `${sub1 && sub1.due.length} vs ${pageDue.length}`);

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — a time change re-posts the schedule and the reminder due list follows.');
process.exit(bad ? 1 : 0);
