/* ==================================================================
   WHAT IS LEFT IN EACH PEN
   ------------------------------------------------------------------
   Moved out of the dashboard's own script so there is one answer to
   "is she out of it", given to the dashboard and to the read-only
   overview alike. Two copies of this arithmetic would be two copies
   free to disagree, and the one that disagreed would be the one
   telling the atelier a patient had a fortnight left.

   TWO SOURCES, AND WHY
   --------------------
   A prescribed pen is projected from the prescription and the start
   day. It does not wait to be told: a patient who has not opened her
   card in a fortnight is exactly the one whose pen quietly ran out.

   A vial she sizes herself — tirzepatide, the NAD vial — cannot be
   projected from here at all. The prescription does not say how big
   it is or how often she draws from it; her card asks her and knows.
   So her card's own report wins where it exists, and the date it
   carries is absolute, which means an old report is still right: the
   day a pen runs dry does not move unless the protocol does, and when
   the protocol moves her card reports again.
   ================================================================== */

const fs = require('node:fs');
const path = require('node:path');

const ML_PER_UNIT = 0.01;
/* How many days before a pen runs dry counts as "order one". */
const LOW_DAYS = 10;

/* Templates state the dose in milligrams; the pen is dialled in units.
   The card and the dashboard both resolve one to the other before using
   it, and so must this — reading the file raw gives phases with no units
   in them, every pen then measures as lasting no days at all, and the
   whole list quietly reports that nobody is ever short of anything.

   The floor is deliberate and matches the engine: it never dials past a
   prescribed dose. */
function perMlOf(t) {
  if (t.vialMg && t.diluentMl) return t.vialMg / t.diluentMl;
  const total = (t.components || []).reduce((s, c) => s + c.mg, 0);
  return total / (t.volumeMl || 1);
}

function resolveDoses(list) {
  list.forEach(t => {
    const c = perMlOf(t);
    (t.phases || []).forEach(ph => {
      if (ph.units == null && ph.mg != null && c) ph.units = Math.floor(ph.mg / c / ML_PER_UNIT);
    });
  });
  return list;
}

let _templates = null;
function templates(webRoot) {
  if (_templates) return _templates;
  try {
    const file = path.join(webRoot, 'templates.json');
    _templates = resolveDoses(JSON.parse(fs.readFileSync(file, 'utf8')).templates || []);
  } catch { _templates = []; }
  return _templates;
}

/* How long one pen lasts, in days from its own first dose: step through
   the schedule drawing each phase's units until the next one will not
   fit in what is left of the vial. */
/* `upTo` stops the walk after that many days, which is how many doses a
   patient is through rather than how many the pen holds. */
/* The cycle length and how many of its days are "on". A weekly schedule is
   one day in seven; an on/off schedule is on with the rest off. */
function scheduleOf(t) {
  const sc = t.schedule || { on: 7, off: 0 };
  return sc.weekly ? { cyc: 7, on: 1 } : { cyc: sc.on + sc.off, on: sc.on };
}

/* Where each phase ends, and how many days the walk covers. A phase with no
   day count runs to the pen's own end; `upTo` stops the walk early. */
function phaseEnds(phases, upTo) {
  let bound = 0;
  const ends = (phases || []).map(ph => (bound += (ph.days == null ? 3650 : ph.days)));
  return { ends, bound: upTo == null ? bound : Math.min(bound, upTo) };
}

/* Whether the schedule draws on day `i`. */
function drawsOn(i, cyc, on) { return i % cyc < on; }

function penLife(t, phases, upTo) {
  const vol = t.volumeMl || 3;
  const { cyc, on } = scheduleOf(t);
  const { ends, bound } = phaseEnds(phases, upTo);
  let ml = vol, doses = 0, last = 0;
  for (let i = 0; i < bound; i++) {
    if (!drawsOn(i, cyc, on)) continue;
    const pi = ends.findIndex(e => i < e);
    if (pi === -1) break;
    const u = Number(phases[pi].units) || 0;
    if (!u) break;
    if (u * ML_PER_UNIT > ml + 1e-9) break;
    ml -= u * ML_PER_UNIT; doses++; last = i + 1;
  }
  return { days: last, doses, left: ml };
}

/* The start day the patient is actually on.

   Three places hold one and they are not the same: the card's own
   startDate is what was typed in Card Studio, settings.startDate is what
   was sent to her phone, and state.startDate is what her phone says it
   is using — which wins, because she can move it herself. */
function effectiveStart(rec) {
  return (rec.state && rec.state.startDate)
      || (rec.settings && rec.settings.startDate)
      || rec.startDate || null;
}

