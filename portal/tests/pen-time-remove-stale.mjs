/* Removing a pen in the editor must take its per-pen time row with it, so
   the pen's settings.penTimes key clears on save instead of surviving as
   an orphan that would silently reappear if the pen is re-prescribed.

   Playwright, against a file-store service; the studio session cookie
   covers the dashboard side:
     source /tmp/qa-env.sh && BASE=http://localhost:8095 node tests/pen-time-remove-stale.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8095';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `rm${stamp}.t`;

/* Arrange — a two-pen card with a per-pen time on each */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Remove Probe', startDate: '2026-10-20',
    pens: [{ template: 'ghk' }, { template: 'tirz' }],
    settings: { penTimes: { ghk: '21:00', tirz: '08:00' } } }) });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'ca_studio', value: TOK, url: BASE }]);
const q = await ctx.newPage();
q.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
q.on('dialog', d => d.accept());          // accept the remove confirmation
await q.goto(`${BASE}/studio/`);
await q.waitForSelector('#rows tr', { timeout: 15000 });
await q.locator(`tr[data-slug="${slug}"]`).first().click();
await q.waitForSelector('#penList [data-drop]', { timeout: 8000 });

/* Act — remove tirz (the second pen) and save */
await q.locator('#penList [data-drop="1"]').click();
await q.waitForTimeout(400);
check('the removed pen\'s time row is gone with it',
  (await q.locator('input[data-pentime="tirz"]').count()) === 0, 'row');
await q.locator('#saveCard').click();
await q.waitForTimeout(1200);

const rec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
check('tirz is gone from pens', !(rec.pens || []).some(p => p.template === 'tirz'),
  JSON.stringify(rec.pens));
/* Assert — the removed pen's penTimes key cleared with it */
check('removing a pen clears its penTimes key',
  !((rec.settings && rec.settings.penTimes && 'tirz' in rec.settings.penTimes)),
  JSON.stringify(rec.settings && rec.settings.penTimes));
check('and the kept pen\'s time survives',
  rec.settings && rec.settings.penTimes && rec.settings.penTimes.ghk === '21:00',
  JSON.stringify(rec.settings && rec.settings.penTimes));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — removing a pen clears its per-pen time.');
process.exit(bad ? 1 : 0);
