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
/* A pen the patient added part-way through carries its own start day, so its
   phases count from the day it was added rather than from the protocol's. */
function penStart(pen) { return pen && pen.startDate ? parse(pen.startDate) : START; }
function dayIndex(d, pen) { return Math.round((d - penStart(pen)) / DAY_MS); }
function daysBetween(a, b) { return Math.round((b - a) / DAY_MS); }

function fmtLong(d)  { return d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' }); }
function fmtShort(d) { return d.toLocaleDateString(undefined, { month:'short', day:'numeric' }); }
function round(n, p = 2) { return Number(n.toFixed(p)); }

/* ---------- phases ---------- */
function phaseDays(pen) {
  return (pen.phases || []).reduce((n, ph) => n + (ph.days == null ? OPEN_PHASE_HORIZON : ph.days), 0);
}

function phaseOn(pen, date) {
  const i = dayIndex(date, pen);
  if (i < 0) return null;
  let acc = 0;
  for (const ph of pen.phases || []) {
    const len = ph.days == null ? Infinity : ph.days;
    if (i < acc + len) return ph;
    acc += len;
  }
  return null;
}

/* The raw rhythm, before supply is considered. Either a rolling N-on/N-off
   cycle, or one fixed weekday a week — tirzepatide is dosed weekly on a day
   the patient chooses. */
function scheduledOn(pen, date) {
  const i = dayIndex(date, pen);
  if (i < 0 || i >= phaseDays(pen)) return false;
  if (pen.schedule.weekly) return isoDow(date) === (pen.schedule.day || 1);
  const { on, off } = pen.schedule;
  return (i % (on + off)) < on;
}

var WEEKDAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

/* How the rhythm reads on the page — a cycle, or the one day a week. */
function freqText(pen) {
  if (pen.schedule.weekly) return `Once a week · ${WEEKDAY_NAMES[(pen.schedule.day || 1) - 1]}`;
  // A cycle with no days off is every day, and should say so — "7 days on
  // / 0 off" is arithmetic, not an instruction.
  if (!pen.schedule.off) return 'Every day';
  return `${pen.schedule.on} days on / ${pen.schedule.off} off`;
}

function freqShort(pen) {
  if (pen.schedule.weekly) return `Weekly · ${DOW[(pen.schedule.day || 1) - 1]}`;
  if (!pen.schedule.off) return 'Daily';
  return `${pen.schedule.on} on / ${pen.schedule.off} off`;
}

/* ---------- patient setup ----------
   Some items need the patient to answer a question before the schedule can
   be drawn: which vial she was given, whether she follows the printed guide
   or carries her own number of units, and which day she injects. Her answers
   live on the device, next to her start day. */
function setupKey(pen) { return `tca.setup.${CFG.patient.id}.${pen.id}`; }

function loadSetup(pen) {
  try { return JSON.parse(localStorage.getItem(setupKey(pen))) || null; } catch { return null; }
}

function saveSetup(pen, data) {
  try { localStorage.setItem(setupKey(pen), JSON.stringify(data)); } catch {}
  applySetup(pen, data);
  _supplyCache.clear();
}

function needsSetup(pen) { return !!pen.setup && !loadSetup(pen); }

/* She has reached the end of the vial and wants to carry on. Same dose,
   same day, same climb — one more vial's worth of supply. */
function addVial(pen) {
  const data = loadSetup(pen);
  if (!data) return false;
  data.vials = Math.max(1, Number(data.vials) || 1) + 1;
  saveSetup(pen, data);
  return true;
}

/* Is today the last dose this supply can give? */
function onLastDose(pen, date) {
  const s = supply(pen);
  return !!(s.lastDose && date && s.lastDose.getTime() === date.getTime());
}

/* Fold the patient's answers into the pen the rest of the engine sees. */
function applySetup(pen, data) {
  if (!data) return;

  // Vials are 1 mL. A patient who has finished one and opened another is
  // still on the same protocol — only the supply resets, so count the
  // vials rather than restarting her schedule.
  const vials = Math.max(1, Number(data.vials) || 1);
  const oneVial = data.vialMl || pen.volumeMl || 1;
  pen.volumeMl = oneVial * vials;
  pen.vialMl = oneVial;
  pen.vials = vials;
  if (pen.concentrationMgPerMl && pen.components.length === 1) {
    pen.components[0].mg = pen.concentrationMgPerMl * pen.volumeMl;
  }

  if (data.day) pen.schedule = Object.assign({}, pen.schedule, { weekly: true, day: data.day });

  if (data.mode === 'guide' && pen.guide) {
    pen.phases = JSON.parse(JSON.stringify(pen.guide));
  } else if (data.mode === 'own' && data.units) {
    pen.phases = ownPhases(pen, data.units, Number(data.stepUp) || 0);
  }
}

/* A patient carrying her own number of units may also be climbing: she
   picks a starting dose and how many units to add each week. Build that
   as one phase per week, and hold at the ceiling rather than climbing
   past it — the schedule should never walk her above the atelier's limit
   on its own. */
function ownPhases(pen, start, stepUp) {
  const max = pen.maxUnits || 50;
  if (!stepUp) return [{ name: 'Your dose', units: start, days: 364 }];

  const out = [];
  let units = start;
  for (let week = 1; week <= 52; week++) {
    if (units + stepUp > max) {
      // The last climb would overshoot: hold here for good.
      out.push({ name: week === 1 ? 'Your dose' : `Week ${week}+`, units, days: 364 });
      return out;
    }
    out.push({ name: `Week ${week}`, units, days: 7 });
    units += stepUp;
  }
  out.push({ name: 'Hold', units: Math.min(units, max), days: 364 });
  return out;
}

function applySetups() {
  PENS.forEach(pen => { const s = loadSetup(pen); if (s) applySetup(pen, s); });
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

  const t = today();
  let remaining = pen.volumeMl;
  let drawnSoFar = 0;                  // what today's dose has already used up
  let lastDose = null, exhaustedOn = null, doses = 0;

  for (let i = 0; i < phaseDays(pen); i++) {
    const d = addDays(penStart(pen), i);
    if (!scheduledOn(pen, d)) continue;
    const dose = doseOn(pen, d);
    if (!dose) continue;
    if (dose.ml > remaining + 1e-9) { exhaustedOn = d; break; }
    remaining -= dose.ml;
    if (d < t) drawnSoFar += dose.ml;
    lastDose = d;
    doses++;
  }

  // The gauge shows what is in the pen NOW, not what will be left when the
  // course ends — those are different numbers on a pen that empties exactly.
  const mlNow = Math.max(0, pen.volumeMl - drawnSoFar);

  const out = {
    lastDose,
    exhaustedOn,
    // 'supply' means the pen emptied; 'protocol' means the course simply ended.
    endReason: exhaustedOn ? 'supply' : 'protocol',
    mlLeft: mlNow,
    pctLeft: Math.max(0, Math.min(100, (mlNow / pen.volumeMl) * 100)),
    mlAtEnd: remaining,
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
    const d = addDays(penStart(pen), i);
    if (d < t || d > s.lastDose) continue;
    if (scheduledOn(pen, d)) n++;
  }
  return n;
}

/* Every day this pen is actually given: in phase, on the rhythm, and still
   within what the pen holds. The calendar export and the adherence figure
   both count from this list. */
function occurrences(pen) {
  const out = [], s = supply(pen);
  if (!s.lastDose) return out;
  for (let i = 0; i < phaseDays(pen); i++) {
    const d = addDays(penStart(pen), i);
    if (d > s.lastDose) break;
    if (scheduledOn(pen, d) && doseOn(pen, d)) out.push(d);
  }
  return out;
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

/* ---------- delivery ----------
   A pen is dialled to a number; a vial is drawn up with a syringe. The verb
   and the steps both change, and the dose number means the same thing. */
function isSyringe(pen) { return pen.delivery === 'syringe'; }

function dialLead(pen) {
  return isSyringe(pen) ? 'Draw up to' : 'Turn your pen to';
}

/* What the medication actually comes in — a pen she dials, or a vial she draws
   from. The copy follows the thing in her hand. */
function vessel(pen) { return isSyringe(pen) ? 'vial' : 'pen'; }

function stepsFor(pen) {
  const p = CFG.protocol;
  // A template may name its own step list — a fridge item must not tell the
  // patient to thaw it, which the freezer wording of the default would.
  if (pen.stepsKey && p[pen.stepsKey]) return p[pen.stepsKey];
  return isSyringe(pen)
    ? (p.injectionStepsSyringe || p.injectionSteps || [])
    : (p.injectionSteps || []);
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
/* ---------- the hour she takes it ----------
   The template says Morning or Evening; only the patient knows what that
   means for her. Her answer lives beside her start day and is what the
   calendar reminders are set to. */
function timesKey() { return `tca.times.${CFG.patient.id}`; }

function loadTimes() {
  try { return JSON.parse(localStorage.getItem(timesKey())) || {}; } catch { return {}; }
}

function saveTimes(map) {
  try { localStorage.setItem(timesKey(), JSON.stringify(map || {})); } catch {}
}

/* The clock time for a pen: hers if she set one, otherwise the band default. */
function timeFor(pen) {
  const mine = loadTimes();
  return mine[pen.time] || TIME_AT[pen.time] || '09:00';
}

/* Which bands this protocol actually uses — a morning pair and an evening
   pair means two questions, not four. */
function timeBands() {
  const seen = [];
  PENS.forEach(p => { if (p.time && !seen.includes(p.time)) seen.push(p.time); });
  return seen;
}

/* "07:30" -> "7:30 am", for reading back on the page. */
function prettyTime(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (isNaN(h)) return '';
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

function startKey() { return `tca.start.${CFG.patient.id}`; }
function loadStart() { try { return localStorage.getItem(startKey()); } catch { return null; } }
function saveStart(s) { try { localStorage.setItem(startKey(), s); } catch {} }

function setStart(isoDate) {
  START = parse(isoDate);
  saveStart(isoDate);
  _supplyCache.clear();          // every projection depends on the start day
}

/* ---------- card payloads ----------
   A tap card carries its own protocol in the URL fragment, so a card can
   be written at the end of a visit with no server and no record to keep.
   The fragment never reaches the web server — it stays on the device.

   Compact on purpose: an NTAG213 sticker holds ~130 characters of URL. */
/* Format:  Name~pen~pen        e.g.  Dustin~wol
            pen = short  |  short:units-days.units-days
   Phase names and any titration matching the template are left out — they
   are already on the site. An NTAG213 holds roughly 130 characters of URL,
   and this keeps a typical card well inside that. */
function encodeCard(cfg, templates) {
  const byId = Object.fromEntries((templates.templates || []).map(t => [t.id, t]));

  const pens = (cfg.protocol.pens || []).map(pen => {
    const base = byId[pen.templateId || pen.id];
    const key = (base && base.short) || pen.short || pen.id;
    const phases = pen.phases.map(ph => `${ph.units}-${ph.days == null ? 0 : ph.days}`).join('.');
    const stock = base
      ? base.phases.map(ph => `${ph.units}-${ph.days == null ? 0 : ph.days}`).join('.')
      : null;
    return phases === stock ? key : `${key}:${phases}`;   // default titration needs no numbers
  });

  const parts = [cfg.patient.name, ...pens].join('~');
  return encodeURIComponent(parts).replace(/%20/g, '+');
}

function decodeCard(payload, templates, startOverride) {
  // Cards written before the compact format used base64 JSON — still honoured.
  if (/^eyJ/.test(payload)) return decodeLegacyCard(payload, templates);

  const parts = decodeURIComponent(payload.replace(/\+/g, ' ')).split('~');
  const name = parts.shift() || 'Patient';
  const wasNamed = !!name && name !== 'Patient';
  const byKey = {};
  (templates.templates || []).forEach(t => { byKey[t.short] = t; byKey[t.id] = t; });

  const pens = parts.map(chunk => {
    const [key, spec] = chunk.split(':');
    const base = byKey[key];
    if (!base) return null;
    if (!spec) return JSON.parse(JSON.stringify(base));

    const phases = spec.split('.').map((s, i) => {
      const [units, days] = s.split('-').map(Number);
      const named = base.phases[i];
      return { name: named ? named.name : `Phase ${i + 1}`, units, days: days || null };
    });
    return Object.assign(JSON.parse(JSON.stringify(base)), { phases });
  }).filter(Boolean);

  const built = buildConfig(name, pens, templates, startOverride);
  built.patient.named = wasNamed;
  return built;
}

function decodeLegacyCard(payload, templates) {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const small = JSON.parse(decodeURIComponent(escape(atob(b64))));
  const byId = Object.fromEntries((templates.templates || []).map(t => [t.id, t]));
  const pens = (small.p || []).map(p => {
    const base = byId[p.t];
    if (!base) return null;
    return Object.assign(JSON.parse(JSON.stringify(base)), {
      phases: p.f.map(([name, units, days]) => ({ name, units, days: days || null }))
    });
  }).filter(Boolean);
  return buildConfig(small.n, pens, templates, small.s);
}

function buildConfig(name, pens, templates, startDate) {
  const t = new Date();
  const fallback = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  return {
    patient: { name, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
    protocol: {
      name: `${name}'s Protocol`,
      // With no date on the card the patient sets her own on first open.
      startDate: startDate || fallback,
      delivery: 'pen',
      tracking: false,
      injectionSteps: templates.injectionSteps,
      injectionStepsSyringe: templates.injectionStepsSyringe,
      injectionStepsVial: templates.injectionStepsVial,
      sites: templates.sites,
      concierge: templates.concierge,
      handling: templates.handling,
      pens
    }
  };
}

/* The fragment is the payload itself — "#Dustin~wol" — unless a start date
   had to be pinned, in which case it falls back to "#c=…&s=…". Every byte
   counts: a 64-byte MIFARE Ultralight leaves ~40 characters after the
   https:// prefix, and the domain eats most of that. */
function readCard() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return { card: null, start: null };
  if (raw.includes('=')) {
    const q = new URLSearchParams(raw);
    return { card: q.get('c'), start: q.get('s') };
  }
  return { card: raw, start: null };
}

/* ---------- pens the patient adds herself ----------
   The card carries what was dispensed. If she is later given something else
   and the card hasn't been rewritten, the plus sign lets her add it from the
   same template list the atelier writes cards from. It counts from the day
   she adds it, and it lives on her device only. */
function addedKey() { return `tca.added.${CFG.patient.id}`; }

function loadAdded() {
  try { return JSON.parse(localStorage.getItem(addedKey())) || []; } catch { return []; }
}

function saveAdded(list) {
  try { localStorage.setItem(addedKey(), JSON.stringify(list)); } catch {}
}

function penFromTemplate(tpl, id, startDate) {
  const pen = JSON.parse(JSON.stringify(tpl));
  pen.id = id;
  pen.template = tpl.id;
  pen.startDate = startDate;
  pen.addedByPatient = true;
  return pen;
}

function applyAdded(templates) {
  const list = (templates.templates || []);
  loadAdded().forEach(rec => {
    if (PENS.some(p => p.id === rec.id)) return;
    const tpl = list.find(t => t.id === rec.template);
    if (tpl) PENS.push(penFromTemplate(tpl, rec.id, rec.startDate));
  });
}

function addPen(tpl) {
  const start = iso(today());
  const rec = { id: `${tpl.id}+${Date.now().toString(36)}`, template: tpl.id, startDate: start };
  saveAdded(loadAdded().concat([rec]));
  const pen = penFromTemplate(tpl, rec.id, start);
  PENS.push(pen);
  _supplyCache.clear();
  return pen;
}

function removePen(pen) {
  saveAdded(loadAdded().filter(r => r.id !== pen.id));
  try { localStorage.removeItem(setupKey(pen)); } catch {}
  const i = PENS.indexOf(pen);
  if (i >= 0) PENS.splice(i, 1);
  _supplyCache.clear();
}

/* ---------- stored cards ----------
   A card written as an address rather than a payload — /phil.h — carries
   no protocol of its own. The tag is written once and the record behind it
   is edited from the dashboard, so what the patient sees on the next tap
   is whatever the atelier last saved. The slug arrives either from the
   server, which stamps it into the page it serves, or on the query string
   as the patient moves between pages. */
/* Jessica's tag was written before cards had addresses, and it cannot be
   rewritten. Her forwarding site marks the hop so her protocol still loads —
   and so that nobody else's card can land on it by accident. */
function isLegacyCard() {
  return new URLSearchParams(location.search).get('card') === 'legacy';
}

function readSlug() {
  const q = new URLSearchParams(location.search).get('c');
  if (q && /^[a-z0-9][a-z0-9.\-]{0,38}[a-z0-9]$/i.test(q)) return q.toLowerCase();
  if (typeof window !== 'undefined' && window.__CARD_SLUG__) return window.__CARD_SLUG__;
  return null;
}

/* Expand a stored record's template ids into the pens the engine runs on.
   Dosing maths stays in templates.json, so a corrected concentration fixes
   every patient at once instead of every record needing an edit. */
function hydrateRecord(rec, templates) {
  const byKey = {};
  (templates.templates || []).forEach(t => { byKey[t.id] = t; byKey[t.short] = t; });

  const pens = (rec.pens || []).map((entry, i) => {
    const base = byKey[entry.template];
    if (!base) return null;
    const pen = JSON.parse(JSON.stringify(base));
    pen.template = base.id;
    // Two pens of the same template need distinct ids for supply and setup.
    pen.id = (rec.pens || []).filter(p => p.template === entry.template).length > 1
      ? `${base.id}#${i}` : base.id;
    if (entry.phases && entry.phases.length) pen.phases = entry.phases;
    if (entry.schedule) pen.schedule = entry.schedule;
    if (entry.startDate) pen.startDate = entry.startDate;
    return pen;
  }).filter(Boolean);

  const cfg = buildConfig(rec.name || 'Patient', pens, templates, rec.startDate);
  // A record with no name is an unassigned tag, whatever we choose to draw.
  cfg.patient.named = !!(rec.name && rec.name.trim());
  cfg.patient.id = rec.slug || cfg.patient.id;
  cfg.slug = rec.slug || null;
  cfg.status = rec.status || 'active';
  return cfg;
}

/* ---------- remembering the card ----------
   A tapped card carries its identity in the address. Added to the home
   screen, that address is not always what comes back — iOS has been seen
   saving the page without its fragment, and the portal then has no idea
   whose card it is.

   So the device remembers. Once a card resolves, what identified it is
   written here; if the portal is ever opened with nothing in the address,
   it is read back and the address restored. A phone holds one patient's
   card, so this cannot cross patients — and if nothing was ever
   remembered, the portal still refuses rather than guessing. */
var REMEMBER_KEY = 'tca.card.v2';

function rememberCard(state) {
  try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(state)); } catch {}
}

function recallCard() {
  try {
    const m = JSON.parse(localStorage.getItem(REMEMBER_KEY));
    return (m && (m.card || m.slug || m.legacy)) ? m : null;
  } catch { return null; }
}

function forgetCard() {
  try { localStorage.removeItem(REMEMBER_KEY); } catch {}
}

/* Only a portal launched from the home screen may fall back to memory.
   That is the one place the address is lost through no fault of the
   patient. In an ordinary browser tab a bare address still refuses —
   otherwise a phone that had opened two cards would show the wrong one. */
function isHomeScreenApp() {
  try {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  } catch { return false; }
}

/* Put the identity back in the address bar, so links between pages carry
   it and a reload behaves like a fresh tap. */
function restoreAddress(state) {
  try {
    let url = location.pathname;
    if (state.legacy) url += '?card=legacy';
    else if (state.slug) url += `?c=${encodeURIComponent(state.slug)}`;
    else if (state.card) url += (state.start ? `#c=${state.card}&s=${state.start}` : `#${state.card}`);
    history.replaceState(null, '', url);
  } catch {}
}

/* ---------- boot ---------- */
var TEMPLATES = null;
var CARD_SLUG = null;
var CARD_RESTORED = false;

/* ------------------------------------------------------------------
   A dose is prescribed in milligrams. The dial number is arithmetic:

     units = mg / (mg per mL) / 0.01

   So the template carries the vial and the diluent, and the units the
   patient reads are derived every time. Change a reconstitution volume
   and every dial number that depends on it moves with it, which is the
   one thing that cannot be allowed to drift — a template that stored
   units instead had GHK-Cu reading 1.67 mg where the dose card said 1.
   ------------------------------------------------------------------ */
function concentrationOf(t) {
  if (t.vialMg && t.diluentMl) return t.vialMg / t.diluentMl;
  const total = (t.components || []).reduce((s, c) => s + c.mg, 0);
  return total / (t.volumeMl || 1);
}

/* A pen dials in whole clicks. A prescription of 2.4 mg on a 0.2333 mg
   pen is 10.29 clicks, which nobody can set — so round DOWN to the click
   she can actually dial. Never up: erring under the intended dose is the
   safe direction, and "turn your pen to 10.3" is an instruction that
   invites a guess.

   The milligrams shown to her are then computed back from the whole
   click, so the number on her screen is what she actually receives
   rather than what was prescribed. */
function unitsForMg(t, mg) {
  const c = concentrationOf(t);
  if (!c || !isFinite(mg)) return 0;
  return Math.floor(mg / c / ML_PER_UNIT);
}

/* Fill in units on any phase that was prescribed in milligrams. Phases
   that still carry only units are left alone, so a card written before
   this went in keeps reading exactly as it did. */
function resolveDoses(templates) {
  (templates.templates || []).forEach(t => {
    (t.phases || []).forEach(ph => {
      if (ph.mg != null) ph.units = unitsForMg(t, ph.mg);
      else if (ph.units != null && t.vialMg) ph.mg = mgForUnits(t, ph.units);
    });
  });
  return templates;
}

function mgForUnits(t, units) {
  return Math.round(concentrationOf(t) * units * ML_PER_UNIT * 1000) / 1000;
}

async function loadTemplates() {
  if (!TEMPLATES) {
    TEMPLATES = resolveDoses(
      await (await fetch('templates.json', { cache: 'no-store' })).json());
  }
  return TEMPLATES;
}

async function loadProtocol() {
  // Every page gets the guard, whatever else happens below.
  installCardLinkGuard();

  let { card, start: pinned } = readCard();

  // A link that dropped the card, followed from inside the portal: put it
  // back rather than telling her the card is not set up.
  if (!card && !readSlug()) {
    const mem = recoverTabCard();
    if (mem && mem.frag) {
      try { history.replaceState(null, '', location.pathname + location.search + mem.frag); } catch {}
      location.hash = mem.frag;
      card = readCard().card;
    } else if (mem && mem.slug) {
      const q = new URLSearchParams(location.search);
      q.set('c', mem.slug);
      try { history.replaceState(null, '', `${location.pathname}?${q}`); } catch {}
    }
  }

  const templates = await loadTemplates();
  CARD_SLUG = readSlug();
  let legacy = isLegacyCard();
  CARD_RESTORED = false;

  // Nothing in the address, and launched from the home screen: fall back to
  // what this device was opened with, rather than showing a dead portal.
  if (!card && !CARD_SLUG && !legacy && isHomeScreenApp()) {
    const mem = recallCard();
    if (mem) {
      card = mem.card || null;
      CARD_SLUG = mem.slug || null;
      legacy = !!mem.legacy;
      pinned = mem.start || null;
      CARD_RESTORED = true;
      restoreAddress(mem);
    }
  }

  if (card) {
    // Cards written before the service existed carry their own protocol.
    CFG = decodeCard(card, templates, pinned);
  } else if (CARD_SLUG) {
    const res = await fetch(`/api/card/${encodeURIComponent(CARD_SLUG)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`card ${CARD_SLUG} not found`);
    CFG = hydrateRecord(await res.json(), templates);
  } else if (legacy) {
    // The one card written before any of this existed. It is reached only
    // through its own marked address, never by landing on the bare root.
    CFG = await (await fetch('protocol.json', { cache: 'no-store' })).json();
  } else {
    // No card in the address at all. Refusing here is the whole point: a
    // portal that guesses shows one patient another patient's doses.
    throw Object.assign(new Error('no_card'), { noCard: true });
  }

  PENS = CFG.protocol.pens || [];
  START = parse(loadStart() || CFG.protocol.startDate);
  applyAdded(templates);
  applySetups();
  _supplyCache.clear();

  // Only a card that actually resolved is worth remembering.
  if (PENS.length) rememberCard({ card, slug: CARD_SLUG, legacy, start: pinned });

  return CFG;
}

/* Carry the card across in-portal links, so every page of a tapped card
   sees the same protocol. A payload card carries its fragment; a stored
   card carries its slug on the query string, since the path only names
   the card on the page the server handed over. */
function cardSuffix() {
  return location.hash && readCard().card ? location.hash : '';
}

function cardQuery() {
  const slug = CARD_SLUG || readSlug();
  return slug ? `?c=${encodeURIComponent(slug)}` : '';
}

function linkWithCard(href) {
  if (!href || /^(https?:|sms:|tel:|mailto:)/i.test(href)) return href;
  const suffix = cardSuffix();
  if (suffix) return href.split('#')[0] + suffix;
  const query = cardQuery();
  if (!query) return href;
  const [base, hash] = href.split('#');
  return base.split('?')[0] + query + (hash ? '#' + hash : '');
}

/* ------------------------------------------------------------------
   KEEPING THE CARD WHILE SHE CLICKS AROUND

   Rewriting links at render time only covers the links that exist at
   render time. Anything added afterwards — a dose card, a sheet, a
   button drawn once the protocol loads — is written without the card,
   and following it lands on the bare root, where the portal correctly
   refuses and says the card is not set up.

   So catch it at the click instead. One listener, in the capture phase,
   on every page: any same-origin link that has no card gets one. Nothing
   can be added later that escapes it.
   ------------------------------------------------------------------ */
function installCardLinkGuard() {
  if (window.__cardGuard) return;
  window.__cardGuard = true;

  document.addEventListener('click', ev => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;

    const href = a.getAttribute('href');
    if (!href || /^(https?:|sms:|tel:|mailto:|#)/i.test(href)) return;

    const withCard = linkWithCard(href);
    if (withCard && withCard !== href) a.setAttribute('href', withCard);
  }, true);

  // Keep the card in the address bar too, so a refresh or a bookmark
  // taken mid-visit still resolves. Never touches a slug address like
  // /phil.h, which already identifies the card on its own.
  try {
    if (!CARD_RESTORED && history.replaceState) {
      const slug = readSlug();
      const q = new URLSearchParams(location.search);
      if (slug && !q.get('c') && !window.__CARD_SLUG__) {
        q.set('c', slug);
        history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
      }
    }
  } catch {}

  // Within one tab, remember which card she is on. A page reached by
  // clicking from inside the portal can recover it; a page opened cold
  // cannot, which is what keeps one patient's card off another's screen.
  try {
    const slug = readSlug(), frag = cardSuffix();
    if (slug || frag) sessionStorage.setItem('tca.tab.card', JSON.stringify({ slug, frag }));
  } catch {}
}

/* Did she arrive here by clicking a link inside the portal? Only then is
   it safe to put back a card the link dropped. */
function cameFromPortal() {
  try {
    return !!document.referrer && new URL(document.referrer).origin === location.origin;
  } catch { return false; }
}

function recoverTabCard() {
  if (readSlug() || cardSuffix()) return null;
  if (!cameFromPortal()) return null;
  try {
    const mem = JSON.parse(sessionStorage.getItem('tca.tab.card') || 'null');
    return mem && (mem.slug || mem.frag) ? mem : null;
  } catch { return null; }
}

/* Rewrite every in-portal link so a tapped card keeps its protocol as the
   patient moves between Ritual, Protocol and Calendar. */
function applyCardLinks(root) {
  if (!cardSuffix() && !cardQuery()) return;
  (root || document).querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href && !/^(https?:|sms:|tel:|mailto:|#)/i.test(href)) a.setAttribute('href', linkWithCard(href));
  });
}

/* ==================================================================
   REMINDERS
   ------------------------------------------------------------------
   The device works out when this patient's doses fall and hands the
   server a plain list of instants. The server stores those and a push
   endpoint, and nothing else — no drug, no dial number, no name — so
   what travels through Apple's and Google's push services, and what
   lands on a lock screen, says only that a dose is due.

   Computing it here rather than on the server means the schedule that
   fires a reminder is the same schedule the patient is reading. There is
   one copy of this arithmetic and there should stay one.
   ================================================================== */

/* Every dose still ahead of us, as UTC instants, soonest first.
   `days` bounds how far out to look; the list is refreshed every time she
   opens the card, so it does not need to reach the end of the protocol. */
function upcomingDoses(days = 120) {
  const now = new Date();
  const horizon = addDays(now, days);
  const out = [];

  PENS.forEach(pen => {
    const [hh, mm] = String(timeFor(pen)).split(':').map(Number);
    occurrences(pen).forEach(day => {
      // occurrences() gives a local calendar day; put her chosen clock time
      // on it, in her own timezone, and let Date work out the instant.
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                          isNaN(hh) ? 9 : hh, isNaN(mm) ? 0 : mm, 0, 0);
      if (at > now && at <= horizon) out.push(at.toISOString());
    });
  });

  return Array.from(new Set(out)).sort();
}

/* Is this browser able to do reminders at all?

   On iOS the answer is no until the card has been added to the Home
   Screen — Apple only grants push to an installed web app. Saying so
   plainly is better than showing a switch that cannot work. */
function pushCapability() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  if (!supported) {
    return { ok: false, reason: ios && !isHomeScreenApp() ? 'ios_needs_home_screen' : 'unsupported' };
  }
  if (ios && !isHomeScreenApp()) return { ok: false, reason: 'ios_needs_home_screen' };
  return { ok: true, reason: '' };
}

function pushEndpointOf(sub) {
  try { return sub && sub.endpoint ? sub.endpoint : ''; } catch { return ''; }
}

async function pushRegistration() {
  // Scope is this card's folder, which is also where sw.js is served from.
  return navigator.serviceWorker.register('sw.js');
}

async function currentPushSub() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/* Turn reminders on. Returns { ok, reason } — the caller says it nicely. */
async function enableReminders() {
  const can = pushCapability();
  if (!can.ok) return { ok: false, reason: can.reason };

  const slug = CARD_SLUG || readSlug();
  if (!slug) return { ok: false, reason: 'no_card' };

  const meta = await fetch('/api/push/key').then(r => r.json()).catch(() => null);
  if (!meta || !meta.available || !meta.key) return { ok: false, reason: 'not_configured' };

  // Must be called from a user gesture, which is why this hangs off the tap.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await pushRegistration();
  await navigator.serviceWorker.ready;

  const sub = await reg.pushManager.getSubscription()
    || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(meta.key)
    });

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      sub: sub.toJSON(),
      due: upcomingDoses(),
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '')
    })
  });
  if (!res.ok) return { ok: false, reason: 'server' };
  return { ok: true, reason: '' };
}

async function disableReminders() {
  const sub = await currentPushSub();
  if (!sub) return { ok: true };
  const endpoint = pushEndpointOf(sub);
  await sub.unsubscribe().catch(() => {});
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint })
  }).catch(() => {});
  return { ok: true };
}

/* Every time she opens the card, hand the server a fresh schedule. A dose
   moved in Card Studio, a pen that ran out, a time she changed — all of it
   reaches her reminders on the next open, with nothing for her to do. */
async function refreshReminders() {
  try {
    const sub = await currentPushSub();
    if (!sub) return;
    const slug = CARD_SLUG || readSlug();
    if (!slug) return;
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug, sub: sub.toJSON(), due: upcomingDoses(),
        tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '')
      })
    });
  } catch {}
}

/* The VAPID key arrives base64url; subscribe() wants bytes. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
