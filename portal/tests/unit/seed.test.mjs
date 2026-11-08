/* Pin the seed record builder. seed.js no longer writes on import, so it can
   be required without touching the store. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import seed from '../../scripts/seed.js';

test('seed card builds the default record', () => {
  const rec = seed.card('x.y', 'X');
  assert.equal(rec.slug, 'x.y');
  assert.equal(rec.name, 'X');
  assert.equal(rec.status, 'active');
  assert.equal(rec.startDate, null);
  assert.deepEqual(rec.pens, []);
  assert.deepEqual(rec.added, []);
  assert.deepEqual(rec.dropped, []);
});

test('seed card carries extra fields and settings', () => {
  const rec = seed.card('x.y', 'X', {
    settings: { startDate: '2026-01-01' },
    extra: { taps: 2 },
    note: 'carried',
  });
  assert.deepEqual(rec.settings, { startDate: '2026-01-01' });
  assert.equal(rec.taps, 2);
  assert.equal(rec.note, 'carried');
});
