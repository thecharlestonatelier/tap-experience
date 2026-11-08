/* Characterization pin for portal/lib/services.js.
   Cadences and sanitization are pinned as they behave today against the
   real portal/services.json catalogue. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import services from '../../lib/services.js';

const v = (svc, date, extra) => Object.assign({ service: svc, date }, extra || {});
const now = Date.parse('2026-03-15T00:00:00');

test('serviceById resolves a real id and rejects an unknown one', () => {
  assert.equal(services.serviceById('prx').name, 'PRX Glass Skin Facial');
  assert.equal(services.serviceById('nope'), null);
});

test('addDaysIso crosses month and year boundaries', () => {
  assert.equal(services.addDaysIso('2026-01-31', 1), '2026-02-01');
  assert.equal(services.addDaysIso('2026-01-01', -1), '2025-12-31');
});

test('sanitizeVisit keeps a well-formed visit', () => {
  assert.deepEqual(services.sanitizeVisit(v('prx', '2026-01-01')),
    { service: 'prx', date: '2026-01-01' });
});

test('sanitizeVisit drops an unknown service and a bad date', () => {
  assert.equal(services.sanitizeVisit(v('zzz', '2026-01-01')), null);
  assert.equal(services.sanitizeVisit(v('prx', '01/01/2026')), null);
});

test('sanitizeVisit keeps area, note, and units and drops the rest', () => {
  assert.deepEqual(services.sanitizeVisit(
    { service: 'prx', date: '2026-01-01', area: 'Underarm', note: 'hi', units: 12, evil: 'DROP' }),
    { service: 'prx', date: '2026-01-01', area: 'Underarm', note: 'hi', units: 12 });
});

test('sanitizeVisits drops nulls and sorts by date', () => {
  assert.deepEqual(services.sanitizeVisits(
    [v('toxin', '2026-03-01'), null, v('prx', '2026-01-01')]),
    [{ service: 'prx', date: '2026-01-01' }, { service: 'toxin', date: '2026-03-01' }]);
});

test('nextDue is null for an unknown service or no visits', () => {
  assert.equal(services.nextDue('nope', [v('nope', '2026-01-01')], now), null);
  assert.equal(services.nextDue('prx', [], now), null);
});

test('nextDue for PRX is weekly at first', () => {
  const out = services.nextDue('prx', [v('prx', '2026-03-14')], now);
  assert.equal(out.due, '2026-03-21');
  assert.equal(out.days, 6);
  assert.equal(out.overdue, false);
  assert.equal(out.soon, true);
});

test('nextDue for PRX becomes monthly after the opening four', () => {
  const out = services.nextDue('prx', [
    v('prx', '2026-02-14'), v('prx', '2026-02-21'), v('prx', '2026-02-28'), v('prx', '2026-03-07'),
  ], now);
  assert.equal(out.due, '2026-04-06');
  assert.equal(out.days, 22);
  assert.equal(out.session, 4);
});

test('nextDue ends a polynucleotide course at three', () => {
  const out = services.nextDue('poly', [
    v('poly', '2026-01-01'), v('poly', '2026-01-29'), v('poly', '2026-02-26'),
  ], now);
  assert.equal(out.done, true);
  assert.equal(out.course, '3 of 3');
});

test('nextDue reads a toxin visit as overdue when past', () => {
  const out = services.nextDue('toxin', [v('toxin', '2025-12-01')], now);
  assert.equal(out.overdue, true);
  assert.equal(out.days, -14);
});

test('nextDue invents no cadence for filler', () => {
  const out = services.nextDue('filler', [v('filler', '2026-03-01')], now);
  assert.equal(out.none, true);
});

test('nextDue ends a liquid-lipo course at two', () => {
  const out = services.nextDue('lipo', [
    v('lipo', '2026-01-01'), v('lipo', '2026-02-26'),
  ], now);
  assert.equal(out.done, true);
  assert.equal(out.course, '2 of 2');
});

test('servicesFor ranks overdue before soon and the rest', () => {
  const visits = [
    v('toxin', '2025-12-01'),   // overdue
    v('prx', '2026-03-14'),     // soon
    v('filler', '2026-03-01'),  // no cadence
  ];
  const ids = services.servicesFor({ visits }, now).map(s => s.id);
  assert.equal(ids[0], 'toxin');
  assert.ok(ids.includes('filler'));
});

test('servicesFor is empty for a card with no visits', () => {
  assert.deepEqual(services.servicesFor({}, now), []);
});

test('servicesFor sorts two due services by soonest', () => {
  const out = services.servicesFor({ visits: [v('toxin', '2026-03-10'), v('b12', '2026-03-01')] }, now);
  assert.deepEqual(out.map(s => s.id).sort(), ['b12', 'toxin']);
});

test('servicesFor fills an unknown service from its id', () => {
  const out = services.servicesFor({ visits: [v('mystery', '2026-03-01')] }, now);
  assert.equal(out[0].name, 'mystery');
  assert.equal(out[0].color, '');
  assert.equal(out[0].hex, '');
  assert.equal(out[0].count, 1);
  assert.equal(out[0].next, null);
});

test('servicesFor sorts two due services by soonest', () => {
  // prx: 2026-03-10 + 7 = 2026-03-17 (2 days); b12: 2026-03-01 + 28 = 2026-03-29 (14)
  const out = services.servicesFor({ visits: [v('b12', '2026-03-01'), v('prx', '2026-03-10')] }, now);
  assert.deepEqual(out.map(s => s.id), ['prx', 'b12']);
});

test('nextDue gives liquid lipo its window on the first visit', () => {
  const out = services.nextDue('lipo', [v('lipo', '2026-03-01')], now);
  assert.equal(out.days, 42);
  assert.deepEqual(out.window, ['2026-04-26', '2026-05-10']);
  assert.equal(out.course, '1 of 2');
});

test('nextDue reports the course count before it ends', () => {
  const out = services.nextDue('poly', [v('poly', '2026-03-10')], now);
  assert.equal(out.course, '1 of 3');
  assert.equal(out.session, 1);
});

test('nextDue marks a dose due today as soon, not overdue', () => {
  const out = services.nextDue('toxin', [v('toxin', '2025-12-15')], now);
  assert.equal(out.days, 0);
  assert.equal(out.soon, true);
  assert.equal(out.overdue, false);
});

test('catalogue is a cached, non-empty list', () => {
  assert.ok(services.catalogue().length > 0);
  assert.equal(services.catalogue(), services.catalogue());
});

test('servicesFor orders overdue, then soonest, then the rest', () => {
  const visits = [
    v('toxin', '2025-12-01'),  // overdue
    v('b12', '2026-02-22'),    // due in 7 days
    v('prx', '2026-03-10'),    // due in 2 days
    v('filler', '2026-03-01'), // no cadence
  ];
  assert.deepEqual(services.servicesFor({ visits }, now).map(s => s.id), ['toxin', 'prx', 'b12', 'filler']);
});

test('nextDue marks seven days as soon and eight as not', () => {
  assert.equal(services.nextDue('toxin', [v('toxin', '2025-12-22')], now).soon, true);
  assert.equal(services.nextDue('toxin', [v('toxin', '2025-12-23')], now).soon, false);
});
