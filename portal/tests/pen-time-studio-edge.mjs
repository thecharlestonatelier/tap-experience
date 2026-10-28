/* The Studio editor's per-pen time row, pinned at the edges rather than
   assumed: the row pre-fills with the already-saved settings.penTimes
   value; saving with nothing changed leaves the rev alone and the value
   intact; a real change + Save actually bumps the rev; the #pushSettings
   button lands the new value and bumps the rev; and emptying the row
   clears settings.penTimes so the card falls back to the chain (band
   default — ghk is Evening, no first dose is logged here).

   Playwright + HTTP, against a file-store service; the card is a named
   stored card, so the suite signs in first:
     source /tmp/qa-env.sh && BASE=http://localhost:8095 node tests/pen-time-studio-edge.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, the harness, and the date helpers */
const BASE = process.env.BASE || 'http://localhost:8095';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `se${stamp}.t`;
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const getCard = () => fetch(`${BASE}/api/cards/${slug}`, { headers: H }).then(r => r.json());

/* Arrange — a one-pen card whose settings.penTimes is already set, so the
   editor must pre-fill, not start blank */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Studio Edge Test', pens: [{ template: 'ghk' }],
    settings: { startDate: todayIso, penTimes: { ghk: '07:45' } } }) });

/* Arrange — the patient page, signed in, so the clear path's fallback is
   observable on the card itself */
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartPicker(); } catch {} });
check('the atelier pen time wins on the card from the start',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')) === '07:45'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk'))));

/* Arrange — the studio page with the session cookie */
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'ca_studio', value: TOK, url: BASE }]);
const q = await ctx.newPage();
q.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await q.goto(`${BASE}/studio/`);
await q.waitForSelector('#rows tr', { timeout: 15000 });

const openRow = async () => {
  await q.locator(`tr[data-slug="${slug}"]`).first().click();
  await q.waitForSelector('input[data-pentime="ghk"]', { timeout: 8000 });
};

/* --- gap 2: the row pre-fills with the saved value, before any typing --- */
await openRow();
check('gap2: the row pre-fills with the saved settings.penTimes value',
  await q.locator('input[data-pentime="ghk"]').inputValue() === '07:45',
  await q.locator('input[data-pentime="ghk"]').inputValue());

/* --- gap 3: Save with nothing changed must not re-stamp --- */
const rev3 = (await getCard()).settings.rev;
await q.locator('#saveCard').click();
await q.waitForTimeout(1200);
const after3 = await getCard();
check('gap3: save with nothing changed leaves the rev alone',
  Number(after3.settings && after3.settings.rev) === Number(rev3),
  `${rev3} vs ${after3.settings && after3.settings.rev}`);
check('gap3: and the saved value survives the no-op save',
  after3.settings && after3.settings.penTimes && after3.settings.penTimes.ghk === '07:45',
  JSON.stringify(after3.settings && after3.settings.penTimes));

/* --- gap 5: a real change + Save bumps the rev (no force flag) --- */
await openRow();
const rev5 = (await getCard()).settings.rev;
await q.locator('input[data-pentime="ghk"]').fill('22:15');
await q.locator('#saveCard').click();
await q.waitForTimeout(1200);
const after5 = await getCard();
check('gap5: a row change + Save lands the new value',
  after5.settings && after5.settings.penTimes && after5.settings.penTimes.ghk === '22:15',
  JSON.stringify(after5.settings && after5.settings.penTimes));
check('gap5: and bumps the rev without a force flag',
  Number(after5.settings && after5.settings.rev) === Number(rev5) + 1,
  `${rev5} -> ${after5.settings && after5.settings.rev}`);

/* --- gap 4: the force path via the #pushSettings button --- */
await openRow();
const rev4 = (await getCard()).settings.rev;
await q.locator('input[data-pentime="ghk"]').fill('06:30');
await q.locator('#pushSettings').click();
await q.waitForTimeout(1200);
const after4 = await getCard();
check('gap4: the push button lands the new value',
  after4.settings && after4.settings.penTimes && after4.settings.penTimes.ghk === '06:30',
  JSON.stringify(after4.settings && after4.settings.penTimes));
check('gap4: and bumps the rev',
  Number(after4.settings && after4.settings.rev) === Number(rev4) + 1,
  `${rev4} -> ${after4.settings && after4.settings.rev}`);

/* --- gap 1: the emptied-row clear path --- */
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await p.waitForTimeout(800);
check('gap1 arrange: the pushed value reached the card',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')) === '06:30'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk'))));

await openRow();
const rev1 = (await getCard()).settings.rev;
await q.locator('input[data-pentime="ghk"]').fill('');
await q.locator('#saveCard').click();
await q.waitForTimeout(1200);
const after1 = await getCard();
check('gap1: emptying the row removes the penTimes key',
  after1.settings && after1.settings.penTimes && !('ghk' in after1.settings.penTimes),
  JSON.stringify(after1.settings && after1.settings.penTimes));
check('gap1: and bumps the rev',
  Number(after1.settings && after1.settings.rev) === Number(rev1) + 1,
  `${rev1} -> ${after1.settings && after1.settings.rev}`);

await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await p.waitForTimeout(800);
check('gap1: the card falls back to the band default',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')) === '20:00'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk'))));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the editor row pre-fills, no-ops do not re-stamp, changes bump the rev, push forces, and an empty row clears back to the chain.');
process.exit(bad ? 1 : 0);
