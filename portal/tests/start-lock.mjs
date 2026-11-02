/* The first dose locks a pen.

   Log one dose and the pen's start day is that dose day, its start-day and
   time controls stop rendering, an atelier-set day still wins over a dose,
   and a later band change no longer moves the locked pen's time. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — the harness, and a card with a plain pen and an atelier-set pen */
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

const slug = `lock${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Lock Test',
  pens: [{ template: 'ghk' }, { template: 'bpc', startDate: ago(10) }],
  settings: { startDate: ago(6) } }) });

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);

const open = async () => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartCalendar(); } catch {} });
  await p.waitForTimeout(300);
};

await open();

/* Act — log one dose for the plain pen */
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, ago(3));
await open();

/* Assert — the dosed pen's start day equals the dose day (AC-4) */
const ghk = await p.evaluate(() => {
  const pen = PENS.find(x => x.id === 'ghk');
  return {
    start: penStartIso(pen),
    locked: penLocked(pen),
    dateButton: !!document.querySelector('[data-startday="ghk"]'),
    timeField: !!document.querySelector('[data-pentime="ghk"]'),
    pinnedText: !!document.querySelector('[data-start-locked="ghk"]')
  };
});
check('the dosed pen\'s start day equals the dose day', ghk.start === ago(3), ghk.start);
check('and its start-day and time controls do not render (AC-6)',
      ghk.locked && ghk.pinnedText && !ghk.dateButton && !ghk.timeField, JSON.stringify(ghk));

/* Assert — the atelier-set pen still shows the atelier day, as plain text,
   with an editable time until its first dose (AC-7) */
const bpc0 = await p.evaluate(() => {
  const pen = PENS.find(x => x.id === 'bpc');
  return {
    start: penStartIso(pen),
    locked: penLocked(pen),
    dateButton: !!document.querySelector('[data-startday="bpc"]'),
    timeField: !!document.querySelector('[data-pentime="bpc"]')
  };
});
check('an atelier-set day still wins', bpc0.start === ago(10), bpc0.start);
check('and stays plain text with an editable time until its first dose',
      !bpc0.locked && !bpc0.dateButton && bpc0.timeField, JSON.stringify(bpc0));

/* Act — log a dose for the atelier-set pen too */
await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'bpc', pen: 'BPC-157',
      units: 8, at: new Date().toISOString(), day: d }) });
}, ago(1));
await open();

/* Assert — the atelier day still wins over the dose day */
const bpc1 = await p.evaluate(() => penStartIso(PENS.find(x => x.id === 'bpc')));
check('even after a dose, the atelier day still wins', bpc1 === ago(10), bpc1);

/* Act — a later band change must not move the locked pen's time (AC-5) */
const beforeTime = await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')));
await p.evaluate(() => {
  const mine = loadTimes();
  mine.Evening = '22:00';
  saveTimes(mine);
});
await p.waitForTimeout(300);
const afterTime = await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')));
check('the locked time does not move on a later band change',
      afterTime === beforeTime, `${beforeTime} -> ${afterTime}`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
