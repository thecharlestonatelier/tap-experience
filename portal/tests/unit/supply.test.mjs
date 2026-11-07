/* Characterization pin for portal/lib/supply.js.
   Pins the start-day precedence and the pen-life walk over the dosing
   schedule — the arithmetic that tells the atelier who is short. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import supply from '../../lib/supply.js';

const WEB = fileURLToPath(new URL('../../../patients/jessica/', import.meta.url));
const now = Date.parse('2026-03-15T00:00:00');

test('effectiveStart prefers the phone state, then settings, then the record', () => {
  assert.equal(supply.effectiveStart({
    state: { startDate: '2026-01-01' },
    settings: { startDate: '2026-02-01' },
    startDate: '2026-03-01',
  }), '2026-01-01');
  assert.equal(supply.effectiveStart({
    settings: { startDate: '2026-02-01' },
    startDate: '2026-03-01',
  }), '2026-02-01');
  assert.equal(supply.effectiveStart({ startDate: '2026-03-01' }), '2026-03-01');
  assert.equal(supply.effectiveStart({}), null);
});

test('penLife walks a weekly schedule to the last full dose', () => {
  const out = supply.penLife(
    { volumeMl: 3, schedule: { on: 7, off: 0 } },
    [{ days: 30, units: 25 }],
  );
  assert.equal(out.days, 12);
  assert.equal(out.doses, 12);
  assert.equal(out.left, 0);
});

test('penLife honours an on/off cadence', () => {
  const out = supply.penLife(
    { volumeMl: 3, schedule: { on: 5, off: 2 } },
    [{ days: 14, units: 10 }],
  );
  assert.equal(out.days, 12);
  assert.equal(out.doses, 10);
  assert.ok(Math.abs(out.left - 2) < 1e-9);
});

test('penLife stops at upTo days', () => {
  const out = supply.penLife(
    { volumeMl: 3, schedule: { on: 7, off: 0 } },
    [{ days: 30, units: 25 }],
    7,
  );
  assert.equal(out.days, 7);
  assert.equal(out.doses, 7);
  assert.equal(out.left, 1.25);
});

/* ---------- supplyFor: what is left in each pen ---------- */

test('supplyFor is empty for a card with no pens and no report', () => {
  assert.deepEqual(supply.supplyFor({}, WEB, now), { out: [], low: [], pens: [], unknown: [] });
});

test('supplyFor reads a phone report with a last dose', () => {
  const r = supply.supplyFor(
    { state: { supply: [{ template: 'nad', lastDose: '2026-03-01', dosesLeft: 3 }] } }, WEB, now);
  assert.deepEqual(r.out, ['NAD+ (pen, retired)']);
  assert.deepEqual(r.pens, [{ name: 'NAD+ (pen, retired)', days: -14, dosesLeft: 3, runsOut: '2026-03-01' }]);
});

test('supplyFor reads a phone report that is out', () => {
  const r = supply.supplyFor({ state: { supply: [{ template: 'nad', dosesLeft: 0 }] } }, WEB, now);
  assert.deepEqual(r.out, ['NAD+ (pen, retired)']);
  assert.deepEqual(r.pens, [{ name: 'NAD+ (pen, retired)', days: 0, dosesLeft: 0, runsOut: '2026-03-15' }]);
});

test('supplyFor keeps a phone report with doses left and no date', () => {
  const r = supply.supplyFor({ state: { supply: [{ template: 'nad', dosesLeft: 5 }] } }, WEB, now);
  assert.deepEqual(r.pens, [{ name: 'NAD+ (pen, retired)', days: null, dosesLeft: 5, runsOut: null }]);
});

test('supplyFor projects a prescribed pen from its start day', () => {
  const r = supply.supplyFor({ pens: [{ template: 'glow' }], startDate: '2026-03-01' }, WEB, now);
  assert.deepEqual(r.pens, [{ name: 'Glow Blend', days: 26, dosesLeft: 20, runsOut: '2026-04-10' }]);
});

test('supplyFor names a self-sized vial as unknown, not fine', () => {
  const r = supply.supplyFor({ pens: [{ template: 'tirz' }], startDate: '2026-03-01' }, WEB, now);
  assert.deepEqual(r.pens, []);
  assert.deepEqual(r.unknown, ['Tirzepatide']);
});

test('supplyFor lets the phone report win over the projection', () => {
  const r = supply.supplyFor(
    { pens: [{ template: 'ghk' }], state: { supply: [{ template: 'ghk', dosesLeft: 2 }] } }, WEB, now);
  assert.deepEqual(r.pens, [{ name: 'GHK-Cu', days: null, dosesLeft: 2, runsOut: null }]);
});

test('supplyFor projects nothing without a start day', () => {
  assert.deepEqual(supply.supplyFor({ pens: [{ template: 'glow' }] }, WEB, now).pens, []);
});

test('supplyFor ignores an unknown template', () => {
  assert.deepEqual(
    supply.supplyFor({ pens: [{ template: 'zzz' }], startDate: '2026-03-01' }, WEB, now).pens, []);
});

test('penLife treats a weekly flag as one dose in seven', () => {
  assert.deepEqual(supply.penLife({ volumeMl: 3, schedule: { weekly: true } }, [{ days: 84, units: 25 }]),
    { days: 78, doses: 12, left: 0 });
});

test('penLife runs a phase with no day limit until the pen empties', () => {
  assert.deepEqual(supply.penLife({ volumeMl: 3, schedule: { on: 7, off: 0 } }, [{ units: 25 }]),
    { days: 12, doses: 12, left: 0 });
});

test('penLife stops at a phase with no units', () => {
  assert.deepEqual(supply.penLife({ volumeMl: 3, schedule: { on: 7, off: 0 } }, [{ days: 30, units: 0 }]),
    { days: 0, doses: 0, left: 3 });
});

test('penLife with no phases never draws', () => {
  assert.deepEqual(supply.penLife({ volumeMl: 3 }, []), { days: 0, doses: 0, left: 3 });
});

test('penLife stops when one dose will not fit', () => {
  assert.deepEqual(supply.penLife({ volumeMl: 1, schedule: { on: 7, off: 0 } }, [{ days: 30, units: 200 }]),
    { days: 0, doses: 0, left: 1 });
});

test('penLife steps through two phases', () => {
  const out = supply.penLife({ volumeMl: 3, schedule: { on: 7, off: 0 } },
    [{ days: 3, units: 25 }, { days: 30, units: 10 }]);
  assert.equal(out.days, 25);
  assert.equal(out.doses, 25);
  assert.ok(Math.abs(out.left - 0.05) < 1e-9);
});
