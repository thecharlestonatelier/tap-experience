/* A bogus ?change=<id> opens nothing and errors nothing; an unanchored card
   opens the protocol start calendar, whose picked day sets the global START
   that every pen falls back to. */
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
const future = n => { const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const slug = `anchor${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Unanchored', pens: [{ template: 'ghk' }] }) });

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
let pageErrors = 0;
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; pageErrors++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);

await p.goto(`${BASE}/ritual.html?c=${slug}&change=bogus`);
await p.waitForFunction(() => document.getElementById('protocolName') &&
  document.getElementById('protocolName').textContent.trim().length, null, { timeout: 15000 });
await p.waitForTimeout(400);
check('a bogus ?change id opens no calendar',
      await p.locator('#startCalScrim.open').count() === 0,
      `${await p.locator('#startCalScrim.open').count()} open`);

await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => document.querySelector('#startCalScrim.open'), null, { timeout: 15000 });
check('an unanchored card opens the protocol start calendar',
      await p.locator('#startCalScrim.open').count() === 1);
check('and it is the protocol question, not a pen question',
      (await p.locator('#startCalTitle').innerText()) === 'When did you start?',
      await p.locator('#startCalTitle').innerText());

await p.evaluate(day => {
  const d = parse(day);
  const label = fmtLong(d);
  const btn = [...document.querySelectorAll('#startCalGrid .cal-day')]
    .find(b => b.getAttribute('aria-label') === label);
  if (btn) btn.click();
}, future(4));
await p.click('#startCalSave');
await p.waitForTimeout(300);

const after = await p.evaluate(() => ({
  start: iso(START),
  pen: penStartIso(PENS.find(x => x.id === 'ghk')),
  saved: loadStart()
}));
check('the picked day becomes the protocol START',
      after.start === future(4), JSON.stringify(after));
check('and every pen falls back to it',
      after.pen === future(4), JSON.stringify(after));
check('and it is saved to the device',
      after.saved === future(4), JSON.stringify(after));

check('no page errors', pageErrors === 0, `${pageErrors} error(s)`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
