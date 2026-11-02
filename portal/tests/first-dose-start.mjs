/* The start day is the day of the first dose, not the day it was planned.

   The atelier hands a pen over on Monday and types Monday. The patient
   gets home, puts the box in the fridge and starts on Thursday. From then
   on every phase boundary, refill date and reminder is three days out,
   and nothing would ever notice — unless the first dose is what counts. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — the harness, and a card planned six days ago */
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
/* Sign in first — the card is named, and the gate is part of the flow. */
await p.goto(`${BASE}/`);
await signInGoogle(p);
const open = async () => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartCalendar(); } catch {} });
  await p.waitForTimeout(300);
};
const starts = () => p.evaluate(() => Object.fromEntries(PENS.map(x => [x.id, penStartIso(x)])));

/* Act — open the card before any dose */
await open();
/* Assert — both pens follow the plan */
check('before any dose it follows the plan', (await starts()).ghk === planned,
      `${(await starts()).ghk} (planned ${planned})`);

/* Act — she injects for the first time three days late */
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, actual);

await open();
const after = await starts();
/* Assert — the dosed pen moved to the dose day; the untouched one follows
   the plan */
check('the first dose becomes the start day', after.ghk === actual,
      `${after.ghk} (first dose ${actual})`);
check('and the pen she has not started yet still follows the plan',
      after.bpc === planned, after.bpc);

/* Act — a later dose */
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, ago(1));
await open();
/* Assert — it must not move the start again */
check('a later dose does not move it', (await starts()).ghk === actual, (await starts()).ghk);

/* Act — a dose back-filled to an EARLIER day */
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, ago(4));
await open();
/* Assert — the earlier day wins, because it is earlier */
check('a dose remembered from an earlier day does move it',
      (await starts()).ghk === ago(4), (await starts()).ghk);

/* Act — after the dose, the pen is locked: no editable start control */
const lock = await p.evaluate(() => {
  const pen = PENS.find(x => x.id === 'ghk');
  return {
    locked: penLocked(pen),
    editable: !!document.querySelector('[data-startday="ghk"]'),
    pinnedText: !!document.querySelector('[data-start-locked="ghk"]')
  };
});
/* Assert — the day renders as plain text, not a button */
check('a dosed pen shows no editable start control',
      lock.locked && lock.pinnedText && !lock.editable, JSON.stringify(lock));

/* Act — she tries to type a day anyway. The engine would accept the write,
   but the first dose wins the moment the card applies its starts. */
await p.evaluate(d => setPenStart(PENS.find(x => x.id === 'ghk'), d), ago(9));
await open();
/* Assert — the first dose still wins; a typed day no longer applies */
check('a typed day no longer applies — the first dose wins',
      (await starts()).ghk === ago(4), (await starts()).ghk);

await open();
check('and it stays locked — the log still owns the day',
      (await starts()).ghk === ago(4), (await starts()).ghk);

/* Act — the other pen has no dose, so it is still editable, and its first
   dose (when it comes) still takes effect */
check('the untouched pen still follows the plan',
      (await starts()).bpc === planned, (await starts()).bpc);
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'bpc', pen: 'BPC-157',
      units: 8, at: new Date().toISOString(), day: d }) });
}, ago(2));
await open();
/* Assert — its first dose still takes effect */
check('so its first dose still takes effect', (await starts()).bpc === ago(2), (await starts()).bpc);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
