/* AC-8 global start editor removed: the old one-start-day editor
   (#btnStart button + #startScrim) is gone, and the read-only Schedule
   tab/panel still renders the protocol calendar. */
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

const slug = `edit${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'No Global Editor', pens: [{ template: 'ghk' }],
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

const gone = await p.evaluate(() => ({
  btnStart: !!document.getElementById('btnStart'),
  startScrim: !!document.getElementById('startScrim')
}));
check('the global #btnStart is gone', !gone.btnStart, JSON.stringify(gone));
check('the global #startScrim is gone', !gone.startScrim, JSON.stringify(gone));

const schedule = await p.evaluate(() => ({
  tab: !!document.querySelector('.tab[data-panel="schedule"]'),
  panel: !!document.getElementById('panel-schedule'),
  grid: !!document.getElementById('calGrid'),
  detail: !!document.getElementById('dayDetail')
}));
check('the Schedule tab is present', schedule.tab, JSON.stringify(schedule));
check('the Schedule panel is present', schedule.panel, JSON.stringify(schedule));

await p.click('.tab[data-panel="schedule"]');
await p.waitForTimeout(300);
const rendered = await p.evaluate(() => ({
  active: document.getElementById('panel-schedule').classList.contains('active'),
  days: document.querySelectorAll('#calGrid .cal-day').length
}));
check('the Schedule tab activates the read-only panel',
      rendered.active, JSON.stringify(rendered));
check('and the read-only calendar renders day cells',
      rendered.days > 0, `${rendered.days} day cells`);

check('no page errors', pageErrors === 0, `${pageErrors} error(s)`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
