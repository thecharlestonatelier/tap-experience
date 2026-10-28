/* The state report's edge cases, pinned rather than assumed:
   a pen that is active but NOT due today (a rest day) still reports its
   resolved clock time with rest:true, and a pen that is spent or dropped
   is absent from the today rows entirely — its time never leaks to the
   dashboard.

   Playwright, against a file-store service; the cards are named stored
   cards, so the suite signs in first (the gate is part of the flow):
     source /tmp/qa-env.sh && BASE=http://localhost:8093 node tests/pen-time-state-edge.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, the harness, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8093';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); };

const mk = (suf, pens, settings) => {
  const slug = `pse${suf}${stamp}.t`;
  return fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
    body: JSON.stringify({ slug, name: `State Edge ${suf}`, pens, settings }) })
    .then(r => r.json()).then(() => slug);
};
const readToday = async slug => {
  const rec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
  return (rec.state && rec.state.today) || [];
};

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);

const open = async (slug, want = 1) => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(n => typeof PENS !== 'undefined' && PENS.length >= n, want, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartPicker(); } catch {} });
  await p.waitForTimeout(300);
};

/* ---------- gap 5: a rest-day pen still reports its time with rest:true ---------- */
/* Arrange — cjcipa is 5-on/2-off; a start five days ago makes today the
   first off day, still well inside its supply. */
const c5 = await mk('5', [{ template: 'cjcipa' }], { startDate: daysAgo(5) });
await open(c5, 1);

/* Assert — the premise: active, but not due today */
const pre5 = await p.evaluate(() => {
  const pen = PENS.find(x => x.id === 'cjcipa');
  return { active: isActive(pen, today()), due: isDue(pen, today()) };
});
check('the rest-day pen is active but not due today', pre5.active === true && pre5.due === false, JSON.stringify(pre5));

/* Act — give it a time and report the state */
await p.evaluate(() => { setPenTime(PENS.find(x => x.id === 'cjcipa'), '19:45'); reportState(true); });
await p.waitForTimeout(800);

/* Assert — the atelier reads the time on a rest day, marked rest */
const rows5 = await readToday(c5);
const row5 = rows5.find(r => r.template === 'cjcipa');
check('a rest-day pen still reports its resolved time',
  row5 && row5.at === '19:45', JSON.stringify(row5));
check('and it is marked rest, not due', row5 && row5.rest === true, JSON.stringify(row5));

/* ---------- gap 6a: a spent pen is absent from today rows ---------- */
/* Arrange — ghk is daily and runs out around day 31; a start 120 days ago
   makes it long spent. Give it a distinctive time to prove none leaks. */
const c6 = await mk('6', [{ template: 'ghk' }], { startDate: daysAgo(120) });
await open(c6, 1);
const pre6 = await p.evaluate(() => isSpent(PENS.find(x => x.id === 'ghk')));
check('the spent pen is recognised spent', pre6 === true, `isSpent ${pre6}`);

/* Act — a patient time that must never reach the dashboard, then report */
await p.evaluate(() => { setPenTime(PENS.find(x => x.id === 'ghk'), '23:59'); reportState(true); });
await p.waitForTimeout(800);

/* Assert — no today row, and its time appears nowhere */
const rows6 = await readToday(c6);
check('a spent pen is absent from the today rows',
  !rows6.some(r => r.template === 'ghk'), JSON.stringify(rows6.map(r => r.template)));
check('its time never leaks to the dashboard',
  !rows6.some(r => r.at === '23:59'), JSON.stringify(rows6.map(r => r.at)));

/* ---------- gap 6b: a dropped pen is absent from today rows ---------- */
/* Arrange — two pens, then the patient takes one off her schedule */
const c7 = await mk('7', [{ template: 'ghk' }, { template: 'nadvial' }], { startDate: daysAgo(0) });
await open(c7, 2);

/* Act — set both times, drop ghk, then report */
await p.evaluate(() => {
  setPenTime(PENS.find(x => x.id === 'ghk'), '21:15');
  setPenTime(PENS.find(x => x.id === 'nadvial'), '06:45');
  removePen(PENS.find(x => x.id === 'ghk'));
  reportState(true);
});
await p.waitForTimeout(800);

/* Assert — the dropped pen's time is gone; the kept pen's is intact */
const rows7 = await readToday(c7);
check('a dropped pen is absent from the today rows',
  !rows7.some(r => r.template === 'ghk'), JSON.stringify(rows7.map(r => r.template)));
check('the kept pen still reports its own time',
  rows7.some(r => r.template === 'nadvial' && r.at === '06:45'), JSON.stringify(rows7));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — a rest day still reports its time, and a spent or dropped pen never leaks one.');
process.exit(bad ? 1 : 0);
