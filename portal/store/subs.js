/* ==================================================================
   REMINDER SUBSCRIPTIONS
   ------------------------------------------------------------------
   One record per phone that asked to be reminded. Same two backings as
   the card store — Firestore on Cloud Run, a JSON file on a laptop.

     {
       id:      "<sha256 of the endpoint>",   // the phone, not the person
       slug:    "phil.h",                     // which card it belongs to
       sub:     { endpoint, keys: { p256dh, auth } },
       due:     ["2026-08-19T11:30:00.000Z", ...],  // when to nudge
       sentUpTo:"2026-08-19T11:31:04.000Z",   // so a dose is nudged once
       tz:      "America/New_York",           // for reading the logs only
       createdAt, updatedAt
     }

   WHY THE DEVICE SENDS TIMESTAMPS
   -------------------------------
   The dosing schedule — weekly days, five-on-two-off, phase lengths, the
   day a pen runs dry — is computed in protocol.js, which is what the
   patient actually reads. Recomputing it here would be a second copy of
   the same arithmetic, free to drift from the first. A reminder firing on
   a day the portal says is a rest day is worse than no reminder.

   So the card does the maths and posts the instants. The server holds a
   list of times and a push endpoint, and knows nothing about what is
   being taken — which also means this collection stays clear of anything
   clinical if it is ever read by someone who should not read it.

   The id is a hash of the endpoint rather than the endpoint itself, so a
   document path never carries a push URL, and re-subscribing the same
   phone updates its record instead of accumulating duplicates.
   ================================================================== */

const crypto = require('node:crypto');
const { fileJson } = require('./file-json');
const { allowedPushEndpoint } = require('../lib/push-endpoint');

const COLLECTION = process.env.SUB_COLLECTION || 'reminders';
const MAX_DUE = 200;   // roughly four months of daily dosing

function idFor(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
}

function nowIso() { return new Date().toISOString(); }

/* Only these fields are ever stored, whatever a device posts. */
/* Future instants only, sorted, deduplicated, capped. A device sending a
   year of history cannot make the scheduler chew through it. */
function cleanDue(input, now) {
  const horizon = now - 24 * 60 * 60 * 1000;
  const list = Array.isArray(input.due) ? input.due : [];
  const iso = list
    .map(t => {
      const d = new Date(t);
      return isNaN(d) ? null : d.toISOString();
    })
    .filter(t => t && Date.parse(t) > horizon);
  return Array.from(new Set(iso)).sort().slice(0, MAX_DUE);
}

function sanitizeSub(input, slug) {
  const sub = input && input.sub;
  if (!sub || typeof sub.endpoint !== 'string' || !allowedPushEndpoint(sub.endpoint)) return null;
  if (!sub.keys || !sub.keys.p256dh || !sub.keys.auth) return null;

  return {
    id: idFor(sub.endpoint),
    slug,
    sub: {
      endpoint: sub.endpoint.slice(0, 1000),
      keys: {
        p256dh: String(sub.keys.p256dh).slice(0, 200),
        auth: String(sub.keys.auth).slice(0, 100)
      }
    },
    due: cleanDue(input, Date.now()),
    sentUpTo: '',
    tz: String(input.tz || '').slice(0, 60),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

/* A resubscribe refreshes the schedule and the keys but must not forget
   what has already been sent, or every re-open would re-fire this
   morning's reminder. */
function merge(prev, next) {
  if (!prev) return next;
  return Object.assign({}, prev, next, {
    createdAt: prev.createdAt,
    sentUpTo: prev.sentUpTo || ''
  });
}

/* ---------- Firestore ---------- */

function firestoreSubs() {
  const { Firestore } = require('@google-cloud/firestore');
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const col = db.collection(COLLECTION);

  return {
    kind: 'firestore',
    async ping() { await col.limit(1).get(); },
    async put(rec) {
      const snap = await col.doc(rec.id).get();
      const merged = merge(snap.exists ? snap.data() : null, rec);
      await col.doc(rec.id).set(merged);
      return merged;
    },
    async remove(id) { await col.doc(id).delete(); },
    async listAll() {
      const snap = await col.limit(2000).get();
      return snap.docs.map(d => d.data());
    },
    async forSlug(slug) {
      const snap = await col.where('slug', '==', slug).limit(50).get();
      return snap.docs.map(d => d.data());
    },
    async markSent(id, iso) {
      await col.doc(id).update({ sentUpTo: iso, updatedAt: nowIso() });
    }
  };
}

/* ---------- JSON file ---------- */

function fileSubs(file) {
  const path = require('node:path');
  const target = file || path.join(__dirname, '..', '.data', 'reminders.json');
  const { readAll, writeAll } = fileJson(target);

  return {
    kind: 'file',
    async ping() { writeAll(readAll()); },
    async put(rec) {
      const all = readAll();
      all[rec.id] = merge(all[rec.id], rec);
      writeAll(all);
      return all[rec.id];
    },
    async remove(id) { const all = readAll(); delete all[id]; writeAll(all); },
    async listAll() { return Object.values(readAll()); },
    async forSlug(slug) { return Object.values(readAll()).filter(r => r.slug === slug); },
    async markSent(id, iso) {
      const all = readAll();
      if (all[id]) { all[id].sentUpTo = iso; all[id].updatedAt = nowIso(); writeAll(all); }
    }
  };
}

function openSubs() {
  const want = process.env.CARD_STORE
    || (process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE ? 'firestore' : 'file');
  return want === 'firestore' ? firestoreSubs() : fileSubs(process.env.SUB_FILE);
}

/* ---------- who is due ----------
   The one instant a phone should be nudged for right now, or null.

   Two guards. A reminder more than `graceMs` old is dropped rather than
   delivered — a scheduler that was down since breakfast should not fire
   breakfast's reminder at four in the afternoon. And anything at or
   before `sentUpTo` has already been handled. */
/* Whether one due instant should fire now: past, not already sent, and not
   too stale to be useful. */
function shouldFire(t, now, sent, graceMs) {
  if (t <= sent) return false;                 // already nudged
  if (now - t > graceMs) return false;         // too stale to be useful
  return true;
}

/* The most recent qualifying instant, or null. The list is sorted, so the
   first future instant ends the walk. */
function latestDue(times, now, sent, graceMs) {
  let pick = null;
  for (const t of times) {
    if (isNaN(t) || t > now) break;
    if (!shouldFire(t, now, sent, graceMs)) continue;
    if (pick === null || t > pick) pick = t;
  }
  return pick;
}

function dueNow(rec, now = Date.now(), graceMs = 2 * 60 * 60 * 1000) {
  const sent = rec.sentUpTo ? Date.parse(rec.sentUpTo) : 0;
  const times = (rec.due || []).map(iso => Date.parse(iso));
  const pick = latestDue(times, now, sent, graceMs);
  return pick === null ? null : new Date(pick).toISOString();
}

module.exports = { openSubs, sanitizeSub, idFor, dueNow, COLLECTION, MAX_DUE };
