/* Prove the public card read stays inside the publicView() contract
   (see the QA report, Bug #2): the clinician's note and treatment record
   must not ride an unauthenticated read. Node, against a dedicated
   service (activate.mjs style):
     CARD_STORE=file CARD_FILE=.data-test/publicview-cards.json \
       STUDIO_PASSPHRASE=testpassphrase PORT=8095 node server.js &
     node tests/public-view-shape.mjs */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8095';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};

/* Arrange — a card carrying everything the dashboard can write, the
   private fields included */
const slug = `pv${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'PV Probe', status: 'active', pens: [{ template: 'ghk' }],
  note: 'PRIVATE NOTE',
  visits: [{ service: 'prx', date: '2026-10-20', area: 'Underarm', note: 'visit note', units: 12 }]
}) });

/* Act — the public, unauthenticated read */
const rec = await (await fetch(`${BASE}/api/card/${slug}`)).json();

/* Assert — only the agreed publicView() fields, and neither private one */
const allowed = new Set(['slug', 'name', 'status', 'startDate', 'pens', 'added', 'dropped', 'settings']);
const extra = Object.keys(rec).filter(k => !allowed.has(k));
check('public card read carries no field beyond publicView()', extra.length === 0, extra.join(', '));
check('the clinician note never leaves the dashboard', !('note' in rec));
check('the treatment record never leaves the dashboard', !('visits' in rec));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — the public read matches publicView().');
process.exit(bad ? 1 : 0);
