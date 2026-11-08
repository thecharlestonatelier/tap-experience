/* The twin-pen semantics and the schedule-sheet note, pinned rather than
   assumed: two pens of one template share one dose-log key (the template,
   not the pen id), so logging one twin's first dose locks BOTH twins'
   chips — documented here as the contract; #chipNote stays hidden until
   the sheet opens and then shows, for both a two-pen and a single-pen
   card; and the pre-start rest block points at the chip / change link,
   never at the removed #btnStart button.

   Playwright, against a file-store service; the cards are named stored
   cards, so the suite signs in first (the gate is part of the flow):
     source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-time-chips-twins.mjs */
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
const slugTwins = `tw${stamp}.t`;    // two pens of one template (ghk#0 / ghk#1)
const slugSingle = `tw${stamp}s.t`;  // one pen, start pinned tomorrow (pre-start)
const pad = n => String(n).padStart(2, '0');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const todayIso = day(0), tomorrowIso = day(1);

/* Arrange — the twin card: two pens of the same template, start pinned today */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: slugTwins, name: 'Twins', startDate: todayIso,
    pens: [{ template: 'ghk' }, { template: 'ghk' }] }) });
/* Arrange — a single-pen card pinned to start tomorrow (pre-start rest block) */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: slugSingle, name: 'One Pen Future', startDate: tomorrowIso,
    pens: [{ template: 'ghk' }] }) });

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

/* Act — open the twin card; the two pens get distinct ids ghk#0 / ghk#1 */
await open(slugTwins);
const ids = await p.evaluate(() => PENS.map(x => x.id).sort().join('|'));
check('the two pens of one template get distinct ids ghk#0 and ghk#1',
  ids === 'ghk#0|ghk#1', ids);

/* Assert — before any dose, neither twin is locked */
check('before any dose neither twin is locked',
  (await p.locator('[data-datechip].locked').count()) === 0 &&
  (await p.locator('[data-timechip].locked').count()) === 0, 'unlocked');

/* Act — log ONE twin's first dose (the card keys the log on the template) */
await p.evaluate(async ({ slug, todayIso }) => {
  await fetch('/api/dose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, at: `${todayIso}T10:00:00`, day: todayIso }) });
  await loadLogged(); renderAll();
}, { slug: slugTwins, todayIso });
await p.waitForTimeout(400);

/* Assert — the shared lock is the documented contract: one dose, two locks.
   The dose log keys on `template` (penKeyOf), so ghk#0 and ghk#1 are the
   same key and their chips lock together. */
check('logging one twin\'s first dose locks both twins\' date chips',
  (await p.locator('[data-datechip="ghk#0"].locked').count()) === 1 &&
  (await p.locator('[data-datechip="ghk#1"].locked').count()) === 1, 'date chips');
check('and both twins\' time chips',
  (await p.locator('[data-timechip="ghk#0"].locked').count()) === 1 &&
  (await p.locator('[data-timechip="ghk#1"].locked').count()) === 1, 'time chips');

/* Act — tap one twin's locked chip: the message names the first dose */
await p.locator('[data-datechip="ghk#0"]').click({ force: true });
await p.waitForTimeout(300);
check('tapping a locked twin chip says why',
  (await p.textContent('#toast')).includes('Locked — your first logged dose.'), await p.textContent('#toast'));

/* --- #chipNote lifecycle (gap 6) --- */

/* Act — the twin card is anchored (start given), so the sheet stays closed
   until asked; #chipNote must be hidden before it opens */
await open(slugTwins);
check('#chipNote is hidden before the sheet opens (two-pen)',
  await p.evaluate(() => { const n = document.getElementById('chipNote'); return !!n && n.hidden; }), 'hidden');
await p.evaluate(() => openStartPicker());
await p.waitForTimeout(300);
check('and visible after it opens (two-pen)',
  await p.evaluate(() => { const n = document.getElementById('chipNote'); return !!n && !n.hidden; }), 'visible');
await p.evaluate(() => closeStartPicker());

/* Act — same lifecycle on a single-pen card */
await open(slugSingle);
check('#chipNote is hidden before the sheet opens (single-pen)',
  await p.evaluate(() => { const n = document.getElementById('chipNote'); return !!n && n.hidden; }), 'hidden');
await p.evaluate(() => openStartPicker());
await p.waitForTimeout(300);
check('and visible after it opens (single-pen)',
  await p.evaluate(() => { const n = document.getElementById('chipNote'); return !!n && !n.hidden; }), 'visible');

/* --- pre-start copy (gap 7, low priority) --- */

/* Assert — the single card starts tomorrow, so today shows the pre-start
   rest block; its copy must not mention the removed button */
const rest = await p.evaluate(() => {
  const title = document.querySelector('.rest .rest-title');
  const sub = document.querySelector('.rest .rest-sub');
  return { title: title ? title.textContent : '', sub: sub ? sub.textContent : '' };
});
check('a card that starts tomorrow shows the pre-start rest block',
  rest.title.startsWith('Begins '), JSON.stringify(rest));
check('the pre-start copy no longer mentions the removed #btnStart / "above"',
  !/above|btnStart/i.test(rest.sub), rest.sub);

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — twins share one lock, the sheet note shows only when open, and the pre-start copy points at the chip.');
process.exit(bad ? 1 : 0);
