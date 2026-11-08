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
const { sanitizeVisits } = require('../lib/services');

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
  // Who activated the card. Set once by /api/activate, never by the
  // dashboard — a save from Card Studio must not wipe the link.
  if (existing.activatedBy) out.activatedBy = existing.activatedBy;
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
  const src = (input.times && typeof input.times === 'object' && !Array.isArray(input.times)) ? input.times : {};
  Object.keys(src).slice(0, 6).forEach(band => {
    const v = String(src[band] || '');
    // A real clock time everywhere: hours 00-23, minutes 00-59 — the same
    // rule the state report applies, so no value survives one surface and
    // blanks on the other.
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) times[String(band).slice(0, 16)] = v;
  });

  const penTimes = {};
  const penSrc = (input.penTimes && typeof input.penTimes === 'object' && !Array.isArray(input.penTimes)) ? input.penTimes : {};
  Object.keys(penSrc).slice(0, 12).forEach(penId => {
    const v = String(penSrc[penId] || '');
    // A real clock time: hours 00-23, minutes 00-59.
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) penTimes[String(penId).slice(0, 16)] = v;
  });

  const out = {
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '') ? input.startDate : '',
    times,
    penTimes,
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
               JSON.stringify(out.times) === JSON.stringify(prev.times || {}) &&
               JSON.stringify(out.penTimes) === JSON.stringify(prev.penTimes || {});
  if (!same || input.force) out.rev = (Number(prev.rev) || 0) + 1;
  if (!out.rev && !out.startDate && !Object.keys(times).length && !Object.keys(penTimes).length) return undefined;
  return out;
}

/* ---------- what her phone says it is showing ----------
   Reported by the card itself, because the card is what does the dosing
   arithmetic. The dashboard shows this rather than recomputing it, so
   what the atelier reads is what she is actually looking at. */
function sanitizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const times = {};
  const src = (input.times && typeof input.times === 'object' && !Array.isArray(input.times)) ? input.times : {};
  Object.keys(src).slice(0, 6).forEach(b => {
    const v = String(src[b] || '');
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) times[String(b).slice(0, 16)] = v;
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
      at: /^([01]\d|2[0-3]):[0-5]\d$/.test(d.at || '') ? d.at : '',
      rest: !!d.rest
    })),
    supply: (Array.isArray(input.supply) ? input.supply : []).slice(0, 8).map(s => ({
      template: str(s.template, 24),
      dosesLeft: Number(s.dosesLeft) || 0,
      lastDose: /^\d{4}-\d{2}-\d{2}$/.test(s.lastDose || '') ? s.lastDose : '',
      // Each pen has its own start day now, so the one in `startDate`
      // above is only the protocol's default.
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(s.startDate || '') ? s.startDate : ''
    })),
    at: nowIso()
  };
}

