/* The engine's instant edges, pinned rather than assumed:
   two pens carry two DIFFERENT per-pen times into both the due list and
   the calendar, the 120-day window bounds every instant (past-now
   excluded, past-horizon excluded, the final day included), the calendar
   fingerprint moves when ONLY the time changes (so the stale-calendar
   notice fires), and a blank timeFor falls back to 09:00 rather than
   building an invalid instant.

   Playwright, against a file-store service; the cards are named stored
   cards, so the suite signs in first (the gate is part of the flow):
     source /tmp/qa-env.sh && BASE=http://localhost:8093 node tests/pen-time-instants-edge.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, the harness, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8093';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const mk = (suf, pens, settings) => {
  const slug = `pie${suf}${stamp}.t`;
  return fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
    body: JSON.stringify({ slug, name: `Instants Edge ${suf}`, pens, settings }) })
    .then(r => r.json()).then(() => slug);
};

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);

const open = async (slug, want = 1) => {
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(n => typeof PENS !== 'undefined' && PENS.length >= n, want, { timeout: 15000 });
  await p.evaluate(() => { try { closeStartPicker(); } catch {} });
  await p.waitForTimeout(300);
};

/* ---------- gap 1: per-pen instant independence ---------- */
/* Arrange — one ghk (Evening) and one nadvial (Morning), patient times apart */
const c1 = await mk('1', [{ template: 'ghk' }, { template: 'nadvial' }],
  { startDate: todayIso });
await open(c1, 2);

/* Act — the patient gives each pen its own clock time */
await p.evaluate(() => {
  setPenTime(PENS.find(x => x.id === 'ghk'), '21:15');
  setPenTime(PENS.find(x => x.id === 'nadvial'), '06:45');
  renderAll();
});
await p.waitForTimeout(400);

