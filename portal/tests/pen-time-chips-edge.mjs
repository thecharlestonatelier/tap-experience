/* The edge cases of the pen-time chips, pinned rather than assumed:
   an atelier-pinned date (pen.atelierStart) and an atelier-pinned time
   (settings.penTimes) read as .atelier chips with a ★ glyph and
   aria-disabled that toast "Set by the atelier." without opening an input;
   a single-pen card still renders both chips, prefills its date input, and
   its ?change=1 sheet (the single=true path) unhides #chipNote; the
   save-on-blur code path commits with no change event; and tapping the
   time chip while the date input is open commits the date and leaves
   exactly one input.

   Playwright, against a file-store service; the cards are named stored
   cards, so the suite signs in first (the gate is part of the flow):
     source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-time-chips-edge.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, two cards, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slugPinned = `pe${stamp}.t`;     // atelier-pinned date + time
const slugSingle = `pe${stamp}s.t`;    // one plain pen
const pad = n => String(n).padStart(2, '0');
const ago = n => { const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const todayIso = ago(0), yesterdayIso = ago(1), priorIso = ago(2);

/* Arrange — the atelier-pinned card: a pen whose record startDate pins the
   date chip, and a settings.penTimes entry that pins the time chip */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: slugPinned, name: 'Pinned Chips', pens: [{ template: 'ghk', startDate: todayIso }],
    settings: { startDate: todayIso, penTimes: { ghk: '19:30' } } }) });
/* Arrange — a plain single-pen card, anchored so the sheet does not auto-open */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: slugSingle, name: 'One Pen', pens: [{ template: 'ghk' }],
    settings: { startDate: todayIso } }) });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);

const open = async (slug) => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartPicker(); } catch {} });
  await p.waitForTimeout(400);
};

const chipText = sel => p.evaluate(s => {
  const el = document.querySelector(s);
  return el ? el.textContent.trim().replace(/\s+/g, ' ') : null;
}, sel);
const chipState = sel => p.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const lock = el.querySelector('.lock');
  return { cls: el.className, nativeDisabled: el.disabled,
           ariaDisabled: el.getAttribute('aria-disabled'),
           title: el.getAttribute('title'), glyph: lock ? lock.textContent : null };
}, sel);

/* Act — open the atelier-pinned card */
await open(slugPinned);

/* Assert — the atelier-pinned date chip reads as pinned, not editable */
const d = await chipState('[data-datechip="ghk"]');
check('the atelier date chip carries the .atelier class', d && /\batelier\b/.test(d.cls), d && d.cls);
check('the atelier date chip shows a ★ glyph, not a lock', d && d.glyph === '\u2605', JSON.stringify(d && d.glyph));
check('the atelier date chip stays a real button, never marked disabled',
  d && d.nativeDisabled === false && !d.ariaDisabled, JSON.stringify({ n: d && d.nativeDisabled, a: d && d.ariaDisabled }));
check('the atelier date chip title says "Set by the atelier."', d && d.title === 'Set by the atelier.', d && d.title);

/* Assert — the atelier-pinned time chip reads as pinned too */
const t = await chipState('[data-timechip="ghk"]');
check('the atelier time chip carries the .atelier class', t && /\batelier\b/.test(t.cls), t && t.cls);
check('the atelier time chip shows a ★ glyph', t && t.glyph === '\u2605', JSON.stringify(t && t.glyph));
check('the atelier time chip stays a real button, never marked disabled',
  t && t.nativeDisabled === false && !t.ariaDisabled, JSON.stringify({ n: t && t.nativeDisabled, a: t && t.ariaDisabled }));
check('the atelier time chip shows the atelier time 7:30 pm',
  (await chipText('[data-timechip="ghk"]')).includes('7:30'), await chipText('[data-timechip="ghk"]'));

/* Act — tap the atelier date chip (forced past aria-disabled) */
await p.locator('[data-datechip="ghk"]').click({ force: true });
await p.waitForTimeout(300);
check('tapping the atelier date chip toasts "Set by the atelier."',
  (await p.textContent('#toast')).includes('Set by the atelier.'), await p.textContent('#toast'));
