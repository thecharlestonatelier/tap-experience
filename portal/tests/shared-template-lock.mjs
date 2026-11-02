/* AC-10 shared-template lock: two pens of the SAME template share one
   first-dose key, so one logged dose locks both. Also covers the lock
   toast on a [data-start-locked]/[data-time-locked] control. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

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

const slug = `share${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Shared Template', pens: [{ template: 'ghk' }, { template: 'ghk' }],
  settings: { startDate: ago(6) } }) });

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
let pageErrors = 0;
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; pageErrors++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);

const open = async () => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartCalendar(); } catch {} });
  await p.waitForTimeout(300);
};

await open();

const before = await p.evaluate(() => ({
  ids: PENS.map(x => x.id),
  dayButtons: document.querySelectorAll('[data-startday]').length,
  timeFields: document.querySelectorAll('[data-pentime]').length
}));
check('two pens of one template get distinct ids',
      before.ids.length === 2 && before.ids[0] !== before.ids[1], JSON.stringify(before.ids));
check('and both render editable start controls',
      before.dayButtons > 0 && before.timeFields > 0, JSON.stringify(before));

await p.evaluate(async d => {
  await fetch(`/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: CARD_SLUG || readSlug(), template: 'ghk', pen: 'GHK-Cu',
      units: 6, at: new Date().toISOString(), day: d }) });
}, ago(3));
await open();

const after = await p.evaluate(() => ({
  locked: PENS.map(x => ({ id: x.id, locked: penLocked(x), start: penStartIso(x) })),
  dayButtons: document.querySelectorAll('[data-startday]').length,
  timeFields: document.querySelectorAll('[data-pentime]').length,
  lockedSpans: document.querySelectorAll('[data-start-locked]').length,
  timeLockedSpans: document.querySelectorAll('[data-time-locked]').length
}));
check('both pens are locked by the one dose',
      after.locked.every(x => x.locked), JSON.stringify(after.locked));
check('both start days are pinned to the dose day',
      after.locked.every(x => x.start === ago(3)), JSON.stringify(after.locked));
check('neither keeps an editable control',
      after.dayButtons === 0 && after.timeFields === 0, JSON.stringify(after));
check('both render the locked plain text',
      after.lockedSpans >= 2 && after.timeLockedSpans >= 2, JSON.stringify(after));

await p.locator('[data-time-locked="ghk#0"]').first().click();
await p.waitForTimeout(200);
const toast = await p.evaluate(() => document.getElementById('toast').textContent);
check('tapping a locked control shows the lock toast',
      /locked to your first logged dose/i.test(toast), toast);

check('no page errors', pageErrors === 0, `${pageErrors} error(s)`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
