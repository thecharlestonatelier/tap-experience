/* firstAt must pick the chronologically earliest instant, not the
   lexicographically smallest string: a hostile caller can post mixed `at`
   forms (Z, offset, bare-local), and the epoch decides.

   Node, against a file-store service with a dose store:
     source /tmp/qa-env.sh && BASE=http://localhost:8091 node tests/first-at-mixed-form.mjs */
import { readFileSync } from 'node:fs';

/* Arrange — a studio session and the harness */
const BASE = process.env.BASE || 'http://localhost:8091';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const slug = `mfm${Date.now().toString(36)}.t`;

/* Arrange — a card with one pen */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'MixedForm', pens: [{ template: 'nad' }], settings: { startDate: '2026-10-20' } }) });

/* Arrange — two doses with mixed forms:
   A: local 10pm with an explicit offset (true instant 02:00Z next day).
   B: 00:00Z (true instant 00:00Z) — chronologically earlier. */
const post = (at, day) => fetch(`${BASE}/api/dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug, template: 'nad', pen: 'NAD', units: 5, at, day }) }).then(r => r.json());
await post('2026-10-20T22:00:00-04:00', '2026-10-20');
await post('2026-10-21T00:00:00.000Z', '2026-10-21');

/* Act — read the logged reply */
const logged = await (await fetch(`${BASE}/api/logged/${slug}`)).json();

/* Assert — the chronologically earliest instant wins */
check('firstAt is the chronologically earliest instant',
  logged.firstAt && logged.firstAt.nad === '2026-10-21T00:00:00.000Z', JSON.stringify(logged.firstAt));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — the true earliest instant wins.');
process.exit(bad ? 1 : 0);
