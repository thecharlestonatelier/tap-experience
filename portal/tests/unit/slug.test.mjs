/* Characterization pin for portal/lib/slug.js.
   The oracle is what the code does today — these assert the current
   behaviour so a refactor cannot silently change a card address. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import slug from '../../lib/slug.js';

test('isValidSlug accepts a plain first.last slug', () => {
  assert.equal(slug.isValidSlug('phil.h'), true);
});

test('isValidSlug accepts a suffixed slug', () => {
  assert.equal(slug.isValidSlug('phil.h-4k9'), true);
});

test('isValidSlug is case-insensitive', () => {
  assert.equal(slug.isValidSlug('PHIL.H'), true);
});

test('isValidSlug rejects empty, single-char, and over-long slugs', () => {
  assert.equal(slug.isValidSlug(''), false);
  assert.equal(slug.isValidSlug('a'), false);
  assert.equal(slug.isValidSlug('x'.repeat(41)), false);
});

test('isValidSlug rejects a trailing slash on the raw value', () => {
  assert.equal(slug.isValidSlug('/phil.h/'), false);
});

test('isValidSlug rejects reserved route segments', () => {
  assert.equal(slug.isValidSlug('api'), false);
  assert.equal(slug.isValidSlug('api.x'), false);
  assert.equal(slug.isValidSlug('studio'), false);
});

test('isValidSlug rejects doubled separators', () => {
  assert.equal(slug.isValidSlug('phil..h'), false);
  assert.equal(slug.isValidSlug('phil--h'), false);
});

test('isValidSlug rejects a space and other illegal characters', () => {
  assert.equal(slug.isValidSlug('Phil H'), false);
  assert.equal(slug.isValidSlug('phil.h!'), false);
});

test('isValidSlug rejects a leading or trailing separator', () => {
  assert.equal(slug.isValidSlug('-ab'), false);
  assert.equal(slug.isValidSlug('ab-'), false);
});

test('isValidSlug rejects non-strings', () => {
  assert.equal(slug.isValidSlug(null), false);
  assert.equal(slug.isValidSlug(undefined), false);
  assert.equal(slug.isValidSlug(42), false);
});

test('normalizeSlug lowercases, trims, and strips surrounding slashes', () => {
  assert.equal(slug.normalizeSlug('/Phil.H/'), 'phil.h');
  assert.equal(slug.normalizeSlug('  PHIL.H  '), 'phil.h');
  assert.equal(slug.normalizeSlug('phil.h'), 'phil.h');
  assert.equal(slug.normalizeSlug(''), '');
  assert.equal(slug.normalizeSlug(null), '');
});

test('baseSlug builds first four + last initial', () => {
  assert.equal(slug.baseSlug('Phillip', 'Hurley'), 'phil.h');
  assert.equal(slug.baseSlug('José', 'Peña'), 'jose.p');
  assert.equal(slug.baseSlug('', ''), '');
});

test('makeSlug without unique gives the bare slug', () => {
  assert.equal(slug.makeSlug('Phillip', 'Hurley', { unique: false }), 'phil.h');
});

test('makeSlug with unique appends three alphabet characters', () => {
  const out = slug.makeSlug('Phillip', 'Hurley');
  assert.equal(out.startsWith('phil.h-'), true);
  assert.equal(out.length, 10);
  const suffix = out.slice(7);
  assert.match(suffix, /^[23456789bcdfghjkmnpqrstvwxz]{3}$/);
});

test('blankSlug is six alphabet characters', () => {
  const out = slug.blankSlug();
  assert.equal(out.length, 6);
  assert.match(out, /^[23456789bcdfghjkmnpqrstvwxz]{6}$/);
});

test('isValidSlug pins the length boundaries', () => {
  assert.equal(slug.isValidSlug('ph'), true);            // 2: the floor
  assert.equal(slug.isValidSlug('a'.repeat(40)), true);  // 40: the ceiling
  assert.equal(slug.isValidSlug('a'.repeat(41)), false); // 41: past it
});

test('baseSlug drops to the stem when there is no last name', () => {
  assert.equal(slug.baseSlug('Ann', ''), 'ann');
  assert.equal(slug.baseSlug('A', 'B'), 'a.b');
  assert.equal(slug.baseSlug('   ', 'B'), '');
});

test('makeSlug of a nameless card is empty', () => {
  assert.equal(slug.makeSlug('', ''), '');
});
