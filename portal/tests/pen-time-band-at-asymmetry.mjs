/* A time means a real clock on BOTH surfaces the same way: settings.times
   (atelier band times) and the state report's today-row `at` apply one
   rule, so no value survives one surface and blanks on the other. 24:00
   is rejected everywhere; a real clock survives everywhere.

   Node, against a file-store service with a seeded store:
     source /tmp/qa-env.sh && BASE=http://localhost:8091 node tests/pen-time-band-at-asymmetry.mjs */
import { readFileSync } from 'node:fs';

/* Arrange — a studio session and the harness */
const BASE = process.env.BASE || 'http://localhost:8091';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `asym${stamp}.t`;

/* Arrange — a card whose band time is a non-clock, and a real one */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Asym', pens: [{ template: 'ghk' }],
    settings: { startDate: '2026-10-20', times: { Evening: '24:00', Morning: '08:30' } } }) });
const rec0 = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
const times0 = rec0.settings && rec0.settings.times || {};
/* Assert — the non-clock is rejected and the real clock kept, on the
   settings surface */
check('settings.times drops the non-clock and keeps the real one',
  !('Evening' in times0) && times0.Morning === '08:30', JSON.stringify(times0));

/* Act — report a today row for each, one non-clock and one real */
await fetch(`${BASE}/api/state/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ startDate: '2026-10-20',
    today: [{ pen: 'GHK', template: 'ghk', at: '24:00' }, { pen: 'GHK', template: 'ghk', at: '19:30' }] }) });
const rec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
const rows = rec.state && rec.state.today || [];
/* Assert — the state surface applies the same rule */
check('state today rows apply the same clock rule',
  rows.filter(r => r.at === '24:00').length === 0 &&
  rows.filter(r => r.at === '19:30').length === 1,
  JSON.stringify(rows.map(r => r.at)));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — one clock rule on both surfaces.');
process.exit(bad ? 1 : 0);
