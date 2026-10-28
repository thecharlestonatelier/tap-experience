/* The reverse of the flip gate-nameless.mjs pins: a blank tag a patient
   started using on her own flips active and gates — but when she takes
   that one pen off again the record flips back to blank, and the next
   cold visit must NOT gate. gate-blank.mjs pins a never-used blank tag;
   this pins the blank a tag returns to after use. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/* Arrange — a studio session, and a blank tag */
const BASE = process.env.BASE || 'http://localhost:8096';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };

const slug = `aback${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, status: 'blank' }) });

/* Act — the patient puts one pen on, the way the ritual page does it */
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ added: [{ id: 'bpc+yy', template: 'bpc', startDate: '2026-10-20' }] }) });
let rec = await (await fetch(`${BASE}/api/card/${slug}`)).json();
/* Assert — it flipped into use */
check('the added pen flips the tag into use', rec.status === 'active', JSON.stringify(rec));

/* Act — she takes it off again */
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ added: [] }) });
rec = await (await fetch(`${BASE}/api/card/${slug}`)).json();
/* Assert — back to blank */
check('and removing it flips the tag back to blank', rec.status === 'blank', JSON.stringify(rec));

/* Act — a cold visit with no sign-in */
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 900 } })).newPage();
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(
  () => document.getElementById('todaySummary').textContent !== 'Loading your protocol\u2026',
  null, { timeout: 25000 });

/* Assert — no gate, and the honest no-protocol message */
const gated = await p.locator('#auth-gate').count();
check('a tag returned to blank never gates', gated === 0, `gate count=${gated}`);
check('it still says there is no protocol on it',
  /no protocol on it/i.test(await p.textContent('#todaySummary')),
  await p.textContent('#todaySummary'));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — use gates, disuse opens again.');
process.exit(bad ? 1 : 0);
