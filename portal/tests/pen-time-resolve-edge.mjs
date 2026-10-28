/* The resolution chain's edges, driven from a real card:
   the atelier value beats a pen whose only answer is its first logged
   dose, a removed atelier entry falls back instead of staying stale, the
   band default follows settings.times, and two pens of one template keep
   their per-pen patient times apart.

   Playwright, against a file-store service; the cards are named stored
   cards, so the suite signs in first (the gate is part of the flow):
     source /tmp/qa-env.sh && BASE=http://localhost:8092 node tests/pen-time-resolve-edge.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, the harness, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8092';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const mkCard = (suf, pens, settings) => fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: `re${suf}${stamp}.t`, name: `Resolve Edge ${suf}`, pens, settings }) });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);

const tFor = id => p.evaluate(i => timeFor(PENS.find(x => x.id === i)), id);
const openCard = async (slug, want = 1) => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(n => typeof PENS !== 'undefined' && PENS.length >= n, want, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartPicker(); } catch {} });
  await p.waitForTimeout(300);
};
const putSettings = (slug, settings) => fetch(`${BASE}/api/cards/${slug}`, { method: 'PUT', headers: H,
  body: JSON.stringify({ settings }) });

/* --- gap 6: the atelier value beats a pen that has ONLY a first dose --- */
const c6 = `re6${stamp}.t`;
await mkCard('6', [{ template: 'ghk' }], { startDate: '2026-10-20' });
await openCard(c6);
check('gap6: with no answer a pen follows its band default',
  (await tFor('ghk')) === '20:00', await tFor('ghk'));

/* Act — log its first dose at a known local clock time */
await p.evaluate(async ({ slug, todayIso }) => {
  await fetch('/api/dose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, at: `${todayIso}T06:30:00`, day: todayIso }) });
  await loadLogged(); renderAll();
}, { slug: c6, todayIso });
await p.waitForTimeout(400);
/* Assert — the first dose is the only answer so far */
check('gap6: the first logged dose becomes its only answer',
  (await tFor('ghk')) === '06:30', await tFor('ghk'));

/* Act — the atelier pins a time, isolated from any patient value */
await putSettings(c6, { startDate: '2026-10-20', penTimes: { ghk: '21:30' }, force: true });
await p.evaluate(() => recheckCard());
await p.waitForTimeout(600);
/* Assert — the atelier value wins over the first-dose observation */
check('gap6: the atelier value beats a first-dose-only pen',
  (await tFor('ghk')) === '21:30', await tFor('ghk'));

/* --- gap 7: a removed atelier entry must not outlive its removal --- */
const c7 = `re7${stamp}.t`;
await mkCard('7', [{ template: 'ghk' }], { startDate: '2026-10-20' });
await putSettings(c7, { startDate: '2026-10-20', penTimes: { ghk: '21:30' }, force: true });
await openCard(c7);
check('gap7: the atelier value applies',
  (await tFor('ghk')) === '21:30', await tFor('ghk'));

/* Act — remove it with a higher rev */
await putSettings(c7, { startDate: '2026-10-20', penTimes: {}, force: true });
await p.evaluate(() => recheckCard());
await p.waitForTimeout(600);
/* Assert — the pen must fall back to the band default, not stay stale */
check('gap7: removing the atelier entry falls back, not stale',
  (await tFor('ghk')) === '20:00', await tFor('ghk'));

/* --- gap 8: the band-default leg follows settings.times --- */
const c8 = `re8${stamp}.t`;
await mkCard('8', [{ template: 'ghk' }], { startDate: '2026-10-20' });
await openCard(c8);
check('gap8: before any override TIME_AT applies',
  (await tFor('ghk')) === '20:00', await tFor('ghk'));

/* Act — the atelier moves the band time */
await putSettings(c8, { startDate: '2026-10-20', times: { Evening: '21:00' }, force: true });
await p.evaluate(() => recheckCard());
await p.waitForTimeout(600);
/* Assert — a pen with no pen-level value follows settings.times, not TIME_AT */
check('gap8: a pen follows settings.times over TIME_AT',
  (await tFor('ghk')) === '21:00', await tFor('ghk'));

/* --- gap 9: two pens of one template keep their patient times apart --- */
const c9 = `re9${stamp}.t`;
await mkCard('9', [{ template: 'ghk' }, { template: 'ghk' }], { startDate: '2026-10-20' });
await openCard(c9, 2);
const ids = await p.evaluate(() => PENS.map(x => x.id));
check('gap9: two same-template pens get distinct ids',
  ids.length === 2 && ids[0] === 'ghk#0' && ids[1] === 'ghk#1', JSON.stringify(ids));
check('gap9: both start on the band default',
  (await tFor('ghk#0')) === '20:00' && (await tFor('ghk#1')) === '20:00',
  `${await tFor('ghk#0')} / ${await tFor('ghk#1')}`);

/* Act — the patient sets a time on one twin */
await p.evaluate(() => { setPenTime(PENS.find(x => x.id === 'ghk#0'), '19:45'); renderAll(); });
await p.waitForTimeout(400);
/* Assert — the other twin is untouched; both still resolve sanely */
check('gap9: a patient time on one twin does not move the other',
  (await tFor('ghk#0')) === '19:45' && (await tFor('ghk#1')) === '20:00',
  `${await tFor('ghk#0')} / ${await tFor('ghk#1')}`);

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — atelier-over-first-dose, removal falls back, band default, and twin isolation all hold.');
process.exit(bad ? 1 : 0);
