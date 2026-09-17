/* ==================================================================
   CARD STORE
   ------------------------------------------------------------------
   One interface, two backings. Firestore when the service is running on
   Cloud Run, a JSON file when it is running on a laptop — so the whole
   portal can be exercised end to end without a cloud project, and the
   thing that gets deployed is the thing that was tested.

   A record is small on purpose:

     {
       slug:      "phil.h-4k9",
       name:      "Phillip",          // what the portal greets him with
       pens:      [ { template: "tirz" },
                    { template: "glow", phases: [...] } ],
       startDate: "2026-08-13",
       status:    "active" | "blank" | "retired",
       note:      "",                 // clinician-only, never sent to the card
       createdAt, updatedAt
     }

   `pens` carries template ids, not expanded pens. The dosing maths lives
   in templates.json next to the portal, so correcting a concentration
   fixes every patient at once instead of every record needing a rewrite.
   ================================================================== */

const { isValidSlug, normalizeSlug } = require('../lib/slug');

const COLLECTION = process.env.CARD_COLLECTION || 'cards';

/* ---------- shared shaping ---------- */

function nowIso() { return new Date().toISOString(); }

/* Whatever the dashboard posts, only these fields are ever stored. */
/* Counters live on the record but are not editable from the dashboard, so
   every save has to carry them forward or a card's history resets the first
   time its protocol is changed. */
function carryCounters(out, existing) {
  if (!existing) return out;
  if (existing.taps != null) out.taps = Number(existing.taps) || 0;
  if (existing.firstSeen) out.firstSeen = existing.firstSeen;
  if (existing.lastSeen) out.lastSeen = existing.lastSeen;
  if (existing.days) out.days = existing.days;
  // What her phone last reported. It is hers, not the dashboard's, so a
  // save from Card Studio must never overwrite it.
  if (existing.state) out.state = existing.state;
  return out;
}

/* ---------- what the atelier sets on her behalf ----------
   Her start day and the hour she takes each pen have always lived on her
   phone, which is right — she is the one who knows. But when she rings to
   say the reminder is coming at the wrong time, there was no way to
   change it from here.

   These are the same two settings, held on the card. `rev` is what makes
   it safe: the phone remembers the last rev it applied, so a value set
   here lands once and her own later choice is not stamped on again at
   every open. Leave a field empty and the phone keeps deciding. */
function sanitizeSettings(input, existing) {
  const prev = (existing && existing.settings) || {};
  if (!input || typeof input !== 'object') return prev.rev ? prev : undefined;

  const times = {};
  const src = (input.times && typeof input.times === 'object') ? input.times : {};
  Object.keys(src).slice(0, 6).forEach(band => {
    const v = String(src[band] || '');
    if (/^\d{2}:\d{2}$/.test(v)) times[String(band).slice(0, 16)] = v;
  });

  const out = {
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '') ? input.startDate : '',
    times,
    rev: Number(prev.rev) || 0
  };

  // A new rev only when something actually changed, so opening the editor
  // and saving does not keep re-stamping her phone.
  //
  // `force` is the exception, and it is the case that matters most: her
  // phone has drifted to something the card never said, and the atelier
  // wants the card's own values put back. Nothing has "changed" in the
  // form — it already reads what it should — so without this there would
  // be no way to send it.
  const same = out.startDate === (prev.startDate || '') &&
               JSON.stringify(out.times) === JSON.stringify(prev.times || {});
  if (!same || input.force) out.rev = (Number(prev.rev) || 0) + 1;
  if (!out.rev && !out.startDate && !Object.keys(times).length) return undefined;
  return out;
}

/* ---------- what her phone says it is showing ----------
   Reported by the card itself, because the card is what does the dosing
   arithmetic. The dashboard shows this rather than recomputing it, so
   what the atelier reads is what she is actually looking at. */
