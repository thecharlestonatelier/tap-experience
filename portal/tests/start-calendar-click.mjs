/* AC-2 click wiring: the "Started [date]" button opens that pen's calendar. */
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

const slug = `cal${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Calendar Click', pens: [{ template: 'ghk' }],
  settings: { startDate: ago(6) } }) });

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
let pageErrors = 0;
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; pageErrors++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartCalendar(); } catch {} });
await p.waitForTimeout(300);

check('an open pen renders a start-day button',
      await p.locator('[data-startday="ghk"]').count() > 0,
      `${await p.locator('[data-startday="ghk"]').count()} button(s)`);
check('and the calendar starts closed',
      await p.locator('#startCalScrim.open').count() === 0);

await p.locator('[data-startday="ghk"]').first().click();
await p.waitForTimeout(300);

check('clicking the button opens the calendar',
      await p.locator('#startCalScrim.open').count() === 1);
check('and it titles this pen',
      /GHK-Cu/i.test(await p.locator('#startCalTitle').innerText()),
      await p.locator('#startCalTitle').innerText());

const aria = await p.evaluate(() => {
  const m = document.querySelector('#startCalScrim .modal');
  return { role: m && m.getAttribute('role'), modal: m && m.getAttribute('aria-modal') };
});
check('the modal is role="dialog" aria-modal="true"',
      aria.role === 'dialog' && aria.modal === 'true', JSON.stringify(aria));

await p.keyboard.press('Escape');
await p.waitForTimeout(200);
check('Escape closes the calendar',
      await p.locator('#startCalScrim.open').count() === 0);

await p.locator('[data-startday="ghk"]').first().click();
await p.waitForTimeout(300);
await p.click('#startCalScrim', { position: { x: 5, y: 5 } });
await p.waitForTimeout(200);
check('a backdrop click closes the calendar',
      await p.locator('#startCalScrim.open').count() === 0);

check('no page errors', pageErrors === 0, `${pageErrors} error(s)`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
