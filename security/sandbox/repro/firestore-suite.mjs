/* The same two lifecycle scenarios against the Firestore emulator. Run by
   `firebase emulators:exec --only firestore`, which supplies
   FIRESTORE_EMULATOR_HOST. */
import fs from 'node:fs';
import { feedDelete, slugReuse } from './scenarios.mjs';

const env = {
  CARD_STORE: 'firestore',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'demo-atelier',
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || 'demo-atelier',
  CARD_COLLECTION: 'cards-audit',
  DOSE_COLLECTION: 'administrations-audit',
  SUB_COLLECTION: 'reminders-audit',
  FEED_COLLECTION: 'feeds-audit',
  TOMBSTONE_COLLECTION: 'tombstones-audit',
};

const result = { name: 'firestore-suite', at: new Date().toISOString() };
try {
  result.feed_delete = await feedDelete(env);
  result.slug_reuse = await slugReuse(env);
  result.ok = !!(result.feed_delete?.ok && result.slug_reuse?.ok);
} catch (err) {
  result.ok = false;
  result.error = String(err && err.message || err);
}

fs.mkdirSync('/work/evidence', { recursive: true });
fs.writeFileSync('/work/evidence/firestore-suite-result.json', JSON.stringify(result, null, 2));
console.log('AUDIT_RESULT ' + JSON.stringify(result));
