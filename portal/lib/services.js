/* ==================================================================
   AESTHETIC TREATMENTS
   ------------------------------------------------------------------
   What the atelier gives in the room, as opposed to the peptides a
   patient takes at home. A card can carry both, and they behave quite
   differently: a pen runs from a start day and empties, a treatment
   happens on a date and sets up the next one.

   So this keeps a list of visits — what was given, and when — and the
   cadence decides when the next is due. The record is the list; the due
   date is always derived, never stored, because the moment a visit moves
   a stored due date is wrong and nothing would say so.
   ================================================================== */

const fs = require('node:fs');
const path = require('node:path');

let _catalogue = null;
function catalogue() {
  if (_catalogue) return _catalogue;
  try {
    const file = path.join(__dirname, '..', 'services.json');
    _catalogue = JSON.parse(fs.readFileSync(file, 'utf8')).services || [];
  } catch { _catalogue = []; }
  return _catalogue;
}

function serviceById(id) { return catalogue().find(s => s.id === id) || null; }

function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Only what a visit is allowed to carry. The tag is public and a POST is
   a POST, so anything beyond these is dropped rather than stored. */
function sanitizeVisit(v) {
  if (!v || typeof v.service !== 'string') return null;
  if (!serviceById(v.service)) return null;          // not on the menu
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) return null;
  const out = { service: v.service, date: v.date };
  if (v.area) out.area = String(v.area).slice(0, 60);
  if (v.note) out.note = String(v.note).slice(0, 200);
  if (v.units != null && Number.isFinite(Number(v.units))) out.units = Number(v.units);
  return out;
}

function sanitizeVisits(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, 200).map(sanitizeVisit).filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* When the next one is due, from the visits already on the record.

   `firstGaps` carries the opening sessions of a course — PRX is weekly
   four times and then monthly, so the gap after the first three visits is
   seven days and every gap after that is thirty. `courseOf` ends a course
   rather than repeating forever: three polynucleotide sessions is a
   protocol, not a subscription.

   A service with no cadence returns nothing at all. Filler is reviewed at
   follow-up, and inventing a date for it would put a reminder in a
   patient's calendar that the atelier never intended. */
function nextDue(serviceId, visits, now = Date.now()) {
  const s = serviceById(serviceId);
  if (!s) return null;

  const mine = (visits || []).filter(v => v.service === serviceId)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!mine.length) return null;                      // never had one

  const n = mine.length;
  const last = mine[n - 1].date;

  if (s.courseOf && n >= s.courseOf) {
    return { done: true, course: `${n} of ${s.courseOf}`, last };
  }

  const gaps = s.firstGaps || [];
  const gap = n <= gaps.length ? gaps[n - 1] : s.everyDays;
  if (!gap) return { none: true, last };              // no cadence by design

  const due = addDaysIso(last, gap);
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(due + 'T00:00:00') - midnight) / 86400000);

  return {
    due, days, last,
    overdue: days < 0,
    soon: days >= 0 && days <= 7,
    // A range where one exists, so the reminder lands at the start of the
    // window rather than at the end of it.
    window: s.windowDays ? [addDaysIso(last, s.windowDays[0]), addDaysIso(last, s.windowDays[1])] : null,
    course: s.courseOf ? `${n} of ${s.courseOf}` : null,
    session: n
  };
}

/* Every service this card has ever had, with where it stands. */
function servicesFor(rec, now = Date.now()) {
  const visits = rec.visits || [];
  const ids = [...new Set(visits.map(v => v.service))];
  return ids.map(id => {
    const s = serviceById(id);
    return {
      id,
      name: s ? s.name : id,
      color: s ? s.color : '',
      hex: s ? s.hex : '',
      count: visits.filter(v => v.service === id).length,
      next: nextDue(id, visits, now)
    };
  }).sort((a, b) => {
    // Anything overdue first, then soonest, then the rest.
    const rank = x => x.next && x.next.overdue ? 0 : x.next && x.next.days != null ? 1 : 2;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const da = a.next && a.next.days, db = b.next && b.next.days;
    if (da == null || db == null) return 0;
    return da - db;
  });
}

module.exports = { catalogue, serviceById, sanitizeVisits, sanitizeVisit, nextDue, servicesFor, addDaysIso };
