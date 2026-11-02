/* AC-5 + AC-7 locking: a per-pen time set BEFORE the first dose survives
   the lock snapshot, and an atelier-set pen with an editable time loses
   that field once its first dose lands. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

const BASE = process.env.BASE || 'http://localhost:8095';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};
const pad = n => String(n).padStart(2, '0');
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const slug = `snap${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Lock Snapshot', pens: [{ template: 'ghk' }, { template: 'bpc', startDate: ago(10) }],
  settings: { startDate: ago(6) } }) });

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
let pageErrors = 0;
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; pageErrors++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);

const open = async () => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartCalendar(); } catch {} });
  await p.waitForTimeout(300);
};

await open();

check('the atelier pen has an editable time before its dose',
      await p.locator('[data-pentime="bpc"]').count() > 0,
      `${await p.locator('[data-pentime="bpc"]').count()} field(s)`);

await p.evaluate(() => setPenTime(PENS.find(x => x.id === 'ghk'), '07:30'));

await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, ago(3));
await open();

const ghkTime = await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')));
check('the pre-dose override survives the lock snapshot',
      ghkTime === '07:30', `${ghkTime} (band default would be 20:00)`);

await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'bpc', pen: 'BPC-157',
      units: 8, at: new Date().toISOString(), day: d }) });
}, ago(1));
await open();

const bpc = await p.evaluate(() => ({
  timeField: !!document.querySelector('[data-pentime="bpc"]'),
  locked: !!document.querySelector('[data-time-locked="bpc"]'),
  start: penStartIso(PENS.find(x => x.id === 'bpc'))
}));
check('the atelier pen loses its editable time once dosed',
      !bpc.timeField && bpc.locked, JSON.stringify(bpc));
check('and its atelier day still wins over the dose day',
      bpc.start === ago(10), bpc.start);

check('no page errors', pageErrors === 0, `${pageErrors} error(s)`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
