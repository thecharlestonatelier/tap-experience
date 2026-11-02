/* Each pen carries its own clock time.

   Two Evening pens can sit at different hours, and the state the card
   reports to the atelier carries each pen's own time rather than one band
   time for both. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — the harness, and a two-Evening-pen card */
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

const slug = `times${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Two Evenings', pens: [{ template: 'ghk' }, { template: 'bpc' }],
  settings: { startDate: ago(6) } }) });

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartCalendar(); } catch {} });

/* Act — before any override, both read the band's default */
const before = await p.evaluate(() => ({
  ghk: timeFor(PENS.find(x => x.id === 'ghk')),
  bpc: timeFor(PENS.find(x => x.id === 'bpc'))
}));
check('both Evening pens begin on the band default',
      before.ghk === before.bpc, JSON.stringify(before));

/* Act — set each pen its own time, and redraw */
await p.evaluate(() => {
  setPenTime(PENS.find(x => x.id === 'ghk'), '07:30');
  setPenTime(PENS.find(x => x.id === 'bpc'), '21:45');
  renderAll();
});
await p.waitForTimeout(300);

/* Assert — each pen reads its own value (AC-2) */
const after = await p.evaluate(() => ({
  ghk: timeFor(PENS.find(x => x.id === 'ghk')),
  bpc: timeFor(PENS.find(x => x.id === 'bpc'))
}));
check('two Evening pens carry different times',
      after.ghk === '07:30' && after.bpc === '21:45', JSON.stringify(after));

/* Assert — the state report carries each pen's own time (AC-3) */
const report = await p.evaluate(() => stateReport());
const byTemplate = Object.fromEntries(report.today.map(e => [e.template, e.at]));
check('the report carries each pen\'s own time',
      byTemplate.ghk === '07:30' && byTemplate.bpc === '21:45', JSON.stringify(byTemplate));

/* Assert — the card's time fields show each pen's own value */
const fields = await p.evaluate(() => ({
  ghk: document.querySelector('[data-pentime="ghk"]')?.value,
  bpc: document.querySelector('[data-pentime="bpc"]')?.value
}));
check('the card shows each pen\'s own time field',
      fields.ghk === '07:30' && fields.bpc === '21:45', JSON.stringify(fields));

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
