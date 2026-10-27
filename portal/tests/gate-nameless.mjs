/* The gate's key: a card carrying a dosing protocol must never open
   unsigned-in, whatever its name says. Three cards that once slipped
   through — an explicit empty name over a typed first name, a prescribed
   pen with no name at all, and a whitespace-only name — must all show
   the welcome gate on a cold visit, and the first one must still carry
   the derived name on the record. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/* Arrange — a studio session, and the three hostile mints */
const BASE = process.env.BASE || 'http://localhost:8096';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};

const stamp = Date.now().toString(36);
const mk = async (label, body) => {
  const slug = `${label}${stamp}.t`;
  await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
    body: JSON.stringify(Object.assign({ slug }, body)) });
  return slug;
};

const overridden = await mk('nn', { name: '', firstName: 'Jane', lastName: 'Doe', pens: [{ template: 'ghk' }] });
const nameless   = await mk('np', { pens: [{ template: 'ghk' }] });
const blanked    = await mk('ws', { name: '   ', pens: [{ template: 'ghk' }] });

/* Assert — the record tells the truth about each name */
const rec = slug => fetch(`${BASE}/api/cards/${slug}`, { headers: { Cookie: `ca_studio=${TOK}` } })
  .then(r => r.json());
const recOverridden = await rec(overridden);
check('an empty name does not override the typed first and last names',
  recOverridden.name === 'Jane Doe', JSON.stringify(recOverridden.name));
check('a prescribed card with no name at all stays as it is',
  (await rec(nameless)).name === '', JSON.stringify((await rec(nameless)).name));
check('a whitespace-only name is treated as no name',
  (await rec(blanked)).name === '', JSON.stringify((await rec(blanked)).name));

/* Act — a cold visit to each, with no sign-in */
const b = await chromium.launch();
for (const slug of [overridden, nameless, blanked]) {
  const p = await (await b.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForSelector('#auth-gate', { timeout: 25000 });
  /* Assert — the welcome gate, never the open card */
  const state = await p.getAttribute('#auth-gate', 'data-state');
  check(`a protocol-carrying card (${slug.split(stamp)[0]}) gates its first tap`,
    state === 'welcome', state);
  await p.context().close();
}
await b.close();

console.log(bad ? `\n${bad} FAILED` : '\nPASS — the gate keys on the protocol, not the name.');
process.exit(bad ? 1 : 0);
