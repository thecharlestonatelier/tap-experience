/* The gate's other boundary. The round-3 fix widened the gate from
   name|pens to name|pens|added, so every card carrying any of the
   patient's protocol gates — but a genuinely blank tag (no name, no
   prescribed pen, no patient-added pen) must still open unsigned-in.
   empty-card.mjs signs in first, so nothing proves that exemption on a
   cold visit; this pins the negative side of the same condition that
   gate-nameless.mjs pins the positive side of. */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/* Arrange — a studio session, and a genuinely blank tag */
const BASE = process.env.BASE || 'http://localhost:8096';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };

const slug = `blk${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, status: 'blank' }) });

const rec = await (await fetch(`${BASE}/api/card/${slug}`)).json();
check('the minted tag is blank', rec.status === 'blank' && !rec.name &&
  !(rec.pens || []).length && !(rec.added || []).length, JSON.stringify(rec));

/* Act — a cold visit with no sign-in */
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 900 } })).newPage();
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(
  () => document.getElementById('todaySummary').textContent !== 'Loading your protocol\u2026',
  null, { timeout: 25000 });

/* Assert — no gate, and the honest no-protocol message */
const gated = await p.locator('#auth-gate').count();
check('a blank tag never gates on a cold visit', gated === 0, `gate count=${gated}`);
check('it still says there is no protocol on it',
  /no protocol on it/i.test(await p.textContent('#todaySummary')),
  await p.textContent('#todaySummary'));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — only assigned cards gate; a blank tag stays open.');
process.exit(bad ? 1 : 0);
