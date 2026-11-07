/* Characterization pin for portal/lib/supply.js.
   Pins the start-day precedence and the pen-life walk over the dosing
   schedule — the arithmetic that tells the atelier who is short. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import supply from '../../lib/supply.js';

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
