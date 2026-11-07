/* Characterization pin for portal/store/index.js — the card shaping layer.
   sanitizeSettings/sanitizeAdded are private, so they are pinned through
   sanitize(). The oracle is current behaviour. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import store from '../../store/index.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('sanitize of an empty card is blank with the default shape', () => {
  const rec = store.sanitize({});
  assert.equal(rec.slug, '');
  assert.equal(rec.name, '');
  assert.equal(rec.status, 'blank');
  assert.equal(rec.startDate, null);
  assert.deepEqual(rec.pens, []);
  assert.deepEqual(rec.added, []);
  assert.deepEqual(rec.dropped, []);
  assert.equal(rec.settings, undefined);
  assert.match(rec.createdAt, ISO);
  assert.match(rec.updatedAt, ISO);
});

test('sanitize is active once a name is given', () => {
  const rec = store.sanitize({ slug: 'x.y', name: 'X' });
  assert.equal(rec.name, 'X');
  assert.equal(rec.status, 'active');
});

test('sanitize derives the name from first and last name', () => {
  const rec = store.sanitize({ slug: 'x.y', firstName: 'Phillip', lastName: 'Hurley' });
  assert.equal(rec.name, 'Phillip Hurley');
});

test('sanitize carries the name forward when nothing new is typed', () => {
  const rec = store.sanitize({ slug: 'x.y' }, { slug: 'x.y', name: 'Old' });
  assert.equal(rec.name, 'Old');
});

test('sanitize is active once it has a pen or an added peptide', () => {
  assert.equal(store.sanitize({ slug: 'x.y', pens: [{ template: 'ghk' }] }).status, 'active');
  assert.equal(store.sanitize({ slug: 'x.y', added: [{ id: 'a', template: 'ghk' }] }).status, 'active');
});

test('sanitize never second-guesses a retired card', () => {
  const rec = store.sanitize({ slug: 'x.y', name: 'X', status: 'retired' });
  assert.equal(rec.status, 'retired');
});

test('sanitize drops a dropped-pen id that is not a safe slug', () => {
  const rec = store.sanitize({ slug: 'x.y', dropped: ['ghk', 'bad id!'] });
  assert.deepEqual(rec.dropped, ['ghk']);
});

test('sanitize caps a name at 60 characters', () => {
  const rec = store.sanitize({ slug: 'x.y', name: 'n'.repeat(100) });
  assert.equal(rec.name.length, 60);
});

test('sanitize carries counters and phone state forward', () => {
  const existing = {
    slug: 'x.y', name: 'X', taps: 4, firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-02-01T00:00:00.000Z', days: { '2026-02-01': 2 },
    state: { startDate: '2026-01-01' }, activatedBy: { uid: 'u1' },
  };
  const rec = store.sanitize({ slug: 'x.y' }, existing);
  assert.equal(rec.taps, 4);
  assert.equal(rec.firstSeen, existing.firstSeen);
  assert.deepEqual(rec.days, { '2026-02-01': 2 });
  assert.deepEqual(rec.state, existing.state);
  assert.deepEqual(rec.activatedBy, { uid: 'u1' });
});

test('sanitizePen keeps a bare template', () => {
  assert.deepEqual(store.sanitizePen({ template: 'ghk' }), { template: 'ghk' });
});

test('sanitizePen drops a pen with no template', () => {
  assert.equal(store.sanitizePen({}), null);
  assert.equal(store.sanitizePen(null), null);
});

test('sanitizePen keeps phases with a positive unit count', () => {
  const pen = store.sanitizePen({
    template: 'glow',
    phases: [{ name: 'Start', units: 10, days: 30 }, { name: 'Zero', units: 0, days: 5 }],
  });
  assert.deepEqual(pen.phases, [{ name: 'Start', units: 10, days: 30 }]);
});

test('sanitizePen normalizes a weekly schedule', () => {
  assert.deepEqual(
    store.sanitizePen({ template: 'tirz', schedule: { weekly: true, day: 3 } }).schedule,
    { weekly: true, day: 3 });
  // out-of-range day is clamped to 1..7
  assert.deepEqual(
    store.sanitizePen({ template: 'tirz', schedule: { weekly: true, day: 0 } }).schedule,
    { weekly: true, day: 1 });
});

test('sanitizePen normalizes an on/off schedule', () => {
  assert.deepEqual(
    store.sanitizePen({ template: 'glow', schedule: { on: 5, off: 2 } }).schedule,
    { on: 5, off: 2 });
});

test('sanitizePen keeps a valid start date', () => {
  assert.equal(store.sanitizePen({ template: 'ghk', startDate: '2026-03-01' }).startDate, '2026-03-01');
  assert.equal(store.sanitizePen({ template: 'ghk', startDate: 'bad' }).startDate, undefined);
});

test('sanitize stores settings with a first rev', () => {
  const rec = store.sanitize({ slug: 'x.y', settings: { startDate: '2026-01-01', times: { morning: '08:00' } } });
  assert.deepEqual(rec.settings, { startDate: '2026-01-01', times: { morning: '08:00' }, rev: 1 });
});

test('sanitize drops an unrecognised time band', () => {
  const rec = store.sanitize({ slug: 'x.y', settings: { startDate: '2026-01-01', times: { morning: '8am' } } });
  assert.deepEqual(rec.settings.times, {});
});

test('sanitize keeps the rev and does not bump when nothing changed', () => {
  const existing = { slug: 'x.y', settings: { startDate: '2026-01-01', times: {}, rev: 3 } };
  const rec = store.sanitize({ slug: 'x.y', settings: { startDate: '2026-01-01' } }, existing);
  assert.equal(rec.settings.rev, 3);
});

test('sanitize bumps the rev when force re-sends unchanged settings', () => {
  const existing = { slug: 'x.y', settings: { startDate: '2026-01-01', times: {}, rev: 3 } };
  const rec = store.sanitize({ slug: 'x.y', settings: { startDate: '2026-01-01', force: true } }, existing);
  assert.equal(rec.settings.rev, 4);
});

test('sanitize keeps settings empty when none were ever set', () => {
  const rec = store.sanitize({ slug: 'x.y', settings: { startDate: '', times: {} } });
  assert.equal(rec.settings, undefined);
});

test('publicView hides the note, visits and the link', () => {
  const rec = {
    slug: 'x.y', name: 'X', status: 'active', startDate: '2026-01-01',
    pens: [{ template: 'ghk' }], added: [], dropped: [],
    note: 'clinician only', visits: [{ service: 'prx', date: '2026-01-01' }],
    activatedBy: { uid: 'u1' }, settings: { rev: 1 },
  };
  assert.deepEqual(store.publicView(rec), {
    slug: 'x.y', name: 'X', status: 'active', startDate: '2026-01-01',
    pens: [{ template: 'ghk' }], added: [], dropped: [], settings: { rev: 1 },
  });
});

test('publicView of null is null', () => {
  assert.equal(store.publicView(null), null);
});

test('publicView fills empty fields for a bare record', () => {
  assert.deepEqual(store.publicView({ slug: 'x.y', status: 'blank' }), {
    slug: 'x.y', name: '', status: 'blank', startDate: null,
    pens: [], added: [], dropped: [], settings: null,
  });
});

test('sanitizeState rejects a non-object', () => {
  assert.equal(store.sanitizeState(null), null);
  assert.equal(store.sanitizeState([]), null);
  assert.equal(store.sanitizeState('x'), null);
});

test('sanitizeState keeps only known fields', () => {
  const st = store.sanitizeState({
    startDate: '2026-01-01', times: { morning: '08:00', bad: '8' }, tz: 'America/New_York',
    rev: 2, reminders: true, homeScreen: false,
    today: [{ pen: 'ghk', template: 'ghk', phase: 'p', units: 10, mg: 1, at: '08:00', rest: true }],
    supply: [{ template: 'ghk', dosesLeft: 4, lastDose: '2026-01-01', startDate: '2026-01-01' }],
    evil: 'DROP',
  });
  assert.equal(st.startDate, '2026-01-01');
  assert.deepEqual(st.times, { morning: '08:00' });
  assert.equal(st.tz, 'America/New_York');
  assert.equal(st.rev, 2);
  assert.equal(st.reminders, true);
  assert.equal(st.homeScreen, false);
  assert.equal(st.today.length, 1);
  assert.equal(st.today[0].rest, true);
  assert.equal(st.supply[0].dosesLeft, 4);
  assert.equal(st.evil, undefined);
  assert.match(st.at, ISO);
});

test('sanitizeState blanks an invalid date and time', () => {
  const st = store.sanitizeState({ startDate: 'bad', times: { morning: '8:00' } });
  assert.equal(st.startDate, '');
  assert.deepEqual(st.times, {});
});

test('assertSlug normalizes and rejects an invalid slug', () => {
  assert.equal(store.assertSlug('/Phil.H/'), 'phil.h');
  assert.throws(() => store.assertSlug('bad slug!'), /invalid_slug/);
});

test('sanitize drops malformed added peptides', () => {
  assert.deepEqual(store.sanitize({ slug: 'x.y', added: [null, { template: 'ghk' }, { id: 'bad id!', template: 'ghk' }] }).added, []);
});

test('sanitize keeps a start day on an added peptide', () => {
  const rec = store.sanitize({ slug: 'x.y', added: [{ id: 'a', template: 'ghk', startDate: '2026-01-01' }] });
  assert.deepEqual(rec.added, [{ id: 'a', template: 'ghk', startDate: '2026-01-01' }]);
});
