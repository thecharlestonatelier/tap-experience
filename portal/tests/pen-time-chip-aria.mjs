/* A locked chip stays a real, activatable button: its tap is what
   explains the lock, so it must never be marked disabled — neither
   natively nor via aria-disabled, which would tell assistive tech to
   skip the very explanation the chip exists to deliver.

   Playwright, against a file-store service:
     source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-time-chip-aria.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, a daily pen, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `aria${stamp}.t`;
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Aria Test', pens: [{ template: 'ghk' }], settings: { startDate: todayIso } }) });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartPicker(); } catch {} });
await p.waitForTimeout(400);

/* Act — log the first dose so the chips lock */
await p.evaluate(async ({ slug, todayIso }) => {
  await fetch('/api/dose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, at: `${todayIso}T10:00:00`, day: todayIso }) });
  await loadLogged(); renderAll();
}, { slug, todayIso });
await p.waitForTimeout(400);

/* Assert — the locked chip is a real button: no native disabled, no
   aria-disabled, still keyboard-focusable */
const st = await p.evaluate(() => {
  const el = document.querySelector('[data-datechip="ghk"]');
  return {
    locked: el.classList.contains('locked'),
    nativeDisabled: el.disabled,
    ariaDisabled: el.getAttribute('aria-disabled'),
    tabIndex: el.tabIndex,
    tag: el.tagName.toLowerCase()
  };
});
check('the chip carries the locked state', st.locked, JSON.stringify(st));
check('the locked chip is a native, enabled button',
  st.tag === 'button' && st.nativeDisabled === false, JSON.stringify(st));
check('it is never aria-disabled',
  st.ariaDisabled === null || st.ariaDisabled === 'false', JSON.stringify(st.ariaDisabled));
check('it stays keyboard-focusable',
  st.tabIndex === 0, `${st.tabIndex}`);

/* Act — activate it: the explanation must fire */
await p.locator('[data-datechip="ghk"]').click();
await p.waitForTimeout(300);
check('activating a locked chip still explains itself',
  (await p.textContent('#toast')).includes('Locked — your first logged dose.'),
  await p.textContent('#toast'));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — a locked chip explains itself and is never announced disabled.');
process.exit(bad ? 1 : 0);
