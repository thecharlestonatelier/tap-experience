/* A blank tag a patient starts using on her own — flipped active by a
   patient-added pen, not by the dashboard — appears in /api/overview and
   carries addedHerself. overview.mjs pins assigned cards and the field
   list; this pins the flip-to-active side of the same endpoint.

   Node, against a file-store service with an agent token:
     AGENT_TOKEN=test-agent-token-xyz BASE=http://localhost:8096 node tests/overview-flip.mjs */
import { readFileSync } from 'node:fs';

/* Arrange — the agent token, a studio session, and the harness */
const BASE = process.env.BASE || 'http://localhost:8096';
const AGENT = process.env.AGENT_TOKEN || 'test-agent-token-xyz';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
const A = { Authorization: `Bearer ${AGENT}` };
let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);

/* Arrange — a blank tag, then the patient puts a pen on it herself */
const slug = `ovf${stamp}.q`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, status: 'blank' }) });
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ added: [{ id: 'bpc+zz', template: 'bpc', startDate: '2026-10-20' }] }) });

/* Assert — the flip really happened */
const rec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
check('the added pen flips the tag active', rec.status === 'active', JSON.stringify(rec));

/* Act — the authorised overview read */
const body = await (await fetch(`${BASE}/api/overview`, { headers: A })).json();
const who = body.patients.find(p => p.slug === slug);

/* Assert — the flipped tag is listed, with its added pen named */
check('a patient-started tag appears in the overview', !!who, `${body.patients.length} patient(s)`);
check('and carries the pen she added herself',
  who && Array.isArray(who.addedHerself) && who.addedHerself.includes('bpc'),
  who && JSON.stringify(who.addedHerself));
check('and is marked active',
  who && who.status === 'active', who && JSON.stringify(who.status));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — a blank tag she started using is as visible as any prescribed card.');
process.exit(bad ? 1 : 0);
