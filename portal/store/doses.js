/* ==================================================================
   ADMINISTRATIONS
   ------------------------------------------------------------------
   One record per confirmed dose: who, which vial, when, how much.

   This is PHI. It lives in Firestore, under the Google Cloud BAA, in
   its own collection so it is never mixed with the card records the
   dashboard lists.

   It is also a QUEUE. Practice Better is the record of truth, but a
   patient injecting at 10pm should never lose her dose because an API
   was down. So every administration is written here first and pushed
   afterwards; `synced` says whether the chart has it yet, and anything
   unsynced is retried.
   ================================================================== */

const COLLECTION = 'administrations';

function nowIso() { return new Date().toISOString(); }

/* Only the fields an administration is allowed to carry. Anything the
   browser sends beyond these is dropped rather than stored — the tag is
   public and a POST is a POST. */
function sanitizeDose(input) {
  if (!input || typeof input.slug !== 'string') return null;
  const units = Number(input.units);
  return {
    slug: input.slug.slice(0, 40),
    pen: String(input.pen || '').slice(0, 60),
    template: String(input.template || '').slice(0, 24),
    lot: String(input.lot || '').slice(0, 24),
    units: Number.isFinite(units) && units > 0 ? Math.round(units) : 0,
    mg: Number.isFinite(Number(input.mg)) ? Number(input.mg) : null,
    at: /^\d{4}-\d{2}-\d{2}T/.test(input.at || '') ? input.at : nowIso(),
    recordedAt: nowIso(),
    synced: false,
    attempts: 0,
    lastError: null
  };
}

/* A dose is identified by patient, vial and day. Tapping the same vial
   twice in a minute is one dose, not two — a patient checking the page
   after injecting should not double the record. */
function doseId(d) {
  return `${d.slug}.${d.template || 'pen'}.${d.at.slice(0, 13)}`;
}

function firestoreDoses(db) {
  const col = db.collection(COLLECTION);
  return {
    kind: 'firestore',
    async put(dose) {
      const id = doseId(dose);
      const ref = col.doc(id);
      const snap = await ref.get();
      // Same patient, same vial, same hour: already recorded.
      if (snap.exists) return { id, duplicate: true };
      await ref.set(dose);
      return { id, duplicate: false };
    },
    async markSynced(id) {
      await col.doc(id).set({ synced: true, syncedAt: nowIso() }, { merge: true });
    },
    async markFailed(id, reason) {
      const { FieldValue } = require('@google-cloud/firestore');
      await col.doc(id).set(
        { attempts: FieldValue.increment(1), lastError: String(reason).slice(0, 120) },
        { merge: true });
    },
    async pending(limit = 50) {
      const snap = await col.where('synced', '==', false)
        .orderBy('recordedAt', 'asc').limit(limit).get();
      return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    },
    async forSlug(slug, limit = 60) {
      const snap = await col.where('slug', '==', slug)
        .orderBy('at', 'desc').limit(limit).get();
      return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }
  };
}

function fileDoses(file) {
  const fs = require('node:fs');
  const path = require('node:path');
  const target = file || path.join(__dirname, '..', '.data', 'administrations.json');
  const readAll = () => { try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return {}; } };
  const writeAll = a => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(a, null, 2));
  };
  return {
    kind: 'file',
    file: target,
    async put(dose) {
      const all = readAll(), id = doseId(dose);
      if (all[id]) return { id, duplicate: true };
      all[id] = dose; writeAll(all);
      return { id, duplicate: false };
    },
    async markSynced(id) {
      const all = readAll();
      if (all[id]) { all[id].synced = true; all[id].syncedAt = nowIso(); writeAll(all); }
    },
    async markFailed(id, reason) {
      const all = readAll();
      if (all[id]) {
        all[id].attempts = (all[id].attempts || 0) + 1;
        all[id].lastError = String(reason).slice(0, 120);
        writeAll(all);
      }
    },
    async pending(limit = 50) {
      return Object.entries(readAll())
        .filter(([, d]) => !d.synced)
        .sort((a, b) => String(a[1].recordedAt).localeCompare(String(b[1].recordedAt)))
        .slice(0, limit)
        .map(([id, d]) => Object.assign({ id }, d));
    },
    async forSlug(slug, limit = 60) {
      return Object.entries(readAll())
        .filter(([, d]) => d.slug === slug)
        .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))
        .slice(0, limit)
        .map(([id, d]) => Object.assign({ id }, d));
    }
  };
}

function openDoses() {
  const want = process.env.CARD_STORE
    || (process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE ? 'firestore' : 'file');
  if (want !== 'firestore') return fileDoses(process.env.DOSE_FILE);
  const { Firestore } = require('@google-cloud/firestore');
  return firestoreDoses(new Firestore({ ignoreUndefinedProperties: true }));
}

module.exports = { openDoses, sanitizeDose, doseId, COLLECTION };
