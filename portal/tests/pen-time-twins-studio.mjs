/* A studio-set per-pen time on a twin card must land on the phone's own
   pen ids (ghk#0/ghk#1), not the bare template key — the editor rows and
   the phone's timeFor must agree, or the save toasts success while the
   patient never gets the time.

   Playwright, against a file-store service; the card is a named stored
   card, so the suite signs in first:
     source /tmp/qa-env.sh && BASE=http://localhost:8095 node tests/pen-time-twins-studio.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, a twin card, and the date helper */
const BASE = process.env.BASE || 'http://localhost:8095';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `tw${stamp}.t`;

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Twins Studio', startDate: '2026-10-20',
    pens: [{ template: 'ghk' }, { template: 'ghk' }] }) });

const b = await chromium.launch();

/* Arrange — the phone side: twins resolve to ghk#0 / ghk#1 */
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 2, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartPicker(); } catch {} });

/* Arrange — the studio side: open the editor (with the session cookie) */
const sctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await sctx.addCookies([{ name: 'ca_studio', value: TOK, url: BASE }]);
const q = await sctx.newPage();
q.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await q.goto(`${BASE}/studio/`);
await q.waitForSelector('#rows tr', { timeout: 15000 });
await q.locator(`tr[data-slug="${slug}"]`).first().click();
await q.waitForSelector('input[data-pentime]', { timeout: 8000 });

/* Assert — each twin gets its own row, keyed like the phone's ids */
check('each twin renders its own per-pen row',
  (await q.locator('input[data-pentime="ghk#0"]').count()) === 1 &&
  (await q.locator('input[data-pentime="ghk#1"]').count()) === 1,
  'rows');

/* Act — set each twin's time and save */
await q.locator('input[data-pentime="ghk#0"]').fill('22:15');
await q.locator('input[data-pentime="ghk#1"]').fill('06:30');
await q.locator('#saveCard').click();
await q.waitForTimeout(1200);

const rec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
check('the studio save lands both per-pen times',
  rec.settings && rec.settings.penTimes &&
  rec.settings.penTimes['ghk#0'] === '22:15' && rec.settings.penTimes['ghk#1'] === '06:30',
  JSON.stringify(rec.settings && rec.settings.penTimes));

/* Assert — the phone adopts each twin's own time */
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await p.waitForTimeout(800);
check('ghk#0 adopts its own per-pen time',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk#0')) === '22:15'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk#0'))));
check('ghk#1 adopts its own per-pen time',
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk#1')) === '06:30'),
  await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk#1'))));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — a studio per-pen time on a twin card lands on each twin\'s own id.');
process.exit(bad ? 1 : 0);
