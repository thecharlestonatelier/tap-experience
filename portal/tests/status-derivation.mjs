/* The store's status derivation, pinned rather than assumed. Four edges
   of the name/pens/added -> status rule in store/sanitize:

     - a card whose content is fully removed flips back to blank — a
       nameless prescribed card cleared by the dashboard, and an added-only
       card whose pen the patient takes off again;
     - a card with only a name, or only a prescribed pen, is active — the
       derivation keys on all three (name, pens, added), not just added;
     - retired is the atelier's word and is never second-guessed, not by a
       save that changes the content and not by one that empties the card;
     - a save that omits the name preserves the existing name, and an
       explicitly empty name falls back to it too.

   Node, against a file-store service (any runbook port; BASE overrides):
     source /tmp/qa-env.sh && BASE=http://localhost:8096 node tests/status-derivation.mjs */
import { readFileSync } from 'node:fs';

/* Arrange — a studio session and the harness */
const BASE = process.env.BASE || 'http://localhost:8096';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const mk = (slug, body) => fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify(Object.assign({ slug }, body)) });
const get = slug => fetch(`${BASE}/api/cards/${slug}`, { headers: H }).then(r => r.json());
const put = (slug, body) => fetch(`${BASE}/api/cards/${slug}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(r => r.json());
const postAdded = (slug, body) => fetch(`${BASE}/api/added/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

/* ---------- 1. full removal flips back to blank ---------- */

/* Arrange — a prescribed card with no name at all */
const pens = `sdP${stamp}.t`;
await mk(pens, { pens: [{ template: 'ghk' }] });
let rec = await get(pens);
check('a prescribed card with no name is active', rec.status === 'active' && rec.pens.length === 1, JSON.stringify(rec));

/* Act — the dashboard clears name, pens and added */
rec = await put(pens, { name: '', pens: [], added: [] });
/* Assert — it flips back to blank */
check('clearing it flips it back to blank',
  rec.status === 'blank' && rec.name === '' && rec.pens.length === 0 && rec.added.length === 0,
  JSON.stringify(rec));

/* Arrange — a blank tag the patient started using herself */
const addedOnly = `sdA${stamp}.t`;
await mk(addedOnly, { status: 'blank' });
rec = await postAdded(addedOnly, { added: [{ id: 'bpc+aa', template: 'bpc', startDate: '2026-10-20' }] });
check('an added-only card is in use', rec.ok === true, JSON.stringify(rec));
rec = await get(addedOnly);
check('and reads active', rec.status === 'active', JSON.stringify(rec));

/* Act — she takes the pen back off */
rec = await postAdded(addedOnly, { added: [] });
rec = await get(addedOnly);
/* Assert — it flips back to blank */
check('removing the added pen flips it back to blank',
  rec.status === 'blank' && rec.added.length === 0, JSON.stringify(rec));

/* ---------- 2. name or pen alone makes a card active ---------- */

/* Arrange — a blank tag */
const named = `sdN${stamp}.t`;
await mk(named, { status: 'blank' });
/* Act — give it only a name */
rec = await put(named, { name: 'Name Only' });
/* Assert — active, and nothing else needed */
check('a name alone makes it active', rec.status === 'active' && rec.name === 'Name Only', JSON.stringify(rec));

/* Arrange — a second blank tag */
const penned = `sdD${stamp}.t`;
await mk(penned, { status: 'blank' });
/* Act — give it only a prescribed pen */
rec = await put(penned, { pens: [{ template: 'ghk' }] });
/* Assert — active */
check('a prescribed pen alone makes it active', rec.status === 'active' && rec.pens.length === 1, JSON.stringify(rec));

/* ---------- 3. retired is never second-guessed ---------- */

/* Arrange — a retired card with content */
const retired = `sdR${stamp}.t`;
await mk(retired, { name: 'Retired Patient', pens: [{ template: 'ghk' }], status: 'retired' });

/* Act — a save that changes the content */
rec = await put(retired, { name: 'Still Retired', pens: [{ template: 'bpc' }] });
/* Assert — still retired */
check('a save with content does not revive a retired card', rec.status === 'retired', JSON.stringify(rec));

/* Act — a save that empties the card */
rec = await put(retired, { name: '', pens: [], added: [] });
/* Assert — still retired, not blanked */
check('nor does emptying it', rec.status === 'retired', JSON.stringify(rec));

/* ---------- 4. the existing name is preserved ---------- */

/* Arrange — a named card */
const named2 = `sdE${stamp}.t`;
await mk(named2, { name: 'Jane Doe', pens: [{ template: 'ghk' }] });

/* Act — a save that omits the name entirely */
rec = await put(named2, { pens: [{ template: 'bpc' }] });
/* Assert — the name survives */
check('a save with no name keeps the existing name', rec.name === 'Jane Doe', JSON.stringify(rec.name));

/* Act — a save with an explicitly empty name */
rec = await put(named2, { name: '' });
/* Assert — it falls back to the existing name */
check('and an empty name falls back to the existing name', rec.name === 'Jane Doe', JSON.stringify(rec.name));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — status derives from name, pens and added; retired and the existing name are never second-guessed.');
process.exit(bad ? 1 : 0);
