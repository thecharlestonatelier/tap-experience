/* AC-11: every calendar event carries a way back that names its own pen. */
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

const slug = `ics${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'ICS Links', pens: [{ template: 'ghk' }, { template: 'bpc' }],
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

const out = await p.evaluate(() => {
  const ghk = PENS.find(x => x.id === 'ghk');
  const bpc = PENS.find(x => x.id === 'bpc');
  const ghkUrl = icsChangeUrl(ghk);
  const bpcUrl = icsChangeUrl(bpc);
  const change = u => { try { return new URL(u).searchParams.get('change'); } catch { return null; } };
  const text = buildICS().text;
  return {
    ghkChange: change(ghkUrl), bpcChange: change(bpcUrl),
    ghkUrl, bpcUrl,
    textHasGhk: text.includes('change=ghk'),
    textHasBpc: text.includes('change=bpc'),
    urlLines: (text.match(/^URL:/gm) || []).length,
    events: (text.match(/^BEGIN:VEVENT$/gm) || []).length
  };
});

check('ghk\'s change link names ghk', out.ghkChange === 'ghk', out.ghkUrl);
check('bpc\'s change link names bpc', out.bpcChange === 'bpc', out.bpcUrl);
check('the two pens get different links', out.ghkUrl !== out.bpcUrl,
      `${out.ghkChange} vs ${out.bpcChange}`);
check('the ICS text names each pen in its own event',
      out.textHasGhk && out.textHasBpc, `${out.events} event(s)`);
check('and it actually has events to carry them', out.events > 0, `${out.events} event(s)`);
check('and those events carry change links', out.urlLines > 0, `${out.urlLines} URL line(s)`);

check('no page errors', pageErrors === 0, `${pageErrors} error(s)`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
