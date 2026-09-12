/* ==================================================================
   ADMINISTRATIONS
   ------------------------------------------------------------------
   One record per confirmed dose: who, which vial, when, how much.

   This is PHI. It lives in Firestore, under the Google Cloud BAA, in
   its own collection so it is never mixed with the card records the
   dashboard lists.

   Firestore is the record. This is an atelier log of what was injected
   and when — it is not the patient's medical record and is not pushed to
   one, so there is no queue and nothing to sync: a written dose is a
   recorded dose.
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
    // How the pen is taken, so the log reads on its own.
    frequency: String(input.frequency || '').slice(0, 40),
    units: Number.isFinite(units) && units > 0 ? Math.round(units) : 0,
    mg: Number.isFinite(Number(input.mg)) ? Number(input.mg) : null,
    at: /^\d{4}-\d{2}-\d{2}T/.test(input.at || '') ? input.at : nowIso(),
    recordedAt: nowIso()
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
