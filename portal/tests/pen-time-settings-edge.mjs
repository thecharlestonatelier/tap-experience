/* The per-pen time field's edge cases on the wire, pinned rather than
   assumed: a CHANGED penTimes value bumps settings.rev while an unchanged
   save does not, removing penTimes to {} bumps the rev and clears the
   field, a non-object penTimes (array/string/number/null) never becomes a
   keyed map, the map is capped at 12 keys with each key sliced to 16
   chars, and the clock check is strict on minutes (12:60 dropped) and on
   hours (24:00 dropped) while 23:59 and 00:00 pass.

   Node, against a file-store service with a seeded store:
     source /tmp/qa-env.sh && BASE=http://localhost:8091 node tests/pen-time-settings-edge.mjs */
import { readFileSync } from 'node:fs';

/* Arrange — a studio session and the harness */
const BASE = process.env.BASE || 'http://localhost:8091';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const mk = suf => `pte${stamp}${suf}.t`;
const postCard = async (slug, settings) => {
  const made = await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
    body: JSON.stringify({ slug, name: 'Pen Time Edge', pens: [{ template: 'ghk' }], settings }) });
  return { status: made.status, rec: await made.json() };
};

/* Arrange — a non-object penTimes is never a map: an array must drop like
   a string, and null/string/number must all yield {} */
const array = await postCard(mk('a'), { startDate: '2026-10-20', penTimes: ['19:30'] });
check('the card with an array penTimes is created', array.status === 201, `HTTP ${array.status}`);
/* Assert — the array must be dropped whole, never re-keyed by its index */
check('an ARRAY penTimes is dropped, never {"0":"19:30"}',
  array.rec.settings && array.rec.settings.penTimes &&
  Object.keys(array.rec.settings.penTimes).length === 0,
  JSON.stringify(array.rec.settings && array.rec.settings.penTimes));

const nil = await postCard(mk('b'), { startDate: '2026-10-20', penTimes: null });
check('a null penTimes yields an empty map',
  nil.rec.settings && nil.rec.settings.penTimes &&
  Object.keys(nil.rec.settings.penTimes).length === 0,
  JSON.stringify(nil.rec.settings && nil.rec.settings.penTimes));

const str = await postCard(mk('c'), { startDate: '2026-10-20', penTimes: '19:30' });
check('a string penTimes yields an empty map',
  str.rec.settings && str.rec.settings.penTimes &&
  Object.keys(str.rec.settings.penTimes).length === 0,
  JSON.stringify(str.rec.settings && str.rec.settings.penTimes));

const num = await postCard(mk('d'), { startDate: '2026-10-20', penTimes: 1930 });
check('a number penTimes yields an empty map',
  num.rec.settings && num.rec.settings.penTimes &&
  Object.keys(num.rec.settings.penTimes).length === 0,
  JSON.stringify(num.rec.settings && num.rec.settings.penTimes));

/* Arrange — the clock check is strict on minutes and on hours */
const clock = await postCard(mk('e'), { startDate: '2026-10-20',
  penTimes: { a: '12:60', b: '23:59', c: '24:00', d: '09:00', e: '00:00' } });
const cp = (clock.rec.settings && clock.rec.settings.penTimes) || {};
/* Assert — minutes of 60 are rejected, not just hours out of range */
check('a minute of 60 is dropped (12:60)', !('a' in cp), JSON.stringify(cp));
check('an hour of 24 is dropped (24:00)', !('c' in cp), JSON.stringify(cp));
check('23:59 and 00:00 are kept', cp.b === '23:59' && cp.e === '00:00', JSON.stringify(cp));

/* Arrange — the cap and the key slice */
const many = {};
for (let i = 0; i < 13; i++) many[`key${String(i).padStart(2, '0')}`] = '09:00';
const capped = await postCard(mk('f'), { startDate: '2026-10-20', penTimes: many });
const cappedKeys = Object.keys((capped.rec.settings && capped.rec.settings.penTimes) || {});
/* Assert — thirteen collapse to twelve, the last one dropped */
check('thirteen keys collapse to the twelve-key cap', cappedKeys.length === 12, `${cappedKeys.length} keys`);
check('the thirteenth key is the one dropped', !cappedKeys.includes('key12'), cappedKeys.join(', '));

const long = await postCard(mk('g'), { startDate: '2026-10-20', penTimes: { ABCDEFGHIJKLMNOPQRST: '09:00' } });
const longKeys = Object.keys((long.rec.settings && long.rec.settings.penTimes) || {});
/* Assert — a long key is sliced, not rejected */
check('a 20-character key is sliced to 16',
  longKeys.length === 1 && longKeys[0] === 'ABCDEFGHIJKLMNOP' && longKeys[0].length === 16,
  JSON.stringify(longKeys));

/* Arrange — rev movement on change and on removal */
const rev = await postCard(mk('h'), { startDate: '2026-10-20', penTimes: { ghk: '19:30' } });
const rev0 = Number(rev.rec.settings && rev.rec.settings.rev);

/* Act — the same penTimes again (no change, no force) */
const same = await (await fetch(`${BASE}/api/cards/${mk('h')}`, { method: 'PUT', headers: H,
  body: JSON.stringify({ settings: { startDate: '2026-10-20', penTimes: { ghk: '19:30' } } }) })).json();
/* Assert — no bump for an unchanged value */
check('an unchanged penTimes save does not bump the rev',
  Number(same.settings && same.settings.rev) === rev0,
  `${rev0} -> ${same.settings && same.settings.rev}`);

/* Act — a CHANGED value (no force) */
const changed = await (await fetch(`${BASE}/api/cards/${mk('h')}`, { method: 'PUT', headers: H,
  body: JSON.stringify({ settings: { startDate: '2026-10-20', penTimes: { ghk: '20:00' } } }) })).json();
/* Assert — it bumps and adopts the new value */
check('a changed penTimes value bumps the rev without force',
  Number(changed.settings && changed.settings.rev) === rev0 + 1 &&
  changed.settings && changed.settings.penTimes && changed.settings.penTimes.ghk === '20:00',
  `${rev0} -> ${changed.settings && changed.settings.rev} ${JSON.stringify(changed.settings && changed.settings.penTimes)}`);

/* Act — remove penTimes to {} (still a change) */
const removed = await (await fetch(`${BASE}/api/cards/${mk('h')}`, { method: 'PUT', headers: H,
  body: JSON.stringify({ settings: { startDate: '2026-10-20', penTimes: {} } }) })).json();
/* Assert — it bumps again and clears the field */
check('removing penTimes to {} bumps the rev and clears the field',
  Number(removed.settings && removed.settings.rev) === rev0 + 2 &&
  removed.settings && removed.settings.penTimes &&
  Object.keys(removed.settings.penTimes).length === 0,
  `${rev0} -> ${removed.settings && removed.settings.rev} ${JSON.stringify(removed.settings && removed.settings.penTimes)}`);

console.log(bad ? `\n${bad} FAILED` : '\nPASS — penTimes sanitizes its edges: non-objects drop, cap and slice hold, rev moves only on real change.');
process.exit(bad ? 1 : 0);
