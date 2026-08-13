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
  // A card is blank until it has someone's name or something on it. Saying
  // so here means the dashboard never has to remember to set it.
  if (!rec.status) rec.status = (rec.name || rec.pens.length) ? 'active' : 'blank';
  if (!rec.name && rec.pens.length === 0 && rec.status === 'active') rec.status = 'blank';
  return rec;
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
    pens: rec.pens || []
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

module.exports = { openStore, sanitize, sanitizePen, publicView, assertSlug, COLLECTION };
