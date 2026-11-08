/* ==================================================================
   DELETED SLUGS
   ------------------------------------------------------------------
   A slug is a patient's whole credential. Once a card is deleted, the
   slug must never be minted for a different patient: the previous holder
   would keep the public write authority that travels with the address.
   This is a tiny tombstone store, separate from the cards, so a deleted
   record is not a soft-deleted card that could leak through a list.
   ================================================================== */

const path = require('node:path');
const { fileJson } = require('./file-json');

const COLLECTION = process.env.TOMBSTONE_COLLECTION || 'tombstones';

function nowIso() { return new Date().toISOString(); }

function firestoreTombstones() {
  const { Firestore } = require('@google-cloud/firestore');
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const col = db.collection(COLLECTION);
  return {
    kind: 'firestore',
    async mark(slug) { await col.doc(slug).set({ slug, at: nowIso() }); },
    async has(slug) { return (await col.doc(slug).get()).exists; },
  };
}

function fileTombstones(file) {
  const target = file || path.join(__dirname, '..', '.data', 'tombstones.json');
  const { readAll, writeAll } = fileJson(target);
  return {
    kind: 'file',
    async mark(slug) {
      const all = readAll();
      all[slug] = { slug, at: nowIso() };
      writeAll(all);
    },
    async has(slug) { return !!readAll()[slug]; },
  };
}

function openTombstones() {
  const want = process.env.CARD_STORE
    || (process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE ? 'firestore' : 'file');
  return want === 'firestore'
    ? firestoreTombstones()
    : fileTombstones(process.env.TOMBSTONE_FILE);
}

module.exports = { openTombstones, COLLECTION };
