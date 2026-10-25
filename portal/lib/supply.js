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
function penLife(t, phases) {
  const vol = t.volumeMl || 3;
  const sc = t.schedule || { on: 7, off: 0 };
  const cyc = sc.weekly ? 7 : (sc.on + sc.off);
  const on = sc.weekly ? 1 : sc.on;
  let bound = 0;
  const ends = (phases || []).map(ph => (bound += (ph.days == null ? 3650 : ph.days)));
  let ml = vol, doses = 0, last = 0;
  for (let i = 0; i < bound; i++) {
    if (i % cyc >= on) continue;
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
  const nameOf = id => { const t = list.find(x => x.id === id); return t ? t.name : id; };
  const out = [], low = [], seen = new Set();

  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const place = (name, days) => {
    if (days <= 0) out.push(name);
    else if (days <= LOW_DAYS) low.push({ name, days });
  };

  for (const s of (rec.state && rec.state.supply) || []) {
    seen.add(s.template);
    const name = nameOf(s.template);
    if (s.lastDose) {
      place(name, Math.round((new Date(s.lastDose + 'T00:00:00') - midnight) / 86400000));
    } else if (!s.dosesLeft) {
      out.push(name);
    }
  }

  const startDate = effectiveStart(rec);
  if (!startDate) return { out, low, unknown: unknownOf(rec, list, seen) };
  const elapsed = Math.round((midnight - new Date(startDate + 'T00:00:00')) / 86400000);
  if (elapsed < 0) return { out, low, unknown: unknownOf(rec, list, seen) };

  for (const pen of rec.pens || []) {
    if (seen.has(pen.template)) continue;
    const t = list.find(x => x.id === pen.template);
    // A vial she sizes herself cannot be projected from here, and saying
    // nothing is better than saying a number that is not hers.
    if (!t || t.setup) continue;
    const L = penLife(t, pen.phases || t.phases || []);
    if (!L.days) continue;
    place(t.name, L.days - elapsed);
  }
  return { out, low, unknown: unknownOf(rec, list, seen) };
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
