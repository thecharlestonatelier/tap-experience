/* Clearing the time chip un-pins her answer: the emptied input removes
   the device value and the chain falls back (band default for a pen with
   no first dose). A clear that silently kept the old time would leave no
   way back to the automatic schedule.

   Playwright, against a file-store service:
     source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-time-chip-clear.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, a daily pen, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `clr${stamp}.t`;
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Clear Test', pens: [{ template: 'ghk' }], settings: { startDate: todayIso } }) });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartPicker(); } catch {} });
await p.waitForTimeout(400);

/* Act — set her own time via the chip */
await p.locator('[data-timechip="ghk"]').click();
await p.locator('input[type="time"].dose-chip-input').fill('19:45');
await p.waitForTimeout(500);
check('the patient time took effect',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')) === '19:45'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk'))));

/* Act — clear the field */
await p.locator('[data-timechip="ghk"]').click();
await p.locator('input[type="time"].dose-chip-input').fill('');
await p.waitForTimeout(500);

/* Assert — the device value is gone and the chain fell back to the band */
check('clearing the chip removes the device value',
  await p.evaluate(() => !(loadPenTimes()['ghk'])),
  JSON.stringify(await p.evaluate(() => loadPenTimes())));
check('and the pen falls back to the band default',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')) === '20:00'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk'))));
check('the chip re-renders the fallback time',
  (await p.evaluate(() => document.querySelector('[data-timechip="ghk"]').textContent)).includes('8:00'),
  await p.evaluate(() => document.querySelector('[data-timechip="ghk"]').textContent));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — clearing the time chip un-pins her answer and the chain falls back.');
process.exit(bad ? 1 : 0);
