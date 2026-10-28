/* The engine's instants, pinned rather than assumed: with a per-pen time
   of 21:15, the reminder due list carries 21:15 local on every dosing
   day (sorted, future), the calendar writes 21:15 as a UTC Z instant with
   no floating times, a back-filled dose stamps the 21:15 instant, and the
   state report tells the atelier the same 21:15 — while the supply rows
   stay day-only.

   Playwright, against a file-store service; the card is a named stored
   card, so the suite signs in first (the gate is part of the flow):
     source /tmp/qa-env.sh && BASE=http://localhost:8093 node tests/pen-time-instants.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — a studio session, a one-pen card, and the browser signed in */
const BASE = process.env.BASE || 'http://localhost:8093';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const stamp = Date.now().toString(36);
const slug = `pi${stamp}.t`;
const pad = n => String(n).padStart(2, '0');

await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug, name: 'Instants Test', pens: [{ template: 'ghk' }],
    settings: { startDate: '2026-10-20' } }) });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartPicker(); } catch {} });

/* Act — the patient sets the pen's time to 21:15 */
await p.evaluate(() => { setPenTime(PENS.find(x => x.id === 'ghk'), '21:15'); renderAll(); });
await p.waitForTimeout(500);

/* Assert — every due instant is 21:15 local, sorted and future */
const due = await p.evaluate(() => upcomingDoses(120));
check('the due list carries 21:15 local on every dosing day',
  due.length > 0 && due.every(iso => {
    const d = new Date(iso);
    return d.getHours() === 21 && d.getMinutes() === 15;
  }),
  due.slice(0, 3).join(', '));
check('the instants are sorted and in the future',
  due.join('|') === [...due].sort().join('|') && due.every(iso => Date.parse(iso) > Date.now()),
  `${due.length} instants`);

/* Assert — the calendar writes the same instant as a UTC Z */
const ics = await p.evaluate(() => buildICS());
const dtstart = ics.text.split('\r\n').filter(l => l.startsWith('DTSTART:'));
check('the calendar writes DTSTART instants',
  dtstart.length > 0, `${dtstart.length} event(s)`);
check('every DTSTART is a UTC Z instant, never floating',
  dtstart.every(l => /^DTSTART:\d{8}T\d{6}Z$/.test(l)), dtstart.slice(0, 2).join(', '));
check('no TZID or VTIMEZONE sneaks in',
  !ics.text.includes('TZID') && !ics.text.includes('VTIMEZONE'), 'clean');
/* Every event instant must land at 21:15 on the patient's local clock —
   the UTC representation shifts with her timezone, the wall-clock must
   not. */
const first = dtstart[0].slice('DTSTART:'.length);                 // YYYYMMDDTHHMMSSZ
const evUtc = new Date(Date.UTC(
  Number(first.slice(0, 4)), Number(first.slice(4, 6)) - 1, Number(first.slice(6, 8)),
  Number(first.slice(9, 11)), Number(first.slice(11, 13)), 0));
check('every event instant is 21:15 on the patient\'s local clock',
  dtstart.every(l => {
    const s = l.slice('DTSTART:'.length);
    const u = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)),
      Number(s.slice(9, 11)), Number(s.slice(11, 13)), 0));
    const local = new Date(u.getTime());
    return local.getHours() === 21 && local.getMinutes() === 15;
  }),
  `${first} → local ${evUtc.getHours()}:${pad(evUtc.getMinutes())}`);

/* Assert — a back-filled dose stamps the 21:15 instant */
const back = await p.evaluate(() => {
  const pen = PENS.find(x => x.id === 'ghk');
  const d = addDays(today(), -1);
  return scheduledInstant(pen, d);
});
const backLocal = new Date(back);
check('a back-filled dose carries the per-pen time',
  backLocal.getHours() === 21 && backLocal.getMinutes() === 15, back);

/* Act — report the state, and read the dashboard's copy */
await p.evaluate(() => reportState(true));
await p.waitForTimeout(800);
const rec = await (await fetch(`${BASE}/api/cards/${slug}`, { headers: H })).json();
const row = (rec.state && rec.state.today || []).find(r => r.template === 'ghk');
const sup = (rec.state && rec.state.supply || []).find(r => r.template === 'ghk');
/* Assert — the atelier reads 21:15 in today, and no time in supply */
check('the state report carries the resolved per-pen time',
  row && row.at === '21:15', row && JSON.stringify(row.at));
check('the supply rows stay day-only',
  sup && !('at' in sup) && !('time' in sup), JSON.stringify(Object.keys(sup || {})));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — due list, calendar, back-fill and report all speak the one resolved time.');
process.exit(bad ? 1 : 0);