/* Assert — the due list carries BOTH times, and nothing else */
const s1 = await p.evaluate(() => {
  const p2 = n => String(n).padStart(2, '0');
  const rows = upcomingDoses(120).map(iso => {
    const d = new Date(iso);
    return { iso, hm: `${p2(d.getHours())}:${p2(d.getMinutes())}`, day: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` };
  });
  const hms = new Set(rows.map(r => r.hm));
  const daysA = new Set(rows.filter(r => r.hm === '21:15').map(r => r.day));
  const daysB = new Set(rows.filter(r => r.hm === '06:45').map(r => r.day));
  return {
    hms: [...hms].sort(),
    n215: daysA.size, n645: daysB.size,
    overlap: [...daysA].filter(d => daysB.has(d)).slice(0, 5)
  };
});
check('the due list carries both pens\' own times, nothing else',
  s1.hms.length === 2 && s1.hms.includes('21:15') && s1.hms.includes('06:45'),
  s1.hms.join(', '));
check('each time lands on its own days', s1.n215 > 0 && s1.n645 > 0, `${s1.n215} / ${s1.n645} days`);
check('the two times coexist on shared calendar days (independence)',
  s1.overlap.length > 0, s1.overlap.join(', '));

/* Assert — the calendar writes both times distinctly */
const s1ics = await p.evaluate(() => {
  const p2 = n => String(n).padStart(2, '0');
  const hms = new Set();
  buildICS().text.split('\r\n').filter(l => l.startsWith('DTSTART:')).forEach(l => {
    const s = l.slice('DTSTART:'.length);
    const u = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), 0));
    const local = new Date(u.getTime());
    hms.add(`${p2(local.getHours())}:${p2(local.getMinutes())}`);
  });
  return [...hms].sort();
});
check('the calendar carries both times distinctly',
  s1ics.length === 2 && s1ics.includes('21:15') && s1ics.includes('06:45'),
  s1ics.join(', '));

/* ---------- gap 2: horizon boundaries ---------- */
/* Arrange — a daily ghk at 00:00, dosed tiny so its supply reaches the horizon */
const c2 = await mk('2', [{ template: 'ghk', phases: [{ name: 'Tiny', units: 1, days: 400 }] }],
  { startDate: todayIso });
await open(c2, 1);
await p.evaluate(() => { setPenTime(PENS.find(x => x.id === 'ghk'), '00:00'); renderAll(); });
await p.waitForTimeout(300);

/* Act — read the due list and measure it against the page's own now/horizon */
const s2 = await p.evaluate(() => {
  const before = Date.now();
  const due = upcomingDoses(120);
  const after = Date.now();
  const horizon = addDays(new Date(), 120).getTime();
  const ts = due.map(iso => Date.parse(iso));
  return {
    n: due.length,
    allFuture: ts.every(t => t > before),
    allWithin: ts.every(t => t <= horizon),
    max: ts.length ? Math.max(...ts) : null,
    horizon,
    first: due[0], last: due[due.length - 1]
  };
});
/* Assert — everything is future, nothing past the horizon, and the final
   allowed day is included (its 00:00 instant lands within 24h of the
   horizon regardless of the time of day the suite runs at) */
check('every instant is in the future (exactly-now excluded)', s2.allFuture && s2.n > 0, s2.first);
check('every instant is at-or-before now+120d', s2.allWithin, s2.last);
check('the final allowed dosing day is included',
  s2.max !== null && s2.max > s2.horizon - 24 * 3600 * 1000 && s2.max <= s2.horizon,
  `${s2.max} vs horizon ${s2.horizon}`);

/* ---------- gap 3: the calendar fingerprint moves on a time-only change ---------- */
/* Arrange — a daily ghk with doses, and a downloaded calendar seeded to its
   current fingerprint (not subscribed, so the stale check applies) */
const c3 = await mk('3', [{ template: 'ghk' }], { startDate: todayIso });
await open(c3, 1);
const s3 = await p.evaluate(() => {
  const sig0 = icsSignature();
  localStorage.setItem(icsKey(), JSON.stringify({ uids: ['seed-uid'], seq: 1, sig: sig0, subscribed: false }));
  return { sig0, staleBefore: icsStale() };
});
check('a downloaded calendar matching the schedule is not stale',
  s3.staleBefore === false, `sig ${s3.sig0}`);

/* Act — change ONLY the time */
await p.evaluate(() => { setPenTime(PENS.find(x => x.id === 'ghk'), '21:15'); renderAll(); });
await p.waitForTimeout(300);

/* Assert — the fingerprint moved and the stale notice now fires */
const s3b = await p.evaluate(() => ({ sig1: icsSignature(), staleAfter: icsStale() }));
check('the fingerprint changes when only the time changes',
  s3b.sig1 !== s3.sig0, `${s3.sig0} -> ${s3b.sig1}`);
check('a calendar whose issued sig predates the change flips stale',
  s3b.staleAfter === true, `stale ${s3b.staleAfter}`);

/* ---------- gap 4: scheduledInstant falls back when timeFor is blank ---------- */
/* Arrange — the band leg of timeFor can never emit '' (its own `|| '09:00'`
   guarantees a truthy return), so the blank is forced by stubbing the global
   timeFor in-page — the same reachable-hook pattern push-ui uses. */
const c4 = await mk('4', [{ template: 'ghk' }], { startDate: todayIso });
await open(c4, 1);
const s4 = await p.evaluate(() => {
  const pen = PENS.find(x => x.id === 'ghk');
  const d = today();
  const orig = window.timeFor;
  window.timeFor = () => '';
  let out;
  try {
    const iso = scheduledInstant(pen, d);
    const dd = new Date(iso);
    out = { ok: !isNaN(dd.getTime()), h: dd.getHours(), m: dd.getMinutes(), iso };
  } catch (e) {
    out = { ok: false, threw: e.message };
  } finally {
    window.timeFor = orig;
  }
  return out;
});
/* Assert — the '09:00' fallback is used, never an invalid instant */
check('a blank timeFor falls back to 09:00, never an invalid instant',
  s4.ok === true && s4.h === 9 && s4.m === 0, JSON.stringify(s4));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — per-pen instants stay apart, the window bounds hold, the fingerprint moves on time alone, and a blank time falls back to 09:00.');
process.exit(bad ? 1 : 0);
