/* The time field drives timeFor(pen) through its change event; empty change
   keeps the old override; invalid setPenTime writes nothing; clearing the
   per-pen override falls back to the band default. */
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

const slug = `time${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Time Controls', pens: [{ template: 'ghk' }],
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

const changed = await p.evaluate(() => {
  const inp = document.querySelector('[data-pentime="ghk"]');
  inp.value = '07:30';
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return {
    time: timeFor(PENS.find(x => x.id === 'ghk')),
    toast: document.getElementById('toast').textContent,
    field: document.querySelector('[data-pentime="ghk"]')?.value
  };
});
check('the change event updates timeFor (AC-3)',
      changed.time === '07:30', JSON.stringify(changed));
check('and the card re-renders with the toast',
      changed.field === '07:30' && /now at/i.test(changed.toast), JSON.stringify(changed));

const emptied = await p.evaluate(() => {
  const inp = document.querySelector('[data-pentime="ghk"]');
  inp.value = '';
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return { time: timeFor(PENS.find(x => x.id === 'ghk')) };
});
check('an emptied field keeps the previous time',
      emptied.time === '07:30', JSON.stringify(emptied));

const invalid = await p.evaluate(() => {
  const pen = PENS.find(x => x.id === 'ghk');
  setPenTime(pen, '');
  setPenTime(null, '07:00');
  return { time: timeFor(pen) };
});
check('setPenTime("") and setPenTime(null, "07:00") are no-ops',
      invalid.time === '07:30', JSON.stringify(invalid));

check('the per-pen override is what reads back',
      await p.evaluate(() => timeFor(PENS.find(x => x.id === 'ghk'))) === '07:30');

const fallback = await p.evaluate(() => {
  const mine = loadTimes();
  delete mine['ghk'];
  saveTimes(mine);
  return { time: timeFor(PENS.find(x => x.id === 'ghk')) };
});
check('after clearing, the pen falls back to the band default',
      fallback.time === '20:00', `${fallback.time} (Evening default)`);

check('no page errors', pageErrors === 0, `${pageErrors} error(s)`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
