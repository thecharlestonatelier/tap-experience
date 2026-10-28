/* The card chips, pinned rather than assumed: each due card renders a
   date chip and a time chip on one row with the treatment name, tapping
   a chip swaps it for a native input that saves on blur, editing one pen
   never moves another, the chips lock after the pen's first logged dose
   with the right message and the pre-lock time still in effect, the old
   "Started … — change" button is gone, and the calendar's ?change=1 link
   still opens the schedule sheet.

   Playwright, against a file-store service; the card is a named stored
   card, so the suite signs in first (the gate is part of the flow):
     source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-time-chips.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, a two-pen card, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `pc${stamp}.t`;
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const yesterday = new Date(Date.now() - 86400000);
const yesterdayIso = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Chips Test', pens: [{ template: 'ghk' }, { template: 'nadvial' }],
    settings: { startDate: todayIso } }) });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 2, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartPicker(); } catch {} });
await p.waitForTimeout(500);

const chipText = sel => p.evaluate(s => {
  const el = document.querySelector(s);
  return el ? el.textContent.trim().replace(/\s+/g, ' ') : null;
}, sel);

/* Assert — each due card renders both chips on the name row (AC-1) */
const ghkRow = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.dose-card')].find(c => c.querySelector('.dose-name')?.textContent === 'GHK-Cu');
  if (!card) return null;
  const row = card.querySelector('.dose-name-row');
  return {
    hasName: !!card.querySelector('.dose-name'),
    hasX: !!card.querySelector('.pen-x'),
    date: !!card.querySelector('[data-datechip]'),
    time: !!card.querySelector('[data-timechip]'),
    order: [...row.children].map(el => el.className.split(' ')[0]).join('|')
  };
});
check('each due card carries a date chip and a time chip (AC-1)',
  ghkRow && ghkRow.hasName && ghkRow.hasX && ghkRow.date && ghkRow.time, JSON.stringify(ghkRow));
check('the chips sit on the same row as the name, before the remove button',
  ghkRow && ghkRow.order.startsWith('dose-name|dose-chip|dose-chip'), ghkRow && ghkRow.order);

/* Act — tap the date chip (AC-2) */
await p.locator('[data-datechip="ghk"]').click();
const dateInput = await p.locator('input[type="date"].dose-chip-input');
check('tapping the date chip opens a native date input (AC-2)',
  await dateInput.count() === 1, `${await dateInput.count()} input(s)`);
check('pre-filled with the pen\'s start day',
  await dateInput.inputValue() === todayIso, await dateInput.inputValue());

/* Act — change the date; the change event commits the edit (AC-4) */
await dateInput.fill(yesterdayIso);
await p.waitForTimeout(500);
check('leaving the field saves the new start day (AC-4)',
  (await chipText('[data-datechip="ghk"]')).includes('Oct 26') || (await chipText('[data-datechip="ghk"]')).includes(yesterdayIso.slice(5)),
  await chipText('[data-datechip="ghk"]'));
check('the other pen\'s date chip is untouched (AC-5)',
  (await p.evaluate(() => penStartIso(PENS.find(x => x.id === 'nadvial')))) === todayIso,
  await p.evaluate(() => penStartIso(PENS.find(x => x.id === 'nadvial'))));

/* Act — tap the time chip (AC-3) */
await p.locator('[data-timechip="ghk"]').click();
const timeInput = await p.locator('input[type="time"].dose-chip-input');
check('tapping the time chip opens a native time input (AC-3)',
  await timeInput.count() === 1, `${await timeInput.count()} input(s)`);
check('pre-filled with the effective time',
  await timeInput.inputValue() === '20:00', await timeInput.inputValue());

/* Act — set 19:45; the change event commits the edit (AC-4) */
await timeInput.fill('19:45');
await p.waitForTimeout(500);
check('leaving the field saves the new time (AC-4)',
  (await chipText('[data-timechip="ghk"]')).includes('7:45'), await chipText('[data-timechip="ghk"]'));
check('the other pen\'s time chip is untouched (AC-5)',
  (await p.evaluate(() => timeFor(PENS.find(x => x.id === 'nadvial')))) === '08:00',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'nadvial'))));

/* Act — log ghk's first dose, then re-render (AC-6) */
await p.evaluate(async ({ slug, todayIso }) => {
  await fetch('/api/dose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, at: `${todayIso}T10:00:00`, day: todayIso }) });
  await loadLogged(); renderAll();
}, { slug, todayIso });
await p.waitForTimeout(400);

/* Assert — ghk's chips lock, with the pre-lock time still shown (AC-6, AC-8) */
check('both chips lock after the first logged dose (AC-6)',
  (await p.locator('[data-datechip="ghk"].locked').count()) === 1 &&
  (await p.locator('[data-timechip="ghk"].locked').count()) === 1,
  'locked chips');
check('the pre-lock time stays in effect after the lock (AC-8)',
  (await chipText('[data-timechip="ghk"]')).includes('7:45'), await chipText('[data-timechip="ghk"]'));
check('the other pen\'s chips stay editable',
  (await p.locator('[data-timechip="nadvial"].locked').count()) === 0, 'nadvial editable');

/* Act — tap a locked chip (AC-6 message); it stays tappable so the
   message can fire, so force the click past aria-disabled */
await p.locator('[data-datechip="ghk"]').click({ force: true });
await p.waitForTimeout(300);
check('tapping a locked chip says why',
  (await p.textContent('#toast')).includes('Locked — your first logged dose.'),
  await p.textContent('#toast'));

/* Assert — the old started-link is gone, nothing throws (AC-10) */
check('the Started — change button is gone (AC-10)',
  await p.evaluate(() => document.getElementById('btnStart') === null), 'btnStart');

/* Act — the calendar's change link still opens the sheet (AC-10) */
await p.goto(`${BASE}/ritual.html?c=${slug}&change=1`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 2, null, { timeout: 15000 });
await p.waitForSelector('#startScrim.open', { timeout: 10000 }).catch(() => {});
check('the ?change=1 link still opens the schedule sheet (AC-10)',
  await p.evaluate(() => !!document.querySelector('#startScrim.open')), 'scrim');
check('the sheet mentions the chip override',
  await p.evaluate(() => { const n = document.getElementById('chipNote'); return n && !n.hidden; }),
  'chipNote');

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — chips render, edit, lock and explain themselves; the sheet still opens.');
process.exit(bad ? 1 : 0);