function sanitizeState(input) {
  if (!input || typeof input !== 'object') return null;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const times = {};
  const src = (input.times && typeof input.times === 'object') ? input.times : {};
  Object.keys(src).slice(0, 6).forEach(b => {
    const v = String(src[b] || '');
    if (/^\d{2}:\d{2}$/.test(v)) times[String(b).slice(0, 16)] = v;
  });

  return {
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '') ? input.startDate : '',
    times,
    tz: str(input.tz, 60),
    rev: Number(input.rev) || 0,
    reminders: !!input.reminders,
    homeScreen: !!input.homeScreen,
    today: (Array.isArray(input.today) ? input.today : []).slice(0, 8).map(d => ({
      pen: str(d.pen, 40),
      template: str(d.template, 24),
      phase: str(d.phase, 40),
      units: Number(d.units) || 0,
      mg: Number(d.mg) || 0,
      at: /^\d{2}:\d{2}$/.test(d.at || '') ? d.at : '',
      rest: !!d.rest
    })),
    supply: (Array.isArray(input.supply) ? input.supply : []).slice(0, 8).map(s => ({
      template: str(s.template, 24),
      dosesLeft: Number(s.dosesLeft) || 0,
      lastDose: /^\d{4}-\d{2}-\d{2}$/.test(s.lastDose || '') ? s.lastDose : ''
    })),
    at: nowIso()
  };
}

function sanitize(input, existing = null) {
  const rec = {
    slug: normalizeSlug(input.slug || (existing && existing.slug)),
    name: String(input.name ?? (existing ? existing.name : '')).trim().slice(0, 60),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '')
      ? input.startDate
      : (existing ? existing.startDate : null),
    status: ['active', 'blank', 'retired'].includes(input.status)
      ? input.status
      : (existing ? existing.status : null),   // settled below once name/pens are known
    note: String(input.note ?? (existing ? existing.note : '')).slice(0, 500),
    pens: Array.isArray(input.pens)
      ? input.pens.slice(0, 8).map(sanitizePen).filter(Boolean)
      : (existing ? existing.pens : []),
    createdAt: existing ? existing.createdAt : nowIso(),
    updatedAt: nowIso()
  };
  const settings = sanitizeSettings(input.settings, existing);
  if (settings) rec.settings = settings;
  // A card is blank until it has someone's name or something on it. Saying
  // so here means the dashboard never has to remember to set it.
  if (!rec.status) rec.status = (rec.name || rec.pens.length) ? 'active' : 'blank';
  if (!rec.name && rec.pens.length === 0 && rec.status === 'active') rec.status = 'blank';
  return carryCounters(rec, existing);
}

function sanitizePen(pen) {
  if (!pen || typeof pen.template !== 'string') return null;
  const out = { template: pen.template.slice(0, 24) };

  // Phases are optional — without them the template's own titration stands.
  if (Array.isArray(pen.phases) && pen.phases.length) {
    out.phases = pen.phases.slice(0, 12).map(ph => ({
      name: String(ph.name || '').slice(0, 40),
      units: Number(ph.units) || 0,
      days: ph.days == null ? null : (Number(ph.days) || null)
    })).filter(ph => ph.units > 0);
  }
  if (pen.schedule && typeof pen.schedule === 'object') {
    const s = pen.schedule;
    out.schedule = s.weekly
      ? { weekly: true, day: Math.min(7, Math.max(1, Number(s.day) || 1)) }
      : { on: Number(s.on) || 5, off: Number(s.off) || 2 };
  }
  if (pen.startDate && /^\d{4}-\d{2}-\d{2}$/.test(pen.startDate)) out.startDate = pen.startDate;
  return out;
}

/* What a tapped card is allowed to see. The clinician's note and the
   record's history stay on the clinician's side of the wire. */
function publicView(rec) {
  if (!rec) return null;
  return {
    slug: rec.slug,
    name: rec.name || '',
    status: rec.status,
    startDate: rec.startDate || null,
    pens: rec.pens || [],
    // Her own settings, so the card can adopt anything the atelier
    // changed for her. Not the state report — that came from her phone
    // and it has no use for it back.
    settings: rec.settings || null
  };
}

