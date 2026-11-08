/* Characterization pin for the front-end dosing engine,
   patients/jessica/assets/protocol.js. The file is a browser script with
   top-level globals, so it is loaded under Node's vm with browser stubs and
   a frozen clock; the pages do the DOM, the engine does the maths. This pin
   is the safety net for splitting the engine out of the script. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../../patients/jessica/', import.meta.url));
const code = fs.readFileSync(path.join(DIR, 'assets/protocol.js'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'protocol.json'), 'utf8'));

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
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  Intl, console, setTimeout, clearTimeout, Date: FakeDate,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const engine = sandbox;
engine.CFG = cfg;
engine.PENS = cfg.protocol.pens;
engine.START = engine.parse(cfg.protocol.startDate);

const pen = id => cfg.protocol.pens.find(p => p.id === id);
const iso = d => engine.iso(d);

test('date helpers round-trip and cross months', () => {
  assert.equal(iso(engine.parse('2026-01-31')), '2026-01-31');
  assert.equal(iso(engine.addDays(engine.parse('2026-01-31'), 1)), '2026-02-01');
  assert.equal(engine.daysBetween(engine.parse('2026-01-01'), engine.parse('2026-01-15')), 14);
  assert.equal(engine.isoDow(engine.parse('2026-01-05')), 1); // Monday
  assert.equal(engine.round(1.2345), 1.23);
  assert.equal(iso(engine.weekStart(engine.parse('2026-07-15'))), '2026-07-12');
});

test('frequency reads in the patient terms', () => {
  assert.equal(engine.freqText(pen('glow')), '5 days on / 2 off');
  assert.equal(engine.freqShort(pen('glow')), '5 on / 2 off');
});

test('the phase steps up after the first fortnight', () => {
  assert.deepEqual(engine.phaseOn(pen('glow'), engine.parse('2026-07-13')), { name: 'Starting', units: 4, days: 14 });
  assert.deepEqual(engine.phaseOn(pen('glow'), engine.parse('2026-08-02')), { name: 'Ramp-Up', units: 9, days: 14 });
});

test('the schedule knows a dosing day from a rest day', () => {
  assert.equal(engine.scheduledOn(pen('glow'), engine.parse('2026-07-13')), true);
  assert.equal(engine.scheduledOn(pen('glow'), engine.parse('2026-07-19')), false);
});

test('a dose on the start day resolves units and milligrams', () => {
  const dose = engine.doseOn(pen('glow'), engine.parse('2026-07-13'));
  assert.equal(dose.units, 4);
  assert.equal(dose.ml, 0.04);
  assert.equal(engine.round(dose.totalMg, 4), 0.9333);
  assert.equal(dose.components[2].name, 'GHK-Cu');
  assert.equal(engine.primaryOf(dose).name, 'total peptide');
});

test('the glow pen runs dry after its finite supply', () => {
  const s = engine.supply(pen('glow'));
  assert.equal(iso(s.lastDose), '2026-08-26');
  assert.equal(iso(s.exhaustedOn), '2026-08-27');
  assert.equal(s.totalDoses, 33);
  assert.equal(engine.dosesLeft(pen('glow')), 28); // doses still ahead on 2026-07-20
});

test('occurrences run from the start day to the last dose', () => {
  const occ = engine.occurrences(pen('glow'));
  assert.equal(occ.length, 33);
  assert.equal(iso(occ[0]), '2026-07-13');
  assert.equal(iso(occ[occ.length - 1]), '2026-08-26');
});

test('a pen is active only within its life', () => {
  assert.equal(engine.isActive(pen('glow'), engine.parse('2026-07-13')), true);
  assert.equal(engine.isActive(pen('glow'), engine.parse('2027-07-13')), false);
});

test('refill status against the frozen day', () => {
  assert.equal(engine.isSpent(pen('glow')), false);   // runs out 2026-08-27, ahead of 2026-07-20
  assert.equal(engine.daysUntilOut(pen('glow')), 37);
  assert.equal(engine.needsRefill(pen('glow')), false);
});

test('the injection steps and the dial lead', () => {
  assert.deepEqual(engine.stepsFor(pen('glow')), [
    'Turn the pen dial to {units}',
    'Inject at your chosen site',
    'Press the plunger all the way down and hold for 10 seconds',
  ]);
  assert.equal(engine.dialLead(pen('glow')), 'Turn your pen to');
});
