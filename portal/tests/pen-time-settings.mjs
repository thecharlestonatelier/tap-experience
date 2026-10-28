/* The per-pen time field on the wire, pinned rather than assumed:
   settings.penTimes keeps only HH:MM values, a re-POST of unchanged
   settings does not bump rev while a force POST does, the public read
   carries settings (with penTimes) but never state or activation, and
   the state report keeps only HH:MM `at` values in today rows.

   Node, against a file-store service with a seeded store:
     source /tmp/qa-env.sh && BASE=http://localhost:8091 node tests/pen-time-settings.mjs */
import { readFileSync } from 'node:fs';

/* Arrange — a studio session and the harness */
const BASE = process.env.BASE || 'http://localhost:8091';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `pt${stamp}.t`;

/* Arrange — a card whose penTimes mix good and bad values */
const made = await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({
    slug, name: 'Pen Time', pens: [{ template: 'ghk' }],
    settings: {
      startDate: '2026-10-20',
      times: { Evening: '20:30' },
      penTimes: { ghk: '19:30', bpc: '25:99', nad: '7:30', x: 'nope' }
    }
  }) });
const created = await made.json();
check('the card is created', made.status === 201, `HTTP ${made.status}`);

/* Assert — only the valid HH:MM value survives sanitization */
check('settings.penTimes keeps only valid HH:MM values',
  created.settings && created.settings.penTimes &&
  Object.keys(created.settings.penTimes).length === 1 &&
  created.settings.penTimes.ghk === '19:30',
  JSON.stringify(created.settings && created.settings.penTimes));
check('band times are untouched by the new field',
  created.settings && created.settings.times && created.settings.times.Evening === '20:30',
  JSON.stringify(created.settings && created.settings.times));

/* Act — the public, unauthenticated read */
const pub = await (await fetch(`${BASE}/api/card/${slug}`)).json();
/* Assert — settings ride it, private fields do not */
check('the public read carries settings with penTimes',
  pub.settings && pub.settings.penTimes && pub.settings.penTimes.ghk === '19:30',
  JSON.stringify(pub.settings));
check('the public read carries no state or activation',
  !('state' in pub) && !('activatedBy' in pub), Object.keys(pub).join(', '));

/* Act — re-POST the same settings without force */
const again = await fetch(`${BASE}/api/cards/${slug}`, { method: 'PUT', headers: H,
  body: JSON.stringify({ settings: { startDate: '2026-10-20', times: { Evening: '20:30' }, penTimes: { ghk: '19:30' } } }) });
const againRec = await again.json();
/* Assert — no rev bump for an unchanged save */
check('an unchanged save does not bump the settings rev',
  againRec.settings && Number(againRec.settings.rev) === Number(created.settings.rev),
  `${created.settings.rev} -> ${againRec.settings && againRec.settings.rev}`);

/* Act — the same save, forced */
const forced = await fetch(`${BASE}/api/cards/${slug}`, { method: 'PUT', headers: H,
  body: JSON.stringify({ settings: { startDate: '2026-10-20', times: { Evening: '20:30' }, penTimes: { ghk: '19:30' }, force: true } }) });
const forcedRec = await forced.json();
/* Assert — force raises it */
check('a forced save raises the settings rev',
  Number(forcedRec.settings.rev) === Number(created.settings.rev) + 1,
  `${created.settings.rev} -> ${forcedRec.settings && forcedRec.settings.rev}`);

/* Act — a state report with a good and a bad time */
const state = await fetch(`${BASE}/api/state/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ startDate: '2026-10-20', today: [{ pen: 'ghk', template: 'ghk', phase: 'p1', at: '24:00' }, { pen: 'ghk', template: 'ghk', phase: 'p1', at: '19:30' }] }) });
const stRec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
/* Assert — sanitizeState kept the good time and dropped the bad one */
check('the state report keeps only HH:MM times',
  state.status === 204 &&
  (stRec.state && stRec.state.today || []).filter(r => r.at === '19:30').length === 1 &&
  (stRec.state && stRec.state.today || []).filter(r => r.at === '24:00').length === 0,
  JSON.stringify(stRec.state && stRec.state.today));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — penTimes travel sanitized, rev-gated, and never beyond the agreed surfaces.');
process.exit(bad ? 1 : 0);
