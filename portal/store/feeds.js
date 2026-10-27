/* ==================================================================
   CALENDAR FEEDS
   ------------------------------------------------------------------
   One calendar per card, published by the card itself.

   WHY THE DEVICE WRITES IT

   The same reason it posts reminder instants: the dosing arithmetic —
   phases, five-on-two-off, the day a pen runs dry, the hour she picked —
   lives in protocol.js, which is what the patient actually reads.
   Recomputing it here would be a second copy free to drift from the
   first, and a calendar that disagrees with the card is worse than no
   calendar. So the card builds its own .ics and posts it; this holds the
   text and hands it back when a phone asks.

   WHY A FEED AT ALL

   A downloaded .ics can add events and update events. It cannot remove
   them — iPhone reads a file of cancellations as a file of new events
   and offers to add those too. A subscribed calendar can: it is a
   calendar of its own, it mirrors whatever this serves, and deleting it
   deletes every dose in one move.

   It is PHI — pen names and doses — so it lives in Firestore under the
   Google Cloud BAA like everything else, and is reachable only by the
   card's own address, which is the same credential that opens the
   protocol behind it.
   ================================================================== */

const COLLECTION = process.env.FEED_COLLECTION || 'feeds';
const MAX_BYTES = 400 * 1024;      // ~1500 events; far past any real protocol

function nowIso() { return new Date().toISOString(); }

/* A feed is a whole iCalendar file or it is nothing. */
function sanitizeFeed(text) {
  const s = String(text == null ? '' : text);
  if (!s.startsWith('BEGIN:VCALENDAR')) return null;
  if (!s.trimEnd().endsWith('END:VCALENDAR')) return null;
  if (Buffer.byteLength(s, 'utf8') > MAX_BYTES) return null;
  return s;
}

function firestoreFeeds() {
  const { Firestore } = require('@google-cloud/firestore');
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const col = db.collection(COLLECTION);
  return {
    kind: 'firestore',
    async put(slug, text) {
      await col.doc(slug).set({ slug, text, at: nowIso() });
    },
    async get(slug) {
      const snap = await col.doc(slug).get();
      return snap.exists ? snap.data() : null;
    },
    async remove(slug) { await col.doc(slug).delete(); }
  };
}

function fileFeeds(file) {
  const fs = require('node:fs');
  const path = require('node:path');
  const target = file || path.join(__dirname, '..', '.data', 'feeds.json');
  const readAll = () => { try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return {}; } };
  const writeAll = a => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(a, null, 2));
  };
  return {
    kind: 'file',
    file: target,
    async put(slug, text) {
      const all = readAll();
      all[slug] = { slug, text, at: nowIso() };
      writeAll(all);
    },
    async get(slug) { return readAll()[slug] || null; },
    async remove(slug) { const all = readAll(); delete all[slug]; writeAll(all); }
  };
}

function openFeeds() {
  const want = process.env.CARD_STORE
    || (process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE ? 'firestore' : 'file');
  if (want !== 'firestore') return fileFeeds(process.env.FEED_FILE);
  return firestoreFeeds();
}

module.exports = { openFeeds, sanitizeFeed, COLLECTION, MAX_BYTES };
