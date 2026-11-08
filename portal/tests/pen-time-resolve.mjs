/* The per-pen time resolution chain, driven from a real card:
   atelier → patient → first logged dose → band default — and the day
   math that must never move while the time changes.

   Playwright, against a file-store service; the card is a named stored
   card, so the suite signs in first (the gate is part of the flow):
     source /tmp/qa-env.sh && BASE=http://localhost:8092 node tests/pen-time-resolve.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, a two-pen card, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8092';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `rt${stamp}.t`;
const today = new Date(); const pad = n => String(n).padStart(2, '0');
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Resolve Test', pens: [{ template: 'ghk' }, { template: 'nadvial' }],
    settings: { startDate: '2026-10-20' } }) });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 2, null, { timeout: 15000 });

const tFor = id => p.evaluate(i => timeFor(PENS.find(x => x.id === i)), id);
const dayMath = () => p.evaluate(() => {
  const out = {};
  PENS.forEach(x => {
    out[x.id] = { dayIndex: dayIndex(today(), x), doses: dosesLeft(x), occurrences: occurrences(x).length, last: supply(x).lastDose };
  });
  return out;
});

/* Act — read the defaults (no atelier, no patient, no dose) */
const dGhk = await tFor('ghk'); const dNad = await tFor('nadvial');
/* Assert — the band default applies */
check('a pen with no answer follows its band default (ghk Evening)',
  dGhk === '20:00', dGhk);
check('and nadvial follows Morning',
  dNad === '08:00', dNad);

/* Arrange — the day math before any time change */
const mathBefore = await dayMath();

/* Act — the patient sets ghk's time */
await p.evaluate(() => { setPenTime(PENS.find(x => x.id === 'ghk'), '19:45'); renderAll(); });
await p.waitForTimeout(400);
/* Assert — ghk follows her, nadvial is untouched */
check('a patient pen time wins over the band default',
  (await tFor('ghk')) === '19:45', await tFor('ghk'));
check('and the other pen keeps its own default',
  (await tFor('nadvial')) === '08:00', await tFor('nadvial'));
/* Assert — a time change alone never moves the day math */
const mathAfterTime = await dayMath();
check('the day math never moves when the time changes',
  JSON.stringify(mathBefore) === JSON.stringify(mathAfterTime),
  `${JSON.stringify(mathBefore).slice(0, 80)} vs ${JSON.stringify(mathAfterTime).slice(0, 80)}`);

/* Act — log each pen's first dose at a known local clock time */
await p.evaluate(async ({ slug, todayIso }) => {
  await fetch('/api/dose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'nadvial', pen: 'NAD+', units: 10,
      at: `${todayIso}T06:30:00`, day: todayIso }) });
  await fetch('/api/dose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10,
      at: `${todayIso}T22:00:00`, day: todayIso }) });
  await loadLogged();
  renderAll();
}, { slug, todayIso });
await p.waitForTimeout(400);
/* Assert — nadvial's first logged dose becomes its time; ghk's own
   patient-set time still beats its first dose */
check('the first logged dose becomes the pen\'s time',
  (await tFor('nadvial')) === '06:30', await tFor('nadvial'));
check('a patient-set time still beats the same pen\'s first dose',
  (await tFor('ghk')) === '19:45', await tFor('ghk'));

/* Act — the atelier pins ghk through settings, rev-bumped */
await fetch(`${BASE}/api/cards/${slug}`, { method: 'PUT', headers: H,
  body: JSON.stringify({ settings: { startDate: '2026-10-20', penTimes: { ghk: '21:30' }, force: true } }) });
await p.evaluate(() => recheckCard());
await p.waitForFunction(() => PENS.length === 2, null, { timeout: 15000 });
await p.waitForTimeout(600);
/* Assert — the atelier value wins over her value and her doses */
check('the atelier pen time wins over the patient\'s',
  (await tFor('ghk')) === '21:30', await tFor('ghk'));
check('and over the first-dose observation on the other pen too',
  (await tFor('nadvial')) === '06:30', await tFor('nadvial'));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — atelier, patient, first dose, then default; the day math stays put.');
process.exit(bad ? 1 : 0);
