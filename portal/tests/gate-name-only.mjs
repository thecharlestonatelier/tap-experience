/* The gate's name branch, isolated. gate-nameless.mjs proves that a card
   carrying any of name, a prescribed pen, or a patient-added pen gates;
   the widened condition `name || pens || added` once gated on name alone,
   and a regression that dropped the name branch would open a named card
   unsigned-in. This mints a card that carries a name and nothing else —
   no prescribed pen, no added pen — and pins that it still gates. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/* Arrange — a studio session, and a name-only card */
const BASE = process.env.BASE || 'http://localhost:8096';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };

const slug = `nonly${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Name Only', pens: [] }) });

/* Assert — the record really carries only a name */
const rec = await (await fetch(`${BASE}/api/card/${slug}`)).json();
check('the minted card carries only a name',
  rec.name === 'Name Only' && rec.pens.length === 0 && rec.added.length === 0,
  JSON.stringify(rec));

/* Act — a cold visit with no sign-in */
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 900 } })).newPage();
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForSelector('#auth-gate', { timeout: 25000 });

/* Assert — the welcome gate, never the open card */
const state = await p.getAttribute('#auth-gate', 'data-state');
check('a name-only card gates its first tap', state === 'welcome', state);

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the name branch alone holds the gate shut.');
process.exit(bad ? 1 : 0);