check('and opens no input', await p.locator('input.dose-chip-input').count() === 0,
  `${await p.locator('input.dose-chip-input').count()} input(s)`);

/* Act — tap the atelier time chip */
await p.locator('[data-timechip="ghk"]').click({ force: true });
await p.waitForTimeout(300);
check('tapping the atelier time chip toasts "Set by the atelier."',
  (await p.textContent('#toast')).includes('Set by the atelier.'), await p.textContent('#toast'));
check('and opens no input', await p.locator('input.dose-chip-input').count() === 0,
  `${await p.locator('input.dose-chip-input').count()} input(s)`);

/* Act — open the single-pen card */
await open(slugSingle);

/* Assert — the single-pen card still renders both chips */
check('a single-pen card renders a date chip and a time chip',
  (await p.locator('[data-datechip="ghk"]').count()) === 1 &&
  (await p.locator('[data-timechip="ghk"]').count()) === 1, 'chips');

/* Act — tap the date chip */
await p.locator('[data-datechip="ghk"]').click();
check('the date input prefills with the start day',
  (await p.locator('input[type="date"].dose-chip-input').inputValue()) === todayIso,
  await p.locator('input[type="date"].dose-chip-input').inputValue());

/* Act — the calendar's change link on a single pen: the single=true path */
await p.goto(`${BASE}/ritual.html?c=${slugSingle}&change=1`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
await p.waitForSelector('#startScrim.open', { timeout: 10000 }).catch(() => {});
check('the ?change=1 sheet opens on a single pen',
  await p.evaluate(() => !!document.querySelector('#startScrim.open')), 'scrim');
check('the single-pen sheet also unhides #chipNote',
  await p.evaluate(() => { const n = document.getElementById('chipNote'); return n && !n.hidden; }), 'chipNote');

/* Act — the save-on-blur path in isolation: back on the plain card */
await open(slugSingle);
await p.locator('[data-datechip="ghk"]').click();
/* set the value directly — no change event fires */
await p.evaluate(d => { document.querySelector('input.dose-chip-input[type="date"]').value = d; }, yesterdayIso);
/* Act — a blur with no change event: only the blur listener can commit */
await p.evaluate(() => document.querySelector('input.dose-chip-input[type="date"]').dispatchEvent(new Event('blur')));
await p.waitForTimeout(400);
check('the blur listener alone commits the edit (no change event)',
  (await p.evaluate(() => penStartIso(PENS.find(x => x.id === 'ghk')))) === yesterdayIso,
  await p.evaluate(() => penStartIso(PENS.find(x => x.id === 'ghk'))));

/* Act — two inputs at once: open the date chip, set a day with no change
   event, then tap the time chip while the date input is still open */
await p.locator('[data-datechip="ghk"]').click();
await p.evaluate(d => { document.querySelector('input.dose-chip-input[type="date"]').value = d; }, priorIso);
await p.locator('[data-timechip="ghk"]').click();
await p.waitForTimeout(400);

/* Assert — the first edit committed, and exactly one input remains (the time) */
const inputs = await p.evaluate(() => ({
  n: document.querySelectorAll('.dose-chip-input').length,
  time: document.querySelectorAll('input[type="time"].dose-chip-input').length,
  date: document.querySelectorAll('input[type="date"].dose-chip-input').length
}));
check('tapping the time chip while the date input is open leaves exactly one input',
  inputs.n === 1, JSON.stringify(inputs));
check('the remaining input is the time input', inputs.time === 1 && inputs.date === 0, JSON.stringify(inputs));
check('the date edit committed',
  (await p.evaluate(() => penStartIso(PENS.find(x => x.id === 'ghk')))) === priorIso,
  await p.evaluate(() => penStartIso(PENS.find(x => x.id === 'ghk'))));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — pinned chips read as pinned, the single pen keeps its chips and sheet, blur alone saves, and one input opens at a time.');
process.exit(bad ? 1 : 0);
