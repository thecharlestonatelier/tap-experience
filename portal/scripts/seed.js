/* ==================================================================
   SEED
   ------------------------------------------------------------------
   The local dev/test file store, with the named cards the suites and
   the README expect: est.t (Established), layn.p-v2p (Layna), test.p
   (Test), rem.t (Rem), blank.q (blank), edge.t (Edge), gate.t (Gate).

   npm run seed                → writes portal/.data/cards.json
   SEED_FILE=<path> npm run seed   → writes somewhere else, e.g. the
                                     per-suite .data-test files.

   Records match what sanitize() stores exactly, so the portal reads
   them as if the dashboard had written them. Cards that a suite opens
   in the browser carry a start date in settings — without one, the
   ritual page shows the first-run start-day picker and covers the
   page with its scrim, blocking every click.
   ================================================================== */

const fs = require('node:fs');
const path = require('node:path');

const target = process.env.SEED_FILE || path.join(__dirname, '..', '.data', 'cards.json');

const today = new Date();
const pad = n => String(n).padStart(2, '0');
const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const now = new Date().toISOString();

function card(slug, name, opts = {}) {
  const { settings, extra, ...rest } = opts;
  return Object.assign({
    slug,
    name,
    startDate: null,
    status: 'active',
    note: '',
    pens: [],
    added: [],
    dropped: [],
    createdAt: now,
    updatedAt: now
  }, rest, settings ? { settings } : {}, extra || {});
}

/* rev is 1, not 0: applySettings() ignores a zero rev, and sanitize()
   bumps a first set to 1 — the seed must match what the dashboard would
   actually have written. */
const withStart = () => ({ startDate: iso, times: {}, rev: 1 });

const all = {
  'est.t':      card('est.t', 'Established', { pens: [{ template: 'ghk' }], settings: withStart() }),
  'layn.p-v2p': card('layn.p-v2p', 'Layna', { pens: [{ template: 'nad' }], settings: withStart() }),
  'test.p':     card('test.p', 'Test'),
  'rem.t':      card('rem.t', 'Rem', { pens: [{ template: 'nad' }], settings: withStart() }),
  'blank.q':    card('blank.q', '', { status: 'blank' }),
  'edge.t':     card('edge.t', 'Edge', { pens: [{ template: 'nad' }], settings: withStart() }),
  'gate.t':     card('gate.t', 'Gate', { pens: [{ template: 'nad' }], settings: withStart() }),
  /* Phase 4 Studio fixtures: one card already linked in production, one
     waiting for its first sign-in. */
  'linked.t':   card('linked.t', 'Linked', { pens: [{ template: 'nad' }], settings: withStart(),
    extra: { activatedBy: { uid: 'u123', provider: 'google.com', name: 'Linked Example', at: now } } }),
  'fresh.t':    card('fresh.t', 'Fresh', { pens: [{ template: 'nad' }], settings: withStart() })
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(all, null, 2) + '\n');
console.log(`seeded ${Object.keys(all).length} cards → ${target}`);
