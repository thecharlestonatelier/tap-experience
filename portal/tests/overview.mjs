/* The read-only overview: what it refuses, what it answers with, and
   what it must never carry. */
import { readFileSync } from 'node:fs';

/* Arrange — the agent token, a studio session, and the date helpers */
const BASE = process.env.BASE || 'http://localhost:8095';
const AGENT = process.env.AGENT_TOKEN || 'test-agent-token-xyz';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
const A = { Authorization: `Bearer ${AGENT}` };
let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};
const pad = n => String(n).padStart(2, '0');
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/* Arrange — a patient out of a prescribed pen and out of a vial she
   sized herself, one freshly started, and an unassigned blank tag */
const stamp = Date.now().toString(36);
const mg = `mg${stamp}.t`, fine = `fine${stamp}.t`, blank = `bl${stamp}.q`;

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug: mg, name: 'Maggie Test', pens: [{ template: 'tirz' }, { template: 'ghk' }],
  startDate: daysAgo(40), note: 'PRIVATE CLINICAL NOTE' }) });
await fetch(`${BASE}/api/state/${mg}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ startDate: daysAgo(40), today: [],
    supply: [{ template: 'tirz', dosesLeft: 0, lastDose: daysAgo(2) }] }) });

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug: fine, name: 'Fine Test', pens: [{ template: 'ghk' }], startDate: daysAgo(1) }) });
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: blank, status: 'blank' }) });

/* Act — ask with no token */
let r = await fetch(`${BASE}/api/overview`);
/* Assert — refused */
check('no token is refused', r.status === 401);

/* Act — ask with a wrong token */
r = await fetch(`${BASE}/api/overview`, { headers: { Authorization: 'Bearer nope' } });
/* Assert — refused */
check('a wrong token is refused', r.status === 401);

/* Act — ask with only the studio cookie */
r = await fetch(`${BASE}/api/overview`, { headers: H });
/* Assert — refused */
check('a studio cookie alone is not enough', r.status === 401);

/* Act — write to it */
r = await fetch(`${BASE}/api/overview`, { method: 'POST', headers: A, body: '{}' });
/* Assert — read-only */
check('it is read-only', [405, 404, 401].includes(r.status));

/* Act — the authorised read */
const body = await (await fetch(`${BASE}/api/overview`, { headers: A })).json();
const who = s => body.patients.find(p => p.slug === s);

/* Assert — assigned patients listed, unassigned tags left out */
check('it lists assigned patients', !!who(mg) && !!who(fine), `${body.patients.length} patient(s)`);
check('and leaves out unassigned tags', !who(blank));

/* Assert — the shortages the whole endpoint exists for. Templates state
   the dose in milligrams and the pen is dialled in units; reading the
   file raw gives phases with no units, every pen measures as lasting no
   days, and the list quietly reports that nobody is ever short. */
check('a prescribed pen past its end is named',
      who(mg).outOf.includes('GHK-Cu'), JSON.stringify(who(mg).outOf));
check('a vial she sized herself is named too, from her own report',
      who(mg).outOf.includes('Tirzepatide'), JSON.stringify(who(mg).outOf));
check('a freshly started pen is not flagged',
      !who(fine).outOf.length && !who(fine).runningLow.length,
      JSON.stringify(who(fine).outOf.concat(who(fine).runningLow)));

/* Assert — and it carries nothing it does not need */
const blob = JSON.stringify(body);
check('the clinician note never leaves the dashboard', !blob.includes('PRIVATE CLINICAL NOTE'));
const allowed = new Set(['slug', 'name', 'status', 'lastSeen', 'startDate', 'pens',
  'outOf', 'runningLow', 'supplyUnknown', 'stopped', 'addedHerself']);
const extra = Object.keys(who(mg)).filter(k => !allowed.has(k));
check('and no field beyond the agreed list', !extra.length, extra.join(', '));
check('no dose history, sites or times travel with it',
      !/"(note|doses|site|times|settings|state|sub|endpoint)"/.test(blob));

/* Act — the dashboard's own list */
const list = await (await fetch(`${BASE}/api/cards`, { headers: H })).json();
const card = list.cards.find(c => c.slug === mg);
/* Assert — supply read from the same place the overview reads it */
check('the dashboard reads supply from the same place',
      JSON.stringify(card.supply.out) === JSON.stringify(who(mg).outOf),
      `${JSON.stringify(card.supply.out)} vs ${JSON.stringify(who(mg).outOf)}`);

console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