/* ---------- Firestore (Cloud Run) ---------- */

function firestoreStore() {
  // Required lazily so a laptop without the dependency can still run the
  // file store, and so a missing credential fails loudly at first use.
  const { Firestore } = require('@google-cloud/firestore');
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const col = db.collection(COLLECTION);

  return {
    kind: 'firestore',
    // Cheapest question that still proves the credential works. Naming the
    // store is not the same as being able to reach it — a service account
    // without roles/datastore.user reports "firestore" and denies every
    // write, which looks like a broken dashboard rather than an IAM gap.
    async ping() { await col.limit(1).get(); },
    async get(slug) {
      const snap = await col.doc(normalizeSlug(slug)).get();
      return snap.exists ? snap.data() : null;
    },
    async list() {
      const snap = await col.orderBy('updatedAt', 'desc').limit(500).get();
      return snap.docs.map(d => d.data());
    },
    async put(rec) {
      await col.doc(rec.slug).set(rec);
      return rec;
    },
    async remove(slug) {
      await col.doc(normalizeSlug(slug)).delete();
    },
    // A tap must never clobber an edit saved a moment earlier, so this is a
    // merge of three counters rather than a write of the record.
    async touch(slug, day) {
      const { FieldValue } = require('@google-cloud/firestore');
      await col.doc(normalizeSlug(slug)).set({
        taps: FieldValue.increment(1),
        lastSeen: nowIso(),
        days: { [day]: FieldValue.increment(1) }
      }, { merge: true });
    },
    // Same reasoning: her phone reporting in while the dashboard is being
    // saved must not undo the save.
    async setState(slug, state) {
      await col.doc(normalizeSlug(slug)).set({ state }, { merge: true });
    }
  };
}

/* ---------- JSON file (local) ---------- */

function fileStore(file) {
  const fs = require('node:fs');
  const path = require('node:path');
  const target = file || path.join(__dirname, '..', '.data', 'cards.json');

  function readAll() {
    try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return {}; }
  }
  function writeAll(all) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(all, null, 2));
  }

  return {
    kind: 'file',
    file: target,
    async ping() { writeAll(readAll()); },
    async get(slug) { return readAll()[normalizeSlug(slug)] || null; },
    async list() {
      return Object.values(readAll())
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async put(rec) {
      const all = readAll();
      all[rec.slug] = rec;
      writeAll(all);
      return rec;
    },
    async remove(slug) {
      const all = readAll();
      delete all[normalizeSlug(slug)];
      writeAll(all);
    },
    async touch(slug, day) {
      const all = readAll(), s = normalizeSlug(slug), rec = all[s];
      if (!rec) return;
      rec.taps = (Number(rec.taps) || 0) + 1;
      rec.lastSeen = nowIso();
      rec.days = rec.days || {};
      rec.days[day] = (Number(rec.days[day]) || 0) + 1;
      writeAll(all);
    },
    async setState(slug, state) {
      const all = readAll(), s = normalizeSlug(slug);
      if (!all[s]) return;
      all[s].state = state;
      writeAll(all);
    }
  };
}

/* ---------- selection ---------- */

function openStore() {
  const want = process.env.CARD_STORE
    || (process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE ? 'firestore' : 'file');
  return want === 'firestore' ? firestoreStore() : fileStore(process.env.CARD_FILE);
}

/* Guard rails the routes share. */
function assertSlug(slug) {
  const s = normalizeSlug(slug);
  if (!isValidSlug(s)) {
    const err = new Error('invalid_slug');
    err.status = 400;
    throw err;
  }
  return s;
}

module.exports = { openStore, sanitize, sanitizePen, publicView, assertSlug,
                   carryCounters, sanitizeState, COLLECTION };