function sanitize(input, existing = null) {
  // The display name in order of authority: what was typed, then the
  // first and last names the dashboard mints cards from, then the name
  // the record already had. An explicitly empty or whitespace-only name
  // counts as "not typed" — otherwise clearing the name would silently
  // leave a prescribed card nameless.
  const typedName = String(input.name ?? '').trim();
  const derivedName = (input.firstName || input.lastName)
    ? [input.firstName, input.lastName]
        .map(x => String(x ?? '').trim())
        .filter(Boolean)
        .join(' ')
    : '';
  const rec = {
    slug: normalizeSlug(input.slug || (existing && existing.slug)),
    name: String(typedName || derivedName || (existing ? existing.name : ''))
      .trim().slice(0, 60),
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
    // What the patient put on her own card. Kept apart from `pens` on
    // purpose: `pens` is what the atelier prescribed, and a tapped card
    // must never be able to rewrite that. This list she owns.
    added: Array.isArray(input.added)
      ? input.added.slice(0, 8).map(sanitizeAdded).filter(Boolean)
      : (existing ? (existing.added || []) : []),
    // Prescribed pens the patient has taken off her own schedule. Her
    // removal is recorded here rather than by deleting from `pens`, so
    // what was prescribed stays legible and the atelier can see what she
    // stopped and put it back.
    dropped: Array.isArray(input.dropped)
      ? input.dropped.slice(0, 8)
          .map(id => String(id || '')).filter(id => /^[A-Za-z0-9#._-]{1,48}$/.test(id))
      : (existing ? (existing.dropped || []) : []),
    // Aesthetic treatments given in the room. The atelier's record, not
    // the patient's — a tapped card cannot reach this.
    visits: Array.isArray(input.visits)
      ? sanitizeVisits(input.visits)
      : (existing ? (existing.visits || []) : []),
    createdAt: existing ? existing.createdAt : nowIso(),
    updatedAt: nowIso()
  };
  const settings = sanitizeSettings(input.settings, existing);
  if (settings) rec.settings = settings;
  // A card is blank until it has someone's name, a prescribed pen, or a
  // pen she added herself — and only then. Saying so here means the
  // dashboard never has to remember to set it, and a patient who starts
  // using an unassigned tag becomes visible exactly the way a prescribed
  // card is. Retired is the atelier's word and is never second-guessed.
  if (rec.status !== 'retired') {
    rec.status = (rec.name || rec.pens.length || rec.added.length) ? 'active' : 'blank';
  }
  return carryCounters(rec, existing);
}

/* A peptide the patient added herself. She chose it from the library on
   her own card, so it carries only what the card needs to draw it back:
   which template, under which id, from which day. No phases — a pen she
   added runs the template's own titration. */
function sanitizeAdded(rec) {
  if (!rec || typeof rec.template !== 'string' || typeof rec.id !== 'string') return null;
  if (!/^[A-Za-z0-9+._-]{1,48}$/.test(rec.id)) return null;
  const out = { id: rec.id, template: rec.template.slice(0, 24) };
  if (rec.startDate && /^\d{4}-\d{2}-\d{2}$/.test(rec.startDate)) out.startDate = rec.startDate;
  return out;
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

/* What a tapped card is allowed to see. The clinician's note, the
   treatment record (`visits`), and who activated the card stay on the
   clinician's side of the wire — the card itself has no use for them. */
function publicView(rec) {
  if (!rec) return null;
  return {
    slug: rec.slug,
    name: rec.name || '',
    status: rec.status,
    startDate: rec.startDate || null,
    pens: rec.pens || [],
    added: rec.added || [],
    dropped: rec.dropped || [],
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
    },
    // Link a card to a Google account, exactly once. A second POST with
    // the same uid verifies and writes nothing; a different uid is
    // refused and the card is never taken from its owner. A transaction
    // rather than a plain merge, so two first taps racing cannot both
    // claim the card.
    async activate(slug, activatedBy) {
      const doc = col.doc(normalizeSlug(slug));
      return await db.runTransaction(async tx => {
        const snap = await tx.get(doc);
        const existing = snap.exists ? snap.data() : null;
        if (!existing) return { result: 'missing' };
        if (existing.activatedBy) {
          return existing.activatedBy.uid === activatedBy.uid
            ? { result: 'verified' }
            : { result: 'blocked' };
        }
        tx.set(doc, { activatedBy }, { merge: true });
        return { result: 'linked' };
      });
    },
    // The clinician's remedy for a wrong first link: remove the field
    // and nothing else, so the next sign-in links the card again.
    async unlink(slug) {
      const { FieldValue } = require('@google-cloud/firestore');
      await col.doc(normalizeSlug(slug)).update({ activatedBy: FieldValue.delete() });
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
    },
    async activate(slug, activatedBy) {
      const all = readAll(), s = normalizeSlug(slug), rec = all[s];
      if (!rec) return { result: 'missing' };
      if (rec.activatedBy) {
        return rec.activatedBy.uid === activatedBy.uid
          ? { result: 'verified' }
          : { result: 'blocked' };
      }
      rec.activatedBy = activatedBy;
      writeAll(all);
      return { result: 'linked' };
    },
    async unlink(slug) {
      const all = readAll(), s = normalizeSlug(slug), rec = all[s];
      if (!rec) return false;
      delete rec.activatedBy;
      writeAll(all);
      return true;
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
