/* The start day is the day of the first dose, not the day it was planned.

   The atelier hands a pen over on Monday and types Monday. The patient
   gets home, puts the box in the fridge and starts on Thursday. From then
   on every phase boundary, refill date and reminder is three days out,
   and nothing would ever notice — unless the first dose is what counts. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

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

const slug = `first${Date.now().toString(36)}.t`;
const planned = ago(6), actual = ago(3);

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Late Starter', pens: [{ template: 'ghk' }, { template: 'bpc' }],
  settings: { startDate: planned } }) });

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
const open = async () => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartPicker(); } catch {} });
  await p.waitForTimeout(300);
};
const starts = () => p.evaluate(() => Object.fromEntries(PENS.map(x => [x.id, penStartIso(x)])));

await open();
check('before any dose it follows the plan', (await starts()).ghk === planned,
      `${(await starts()).ghk} (planned ${planned})`);

/* --- she injects for the first time three days later --- */
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, actual);

await open();
const after = await starts();
check('the first dose becomes the start day', after.ghk === actual,
      `${after.ghk} (first dose ${actual})`);
check('and the pen she has not started yet still follows the plan',
      after.bpc === planned, after.bpc);

/* --- a later dose must not move it again --- */
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, ago(1));
await open();
check('a later dose does not move it', (await starts()).ghk === actual, (await starts()).ghk);

/* --- a dose back-filled to an EARLIER day does, because it is earlier --- */
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, ago(4));
await open();
check('a dose remembered from an earlier day does move it',
      (await starts()).ghk === ago(4), (await starts()).ghk);

/* --- and a date she types herself wins over the record --- */
await p.evaluate(() => openStartPicker());
await p.waitForTimeout(400);
check('the sheet says which day came from her log',
      /first logged dose/i.test(await p.locator('#startPens').innerText()),
      (await p.locator('#startPens').innerText()).split('\n').join(' | '));

await p.evaluate(d => { document.querySelector('[data-penstart="ghk"]').value = d; }, ago(9));
await p.click('#startSave');
await p.waitForTimeout(800);
check('a date she types is used instead', (await starts()).ghk === ago(9), (await starts()).ghk);

await open();
check('and it is pinned — the log no longer moves it',
      (await starts()).ghk === ago(9), (await starts()).ghk);

/* --- saving the sheet without touching a date must not pin anything --- */
check('the untouched pen was not pinned by that save',
      (await starts()).bpc === planned, (await starts()).bpc);
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'bpc', pen: 'BPC-157',
      units: 8, at: new Date().toISOString(), day: d }) });
}, ago(2));
await open();
check('so its first dose still takes effect', (await starts()).bpc === ago(2), (await starts()).bpc);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
