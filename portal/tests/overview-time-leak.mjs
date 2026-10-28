/* The overview's time blind spot, pinned rather than assumed: a card whose
   record genuinely carries time-of-day values in every place they can live
   — settings.penTimes, the band times, and a reported today row's `at` —
   leaks none of them through /api/overview. The only clock-looking strings
   that may pass are the two allowed instants (the top-level `asOf` and each
   patient's `lastSeen`); every other string in the raw JSON must be free of
   HH:MM, and no time-ish key may appear anywhere.

   Node HTTP only, against a file-store service with an agent token and a
   studio session:
     source /tmp/qa-env.sh && AGENT_TOKEN=test-agent-token-xyz \
       BASE=http://localhost:8095 node tests/overview-time-leak.mjs */
import { readFileSync } from 'node:fs';

/* Arrange — the agent token, a studio session, and the date helpers */
const BASE = process.env.BASE || 'http://localhost:8095';
const AGENT = process.env.AGENT_TOKEN || 'test-agent-token-xyz';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
const A = { Authorization: `Bearer ${AGENT}` };
let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

/* Arrange — two cards: one whose record carries real time-of-day values in
   settings and in its reported state, and one that has merely been opened,
   so it holds a real `lastSeen` instant the overview is allowed to carry */
const stamp = Date.now().toString(36);
const leak = `leak${stamp}.t`, tap = `tap${stamp}.t`;

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug: leak, name: 'Leak Test', pens: [{ template: 'ghk' }],
  settings: { startDate: todayIso, times: { Evening: '20:00' }, penTimes: { ghk: '21:30' } } }) });
await fetch(`${BASE}/api/state/${leak}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ startDate: todayIso, times: { Evening: '20:00' },
    today: [{ pen: 'GHK-Cu', template: 'ghk', units: 10, at: '21:30' }], supply: [] }) });

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug: tap, name: 'Tap Test', pens: [{ template: 'ghk' }], settings: { startDate: todayIso } }) });
await fetch(`${BASE}/api/tap/${tap}`, { method: 'POST' });

/* Act — the authorised read */
const body = await (await fetch(`${BASE}/api/overview`, { headers: A })).json();
const blob = JSON.stringify(body);
const who = s => body.patients.find(p => p.slug === s);

/* Assert — both cards listed, so a leak would actually show up */
check('both seeded cards are listed', !!who(leak) && !!who(tap),
  `${body.patients.length} patient(s)`);

/* Assert — the answer has exactly the two top-level keys */
check('the answer is exactly { asOf, patients }',
  JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['asOf', 'patients'].sort()),
  Object.keys(body).join(','));

/* Assert — the seeded times never appear, even as raw text */
check('the pen time 21:30 never appears in the overview', !blob.includes('21:30'));
check('the band time 20:00 never appears in the overview', !blob.includes('20:00'));

/* Assert — no time-ish key anywhere, and no HH:MM string outside the two
   allowed instants (`asOf` and each patient's `lastSeen`) */
const allowedInstants = new Set([body.asOf]);
body.patients.forEach(p => { if (p.lastSeen) allowedInstants.add(p.lastSeen); });
const forbidden = new Set(['time', 'clockTime', 'hhmm', 'times', 'penTimes', 'at',
  'settings', 'state', 'note', 'doses', 'site', 'sub', 'endpoint']);
const leaks = [];
const walk = (node, path) => {
  if (typeof node === 'string') {
    if (allowedInstants.has(node)) return;
    if (/\d{1,2}:\d{2}/.test(node)) leaks.push(`${path}=${JSON.stringify(node)}`);
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (forbidden.has(k)) leaks.push(`key ${path}.${k}`);
      walk(node[k], `${path}.${k}`);
    }
  }
};
walk(body, '$');
check('no time-ish key and no HH:MM outside the allowed instants',
  !leaks.length, leaks.slice(0, 6).join('; '));

/* Assert — the allowed instant is the real thing: the tapped card's
   lastSeen is a full ISO instant, not a bare clock time sneaking through */
const seen = who(tap) && who(tap).lastSeen;
check('the tapped card carries a full ISO lastSeen instant',
  typeof seen === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(seen),
  String(seen));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — the overview stays free of time-of-day values beyond the allowed instants.');
process.exit(bad ? 1 : 0);
