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

  return buildConfig(name, pens, templates, startOverride);
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
      sites: templates.sites,
      concierge: templates.concierge,
      pens
    }
  };
}

/* ---------- boot ---------- */
async function loadProtocol() {
  const hash = location.hash.replace(/^#/, '');
  const card = new URLSearchParams(hash).get('c');

  if (card) {
    const templates = await (await fetch('templates.json', { cache: 'no-store' })).json();
    CFG = decodeCard(card, templates, new URLSearchParams(hash).get('s'));
  } else {
    CFG = await (await fetch('protocol.json', { cache: 'no-store' })).json();
  }

  PENS = CFG.protocol.pens || [];
  START = parse(loadStart() || CFG.protocol.startDate);
  _supplyCache.clear();
  return CFG;
}

/* Carry the card payload across in-portal links, so every page of a
   tapped card sees the same protocol. */
function cardSuffix() {
  const hash = location.hash.replace(/^#/, '');
  const card = new URLSearchParams(hash).get('c');
  return card ? `#c=${card}` : '';
}

function linkWithCard(href) {
  if (!href || /^(https?:|sms:|tel:|mailto:)/i.test(href)) return href;
  const suffix = cardSuffix();
  if (!suffix) return href;
  return href.split('#')[0] + suffix;
}

/* Rewrite every in-portal link so a tapped card keeps its protocol as the
   patient moves between Ritual, Protocol and Calendar. */
function applyCardLinks(root) {
  if (!cardSuffix()) return;
  (root || document).querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href && !/^(https?:|sms:|tel:|mailto:|#)/i.test(href)) a.setAttribute('href', linkWithCard(href));
  });
}
