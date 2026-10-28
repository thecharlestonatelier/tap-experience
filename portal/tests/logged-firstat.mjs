/* The /api/logged/<slug> reply, pinned rather than assumed:
   firstAt maps each pen (template) to the EARLIEST logged instant even when
   doses arrive out of order, and the reply carries exactly { days, firstAt }
   — no lot, units, site or mg can leak into it.

   Node, against a file-store service with a dose store:
     source /tmp/qa-env.sh && BASE=http://localhost:8091 node tests/logged-firstat.mjs */
import { readFileSync } from 'node:fs';

/* Arrange — a studio session and the harness */
const BASE = process.env.BASE || 'http://localhost:8091';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `lf${stamp}.t`;

/* Arrange — a card with one pen */
const made = await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Logged First', pens: [{ template: 'ghk' }], settings: { startDate: '2026-10-20' } }) });
check('the card is created', made.status === 201, `HTTP ${made.status}`);

/* Arrange — three doses: the LATER one first, then an earlier back-fill,
   then a middle one; each carries lot/units/site/mg that must never leak */
const dose = body => fetch(`${BASE}/api/dose`, { method: 'POST', headers: H, body: JSON.stringify(body) });
await dose({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, mg: 5, lot: 'LOT-XYZ-1', site: 'Abdomen', at: '2026-10-22T09:30:00.000Z', day: '2026-10-22' });
await dose({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, mg: 5, lot: 'LOT-XYZ-2', site: 'Thigh', at: '2026-10-20T06:15:00.000Z', day: '2026-10-20' });
await dose({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, mg: 5, lot: 'LOT-XYZ-3', site: 'Arm', at: '2026-10-21T08:00:00.000Z', day: '2026-10-21' });

/* Act — read the logged reply */
const log = await (await fetch(`${BASE}/api/logged/${slug}`)).json();

/* Assert — firstAt is the EARLIEST instant, not the first posted */
check('firstAt is the earliest logged instant despite out-of-order posts',
  log.firstAt && log.firstAt.ghk === '2026-10-20T06:15:00.000Z',
  JSON.stringify(log.firstAt));

/* Assert — the shape is exactly { days, firstAt } */
check('the reply has exactly the two keys days and firstAt',
  Object.keys(log).sort().join(',') === 'days,firstAt',
  Object.keys(log).join(', '));

/* Assert — no dose detail leaks anywhere in the reply */
const text = JSON.stringify(log);
check('no lot, units, site or mg key leaks anywhere in the reply',
  !('lot' in log) && !('units' in log) && !('site' in log) && !('mg' in log) &&
  !/lot|units|site|mg|LOT-XYZ|Abdomen|Thigh/i.test(text),
  text.slice(0, 140));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — firstAt is the earliest instant and the reply stays { days, firstAt }.');
process.exit(bad ? 1 : 0);
