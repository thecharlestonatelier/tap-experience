/* Proving test — explorer seat (Phase-2 hunt).
   BUG (silent success after partial failure): an atelier per-pen time
   (settings.penTimes) change is adopted — dashboard and calendar move to the
   new hour — but the reminder schedule kept the old hour, because
   loadProtocol() never called refreshReminders() (only recheckCard() and
   scheduleChanged() do).

   Playwright, push stub, file store:
     source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-time-cold-reminder.mjs */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
const SUBS = new URL('../.data/reminders.json', import.meta.url).pathname;
const readSubs = () => { try { return Object.values(JSON.parse(fs.readFileSync(SUBS, 'utf8'))); } catch { return []; } };
const forSlug = slug => readSubs().filter(r => r.slug === slug);

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `r${stamp}.t`;

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Cold Reminder', pens: [{ template: 'ghk' }],
    settings: { startDate: '2026-10-20' } }) });

const b = await chromium.launch();
const ctx = await b.newContext({ permissions: ['notifications'] });
const p = await ctx.newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });

await p.addInitScript(() => {
  const keys = {
    p256dh: 'BEl6-VJHF0Vy0kMluQKGRLLBZZmJ5jVCbMLm7DL9oCcXvhTMhVvGP8SNVsN9tRhVh5j3zvNBHJQFwCiJZ3vTiHY',
    auth: 'k9XzM1nQpR7sT2uVwXyZ0A'
  };
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

await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 15000 });

await p.evaluate(async () => enableReminders());
await p.waitForTimeout(600);
const before = forSlug(slug);
check('reminders on, a schedule is stored', before.length === 1 && before[0].due.length > 0,
  before.length ? `${before[0].due.length} due` : 'no subscription');
const beforeDue = JSON.stringify((before[0] || {}).due);

await fetch(`${BASE}/api/cards/${slug}`, { method: 'PUT', headers: H,
  body: JSON.stringify({ settings: { startDate: '2026-10-20', penTimes: { ghk: '09:30' }, force: true } }) });

await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 15000 });
await p.evaluate(() => reportState(true));
await p.waitForTimeout(800);

const rec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
const row = (rec.state && rec.state.today || []).find(r => r.template === 'ghk');
check('the atelier time reached the card (state at 09:30)', row && row.at === '09:30',
  row && JSON.stringify(row.at));

const after = forSlug(slug);
const afterDue = JSON.stringify((after[0] || {}).due);
check('the reminder schedule follows the per-pen time change',
  after.length === 1 && afterDue !== beforeDue,
  after.length ? `${(after[0].due || []).length} due (unchanged?)` : 'no subscription');

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the reminder schedule follows the atelier per-pen time.');
process.exit(bad ? 1 : 0);
