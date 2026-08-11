/* ==================================================================
   THE CHARLESTON ATELIER — shared protocol engine
   ------------------------------------------------------------------
   One source of truth for dates, phases, dosing and pen supply, used
   by Today's Ritual, My Protocol and the Calendar. Everything reads
   protocol.json; nothing here is patient-specific.

   Pens are FINITE. A pen is dispensed with a fixed volume, each dose
   draws from it, and when the next dose no longer fits the pen is
   spent — it is not silently replaced. That is what lets the portal
   warn before a refill is needed and stand the card down afterwards.
   ================================================================== */

var CFG = null, PENS = [], START = null;

var DAY_MS = 86400000;
var ML_PER_UNIT = 0.01;              // one unit on the pen dial = 0.01 mL
var REFILL_WARNING_DAYS = 7;         // start asking for a refill this far out
var OPEN_PHASE_HORIZON = 120;        // how far to project an open-ended phase

var DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
var TIME_AT = { Morning:'08:00', Midday:'12:30', Afternoon:'15:00', Evening:'20:00' };

/* ---------- dates (local, no timezone drift) ---------- */
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function parse(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()+n); }
function isoDow(d) { return (d.getDay() + 6) % 7 + 1; }
function today() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function dayIndex(d) { return Math.round((d - START) / DAY_MS); }
function daysBetween(a, b) { return Math.round((b - a) / DAY_MS); }

function fmtLong(d)  { return d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' }); }
function fmtShort(d) { return d.toLocaleDateString(undefined, { month:'short', day:'numeric' }); }
function round(n, p = 2) { return Number(n.toFixed(p)); }

/* ---------- phases ---------- */
function phaseDays(pen) {
  return (pen.phases || []).reduce((n, ph) => n + (ph.days == null ? OPEN_PHASE_HORIZON : ph.days), 0);
}

function phaseOn(pen, date) {
  const i = dayIndex(date);
  if (i < 0) return null;
  let acc = 0;
  for (const ph of pen.phases || []) {
    const len = ph.days == null ? Infinity : ph.days;
    if (i < acc + len) return ph;
    acc += len;
  }
  return null;
}

/* The raw rhythm, before supply is considered: N days on, N days off. */
function scheduledOn(pen, date) {
  const i = dayIndex(date);
  if (i < 0 || i >= phaseDays(pen)) return false;
  const { on, off } = pen.schedule;
  return (i % (on + off)) < on;
}

/* ---------- what a dose delivers ---------- */
function doseOn(pen, date) {
  const ph = phaseOn(pen, date);
  if (!ph) return null;
  const ml = ph.units * ML_PER_UNIT;
  return {
    phase: ph,
    units: ph.units,
    ml,
    components: pen.components.map(c => ({
      name: c.name,
      mg: (c.mg / pen.volumeMl) * ml,
      primary: !!c.dosedTo
    })),
    totalMg: pen.components.reduce((s, c) => s + (c.mg / pen.volumeMl) * ml, 0)
  };
}

function primaryOf(dose) {
  return dose.components.find(c => c.primary) ||
    { name: 'total peptide', mg: dose.components.reduce((s, c) => s + c.mg, 0) };
}

/* ---------- supply ----------
   Draw every scheduled dose from one pen until the next won't fit.
   `lastDose` is the final day this pen can actually be given, which is
   what the schedule and the card status both key off. */
const _supplyCache = new Map();

function supply(pen) {
  if (_supplyCache.has(pen.id)) return _supplyCache.get(pen.id);

  let remaining = pen.volumeMl;
  let lastDose = null, exhaustedOn = null, doses = 0;

  for (let i = 0; i < phaseDays(pen); i++) {
    const d = addDays(START, i);
    if (!scheduledOn(pen, d)) continue;
    const dose = doseOn(pen, d);
    if (!dose) continue;
    if (dose.ml > remaining + 1e-9) { exhaustedOn = d; break; }
    remaining -= dose.ml;
    lastDose = d;
    doses++;
  }

  const out = {
    lastDose,
    exhaustedOn,
    // 'supply' means the pen emptied; 'protocol' means the course simply ended.
    endReason: exhaustedOn ? 'supply' : 'protocol',
    mlLeft: remaining,
    pctLeft: Math.max(0, Math.min(100, (remaining / pen.volumeMl) * 100)),
    totalDoses: doses
  };
  _supplyCache.set(pen.id, out);
  return out;
}

/* Doses still available from today onward. */
function dosesLeft(pen) {
  const t = today(), s = supply(pen);
  if (!s.lastDose) return 0;
  let n = 0;
  for (let i = 0; i < phaseDays(pen); i++) {
    const d = addDays(START, i);
    if (d < t || d > s.lastDose) continue;
    if (scheduledOn(pen, d)) n++;
  }
  return n;
}

/* ---------- active / spent ---------- */
function isActive(pen, date) {
  const s = supply(pen);
  return !!s.lastDose && date <= s.lastDose;
}

function isSpent(pen) {
  const s = supply(pen);
  return !s.lastDose || today() > s.lastDose;
}

/* A pen only appears on the schedule while it is active. */
function isDue(pen, date) {
  return scheduledOn(pen, date) && isActive(pen, date);
}

function dueOn(date) {
  return PENS.filter(p => isDue(p, date));
}

/* Days until the final dose this pen can give. Negative once spent. */
function daysUntilOut(pen) {
  const s = supply(pen);
  return s.lastDose ? daysBetween(today(), s.lastDose) : null;
}

function needsRefill(pen) {
  const s = supply(pen);
  if (s.endReason !== 'supply') return false;      // the course ended, not the pen
  const left = daysUntilOut(pen);
  return left !== null && left <= REFILL_WARNING_DAYS;
}

/* ---------- messaging ---------- */
function smsHref(body) {
  const c = (CFG && CFG.protocol && CFG.protocol.concierge) || {};
  if (!c.phone) return '#';
  const digits = String(c.phone).replace(/\D/g, '');
  const number = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  // iOS wants &body= after the number; Android wants ?body=
  const sep = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) ? '&' : '?';
  return `sms:${number}${sep}body=${encodeURIComponent(body || c.messageOpener || '')}`;
}

function refillHref(pen) {
  const c = (CFG && CFG.protocol && CFG.protocol.concierge) || {};
  const template = c.refillOpener || 'Hi Dr. Phelps-Polirer — I need a refill of my {pen}.';
  return smsHref(template.replace('{pen}', pen.name));
}

/* ---------- start day (device-only) ---------- */
function startKey() { return `tca.start.${CFG.patient.id}`; }
function loadStart() { try { return localStorage.getItem(startKey()); } catch { return null; } }
function saveStart(s) { try { localStorage.setItem(startKey(), s); } catch {} }

function setStart(isoDate) {
  START = parse(isoDate);
  saveStart(isoDate);
  _supplyCache.clear();          // every projection depends on the start day
}

/* ---------- boot ---------- */
async function loadProtocol() {
  CFG = await (await fetch('protocol.json', { cache: 'no-store' })).json();
  PENS = CFG.protocol.pens || [];
  START = parse(loadStart() || CFG.protocol.startDate);
  _supplyCache.clear();
  return CFG;
}