function supplyFor(rec, webRoot, now = Date.now()) {
  const list = templates(webRoot);
  const seen = new Set();
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const tally = supplyTally(midnight);

  addStateSupply(rec.state, list, seen, tally, midnight);

  const startDate = effectiveStart(rec);
  const elapsed = elapsedDays(startDate, midnight);
  addProjectedPens(rec, list, seen, startDate, elapsed, tally);

  return { out: tally.out, low: tally.low, pens: tally.pens, unknown: unknownOf(rec, list, seen) };
}

/* Days from today's midnight to `isoDay`; negative when `isoDay` is past.
   This is the run-out direction: a pen whose last dose was a fortnight ago
   reports -14 and lands in `out`. */
function daysUntil(isoDay, midnight) {
  return Math.round((new Date(isoDay + 'T00:00:00') - midnight) / 86400000);
}

/* Days from `isoDay` to today's midnight; positive when `isoDay` is past.
   This is the elapsed direction: a start day a fortnight ago reports 14. */
function daysSince(isoDay, midnight) {
  return -daysUntil(isoDay, midnight);
}

/* The ISO day `days` after `midnight`. */
function isoDayAfter(midnight, days) {
  const d = new Date(midnight); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function templateName(list, id) {
  const t = list.find(x => x.id === id);
  return t ? t.name : id;
}

/* Every pen lands in `pens` with its own numbers, whether or not it is
   short — the dashboard shows the run-out date for all of them, and a
   column that only fills in once something is wrong is a column nobody
   learns to read. */
function supplyTally(midnight) {
  const out = [], low = [], pens = [];
  const add = (name, days, dosesLeft, runsOut) => {
    pens.push({ name, days, dosesLeft: dosesLeft == null ? null : dosesLeft,
                runsOut: runsOut || (days == null ? null : isoDayAfter(midnight, days)) });
    if (days == null) return;
    if (days <= 0) out.push(name);
    else if (days <= LOW_DAYS) low.push({ name, days });
  };
  return { out, low, pens, add };
}

/* What her phone last reported. Her own report wins where it exists: it
   knows the vials she sizes herself, which this end cannot project. */
function addStateSupply(state, list, seen, tally, midnight) {
  for (const s of (state && state.supply) || []) {
    seen.add(s.template);
    const name = templateName(list, s.template);
    if (s.lastDose) {
      tally.add(name, daysUntil(s.lastDose, midnight), s.dosesLeft, s.lastDose);
    } else if (!s.dosesLeft) {
      tally.add(name, 0, 0, null);
    } else {
      tally.add(name, null, s.dosesLeft, null);
    }
  }
}

/* A vial she sizes herself cannot be projected from here, and saying
   nothing is better than saying a number that is not hers. */
function projectableTemplate(list, pen) {
  const t = list.find(x => x.id === pen.template);
  return (!t || t.setup) ? null : t;
}

function elapsedDays(startDate, midnight) {
  if (!startDate) return null;
  return daysSince(startDate, midnight);
}

/* How a pen stands once `elapsed` days have passed: the whole life, the
   days still to come, and the doses she has not reached yet. */
function movementFor(pen, t, elapsed) {
  const phases = pen.phases || t.phases || [];
  const L = penLife(t, phases);
  if (!L.days) return null;
  const taken = penLife(t, phases, Math.max(0, elapsed)).doses;
  return { totalDays: L.days, days: L.days - elapsed, dosesLeft: Math.max(0, L.doses - taken) };
}

function addProjectedPens(rec, list, seen, startDate, elapsed, tally) {
  for (const pen of rec.pens || []) {
    if (seen.has(pen.template)) continue;
    const t = projectableTemplate(list, pen);
    if (!t) continue;
    if (elapsed == null || elapsed < 0) continue;
    const m = movementFor(pen, t, elapsed);
    if (!m) continue;
    tally.add(t.name, m.days, m.dosesLeft,
              startDate ? addDaysIso(startDate, m.totalDays) : null);
  }
}

function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Named separately from "fine". A vial she sets up herself, on a card she
   has never opened, has no supply anyone can state — and a blank where a
   warning would go reads as "she is fine", which is the one thing it does
   not mean. */
function unknownOf(rec, list, seen) {
  return (rec.pens || [])
    .filter(p => !seen.has(p.template))
    .map(p => list.find(x => x.id === p.template))
    .filter(t => t && t.setup)
    .map(t => t.name);
}

module.exports = { supplyFor, penLife, effectiveStart, LOW_DAYS, ML_PER_UNIT };
