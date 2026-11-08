/* QA designer defensive tests — issue #12 per-pen archive, engine side.

   Loads patients/jessica/assets/protocol.js under Node's vm (the same
   characterization approach as portal/tests/unit/protocol-engine.test.mjs)
   and pins the archive behaviours the reminder engine depends on:

     gap 5 — upcomingDoses() omits only the archived pen: with a twin pair
             ghk#0 / ghk#1, archiving one twin leaves the other's doses.
     gap 6 — adoptArchived replaces the local map (never merges), an old
             card with no archived map is a no-op, and cardSignature treats
             a missing map like an empty one. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../../patients/jessica/', import.meta.url));
const code = fs.readFileSync(path.join(DIR, 'assets/protocol.js'), 'utf8');
const templatesJson = JSON.parse(fs.readFileSync(path.join(DIR, 'templates.json'), 'utf8'));

const RealDate = Date;
const FROZEN = new RealDate(2026, 6, 20, 12, 0, 0); // 2026-07-20
class FakeDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(FROZEN.getTime()); else super(...args); }
  static now() { return FROZEN.getTime(); }
}

function el() {
  return {
    style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
    querySelector() { return el(); }, querySelectorAll() { return []; }, focus() {},
    set innerHTML(v) {}, get innerHTML() { return ''; },
  };
}
const sandbox = {
  window: {},
  document: Object.assign(el(), { body: el(), referrer: '', hidden: false, visibilityState: 'visible', addEventListener() {} }),
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  location: { search: '', hash: '', pathname: '/', origin: 'http://x', href: 'http://x', host: 'x' },
  navigator: { userAgent: 'node', serviceWorker: { register: async () => ({}), getRegistration: async () => null } },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  net: { request: async () => ({ ok: true, json: async () => ({}) }) },
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  Intl, console, setTimeout, clearTimeout, Date: FakeDate,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const engine = sandbox;
const templates = engine.resolveDoses(JSON.parse(JSON.stringify(templatesJson)));

/* A stored record with a twin pair, hydrated exactly as the patient page
   would hydrate it — this is what produces the ghk#0 / ghk#1 keys. */
const rec = {
  slug: 'twin.x', name: 'Twin', status: 'active', startDate: '2026-07-13',
  pens: [{ template: 'ghk' }, { template: 'ghk' }], added: [], archived: {},
};
const cfgTwin = engine.hydrateRecord(rec, templates);
const ARCH_KEY = `tca.archived.${cfgTwin.patient.id}`;

engine.CFG = cfgTwin;
engine.PENS = cfgTwin.protocol.pens.map(p => Object.assign({}, p));
engine.START = engine.parse('2026-07-13');

const originalPens = engine.PENS;
const realGet = engine.localStorage.getItem;
const realSet = engine.localStorage.setItem;

/* ---------- gap 5: reminders omit only the archived pen ---------- */

test('hydrateRecord keys a twin pair ghk#0 / ghk#1', () => {
  assert.deepEqual(cfgTwin.protocol.pens.map(p => p.id), ['ghk#0', 'ghk#1']);
});

test('archiving one twin removes only that twin from the schedule', () => {
  engine.PENS = cfgTwin.protocol.pens.map(p => Object.assign({}, p));
  engine.localStorage.getItem = key =>
    key === ARCH_KEY ? JSON.stringify({ 'ghk#0': '2026-07-20T00:00:00.000Z' }) : null;
  try {
    engine.applyArchived();
    assert.deepEqual(engine.PENS.map(p => p.id), ['ghk#1'], 'only the archived twin leaves the schedule');
    // The surviving twin still schedules. Identical twins emit the same
    // instants, so the reminder list (a Set) is unchanged — still covered.
    assert.ok(engine.upcomingDoses(120).length > 0, 'the surviving twin still contributes doses');
  } finally {
    engine.PENS = originalPens;
    engine.localStorage.getItem = realGet;
  }
});

test('upcomingDoses omits the archived pen\u2019s doses but keeps the other pen\u2019s', () => {
  const recMix = {
    slug: 'mix.x', name: 'Mix', status: 'active', startDate: '2026-07-13',
    pens: [{ template: 'ghk' }, { template: 'glow' }], added: [], archived: {},
  };
  const cfgMix = engine.hydrateRecord(recMix, templates);
  const mixKey = `tca.archived.${cfgMix.patient.id}`;
  const realGet2 = engine.localStorage.getItem;
  engine.CFG = cfgMix;
  engine.PENS = cfgMix.protocol.pens.map(p => Object.assign({}, p));
  engine.START = engine.parse('2026-07-13');
  try {
    engine.localStorage.getItem = () => null;
    const before = engine.upcomingDoses(120).length;
    assert.ok(before > 0, 'the unarchived pair has doses');

    engine.localStorage.getItem = key =>
      key === mixKey ? JSON.stringify({ ghk: '2026-07-20T00:00:00.000Z' }) : null;
    engine.applyArchived();
    assert.deepEqual(engine.PENS.map(p => p.id), ['glow'], 'the archived pen leaves, the other stays');
    const after = engine.upcomingDoses(120).length;
    assert.ok(after < before, 'the archived pen\u2019s doses are gone');
    assert.ok(after > 0, 'the other pen\u2019s doses remain');
  } finally {
    engine.PENS = originalPens;
    engine.CFG = cfgTwin;
    engine.localStorage.getItem = realGet;
  }
});

/* ---------- gap 6: adoptArchived / old cards ---------- */

test('adoptArchived replaces the local map, never merges', () => {
  let saved = null;
  engine.localStorage.setItem = (k, v) => { if (k === ARCH_KEY) saved = v; };
  engine.localStorage.getItem = () => (saved ? JSON.parse(saved) : null);
  try {
    engine.saveArchived({ glow: 'A', stale: 'B' });
    engine.adoptArchived({ archived: { 'ghk#0': 'C' } });
    assert.deepEqual(JSON.parse(saved), { 'ghk#0': 'C' }, 'the record map replaces the phone map');
  } finally {
    engine.localStorage.setItem = realSet;
    engine.localStorage.getItem = realGet;
  }
});

test('an old card with no archived map leaves the local map alone', () => {
  let saved = null;
  engine.localStorage.setItem = (k, v) => { if (k === ARCH_KEY) saved = v; };
  engine.localStorage.getItem = () => (saved ? JSON.parse(saved) : null);
  try {
    engine.saveArchived({ glow: 'A' });
    engine.adoptArchived({ name: 'Old', pens: [], added: [] }); // no archived field
    assert.deepEqual(JSON.parse(saved), { glow: 'A' }, 'the no-op adopt does not clobber');
  } finally {
    engine.localStorage.setItem = realSet;
    engine.localStorage.getItem = realGet;
  }
});

test('cardSignature treats a missing archived map like an empty one', () => {
  const base = { name: 'X', startDate: '2026-01-01', status: 'active', pens: [], added: [], settings: {} };
  assert.equal(engine.cardSignature(base), engine.cardSignature({ ...base, archived: {} }),
    'an old card without archived does not differ from an empty map');
  assert.notEqual(engine.cardSignature(base),
    engine.cardSignature({ ...base, archived: { ghk: '2026-01-01T00:00:00.000Z' } }),
    'a populated map still differs');
});
