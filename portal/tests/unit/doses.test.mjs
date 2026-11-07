/* Characterization pin for portal/store/doses.js.
   Pins the administration sanitizer and the dose identity key. Time-stamped
   fields are checked for shape, not value. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import doses from '../../store/doses.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

test('sanitizeDose rejects null', () => {
  assert.equal(doses.sanitizeDose(null), null);
});

test('sanitizeDose keeps allowed fields and numeric units', () => {
  const out = doses.sanitizeDose({
    slug: 'phil.h', units: '25', pen: 'Glow', day: '2026-03-01', at: '2026-03-01T20:00:00Z',
  });
  assert.equal(out.slug, 'phil.h');
  assert.equal(out.pen, 'Glow');
  assert.equal(out.template, '');
  assert.equal(out.units, 25);
  assert.equal(out.mg, null);
  assert.equal(out.at, '2026-03-01T20:00:00Z');
  assert.equal(out.day, '2026-03-01');
  assert.match(out.recordedAt, ISO);
});

test('sanitizeDose clamps a negative or non-numeric unit count to zero', () => {
  const neg = doses.sanitizeDose({ slug: 'phil.h', units: '-5' });
  assert.equal(neg.units, 0);
  assert.equal(neg.mg, null);
  assert.match(neg.day, DAY);
  assert.match(neg.at, ISO);
  const non = doses.sanitizeDose({ slug: 'phil.h', units: 'abc' });
  assert.equal(non.units, 0);
});

test('doseId is slug.template.day', () => {
  assert.equal(doses.doseId({ slug: 'phil.h', template: 'glow', day: '2026-03-01' }),
    'phil.h.glow.2026-03-01');
  assert.equal(doses.doseId({ slug: 'phil.h', day: '2026-03-01' }),
    'phil.h.pen.2026-03-01');
});
