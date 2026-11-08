/* The atelier side of the per-pen time, pinned rather than assumed:
   a settings.penTimes override reaches a LOCKED pen on the next open and
   wins over her time and her doses, the chip stays locked while showing
   the atelier value, a forced save with an unchanged value still bumps
   the rev, the state report carries the effective time in today rows and
   never in supply rows, the Studio editor has a per-pen time row that
   saves into settings.penTimes, and /api/overview stays free of times
   and settings.

   Playwright + HTTP, against a file-store service; the card is a named
   stored card, so the suite signs in first (the gate is part of the
   flow):
     source /tmp/qa-env.sh && AGENT_TOKEN=test-agent-token-xyz \
       BASE=http://localhost:8095 node tests/pen-time-atelier.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, the harness, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8095';
const AGENT = process.env.AGENT_TOKEN || 'test-agent-token-xyz';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
const A = { Authorization: `Bearer ${AGENT}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `pa${stamp}.t`;
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const putSettings = body => fetch(`${BASE}/api/cards/${slug}`, { method: 'PUT', headers: H, body: JSON.stringify({ settings: body }) });
const getCard = () => fetch(`${BASE}/api/cards/${slug}`, { headers: H }).then(r => r.json());

/* Arrange — a one-pen card, signed in, opened, and its first dose logged */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Atelier Test', pens: [{ template: 'ghk' }], settings: { startDate: todayIso } }) });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartPicker(); } catch {} });

await p.evaluate(async ({ slug, todayIso }) => {
  await fetch('/api/dose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, at: `${todayIso}T10:00:00`, day: todayIso }) });
  await loadLogged(); renderAll();
}, { slug, todayIso });
await p.waitForTimeout(400);
check('the pen is locked before the override',
  (await p.locator('[data-timechip="ghk"].locked').count()) === 1, 'locked');

/* Act — the atelier pins a per-pen time over the locked pen */
const over = await putSettings({ startDate: todayIso, penTimes: { ghk: '21:30' } });
const overRec = await over.json();
check('the override bumps the settings rev',
  Number(overRec.settings && overRec.settings.rev) === 2, JSON.stringify(overRec.settings && overRec.settings.rev));

await p.evaluate(() => recheckCard());
await p.waitForFunction(() => PENS.length === 1, null, { timeout: 15000 });
await p.waitForTimeout(600);

/* Assert — the atelier value wins over the lock, and the chip stays locked */
check('the atelier time wins over a locked pen',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')) === '21:30'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk'))));
/* Act — the real redraw path: the page returns to the front */
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await p.waitForTimeout(800);
check('and the chip stays locked while showing it',
  (await p.locator('[data-timechip="ghk"].locked').count()) === 1 &&
  (await p.evaluate(() => document.querySelector('[data-timechip="ghk"]').textContent)).includes('9:30'),
  await p.evaluate(() => document.querySelector('[data-timechip="ghk"]').textContent));

/* Act — a forced save of the same value still raises the rev (FR-16) */
const forced = await putSettings({ startDate: todayIso, penTimes: { ghk: '21:30' }, force: true });
const forcedRec = await forced.json();
check('a forced save of an unchanged value bumps the rev',
  Number(forcedRec.settings && forcedRec.settings.rev) === 3,
  JSON.stringify(forcedRec.settings && forcedRec.settings.rev));

/* Act — the state report, and the dashboard's copy of it */
await p.evaluate(() => reportState(true));
await p.waitForTimeout(800);
const rec = await getCard();
const row = (rec.state && rec.state.today || []).find(r => r.template === 'ghk');
const sup = (rec.state && rec.state.supply || []).find(r => r.template === 'ghk');
check('the today row reports the effective time',
  row && row.at === '21:30', row && JSON.stringify(row.at));
check('the supply row stays day-only',
  sup && !('at' in sup) && !('time' in sup), JSON.stringify(Object.keys(sup || {})));

/* Act — the read-only overview */
const ov = await (await fetch(`${BASE}/api/overview`, { headers: A })).json();
const blob = JSON.stringify(ov);
/* Assert — no times or settings ride it (FR-21, AC-13) */
check('the overview carries no times, settings or penTimes',
  !/"(times|settings|penTimes|at)"/.test(blob), blob.slice(0, 120));

/* --- the Studio editor's per-pen row --- */

/* Arrange — the studio page with the session cookie */
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'ca_studio', value: TOK, url: BASE }]);
const q = await ctx.newPage();
q.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await q.goto(`${BASE}/studio/`);
await q.waitForSelector('#rows tr', { timeout: 15000 });

/* Act — open the card's editor and find the per-pen row */
await q.locator(`tr[data-slug="${slug}"]`).first().click();
await q.waitForSelector('input[data-pentime="ghk"]', { timeout: 8000 });
check('the Studio editor shows a per-pen time row',
  await q.locator('input[data-pentime="ghk"]').count() === 1, 'row');

/* Act — set 22:15 and save */
await q.locator('input[data-pentime="ghk"]').fill('22:15');
await q.locator('#saveCard').click();
await q.waitForTimeout(1200);

/* Assert — it landed in settings.penTimes and reaches the card */
const after = await getCard();
check('the Studio row saves into settings.penTimes',
  after.settings && after.settings.penTimes && after.settings.penTimes.ghk === '22:15',
  JSON.stringify(after.settings && after.settings.penTimes));
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await p.waitForTimeout(800);
check('and the card adopts it on the next open',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk')) === '22:15'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk'))));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the atelier override beats the lock, the editor carries the row, and the overview stays time-free.');
process.exit(bad ? 1 : 0);
