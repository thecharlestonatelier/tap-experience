/* Characterization pin for the pure parts of portal/lib/wallet.js:
   the CRC32, the manifest digests, and the pass.json builder. Signing and
   zipping shell out or build a binary and are left to WALLET.md. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import wallet from '../../lib/wallet.js';

test('crc32 matches the standard value for "hello"', () => {
  assert.equal(wallet.crc32(Buffer.from('hello')), 907060870);
});

test('crc32 of nothing is zero', () => {
  assert.equal(wallet.crc32(Buffer.alloc(0)), 0);
});

test('buildManifest is the sha1 of each file', () => {
  assert.deepEqual(wallet.buildManifest({ 'a.txt': Buffer.from('a') }), {
    'a.txt': '86f7e437faa5a7fce15d1ddcb9eaeaea377667b8',
  });
});

test('buildPassJson carries the card and its address', () => {
  const pass = wallet.buildPassJson(
    { slug: 'phil.h', name: 'Phillip' }, { origin: 'https://tap.example.com' });
  assert.equal(pass.formatVersion, 1);
  assert.equal(pass.serialNumber, 'phil.h');
  assert.equal(pass.organizationName, 'The Charleston Atelier');
  assert.equal(pass.barcodes[0].message, 'https://tap.example.com/phil.h');
  assert.equal(pass.barcodes[0].altText, 'phil.h');
  assert.deepEqual(pass.storeCard.primaryFields,
    [{ key: 'patient', label: 'Patient', value: 'Phillip' }]);
  assert.deepEqual(pass.storeCard.backFields.map(f => f.key), ['portal', 'concierge', 'note']);
});

test('buildPassJson fills a nameless card', () => {
  const pass = wallet.buildPassJson({ slug: 'x.y' }, { origin: 'https://x.y' });
  assert.equal(pass.storeCard.primaryFields[0].value, 'Not yet set up');
});

test('buildPassJson shows the start day when there is one', () => {
  const pass = wallet.buildPassJson(
    { slug: 'x.y', startDate: '2026-01-01' }, { origin: 'https://x.y' });
  assert.deepEqual(pass.storeCard.auxiliaryFields, [
    { key: 'started', label: 'Started', value: '2026-01-01', dateStyle: 'PKDateStyleMedium' },
  ]);
});

test('buildPassJson shows the dose of the day when given one', () => {
  const pass = wallet.buildPassJson(
    { slug: 'x.y', name: 'X' },
    { origin: 'https://x.y', dose: { lead: 'Turn your pen to', units: 25, penName: 'Glow' } });
  assert.deepEqual(pass.storeCard.headerFields,
    [{ key: 'today', label: 'Turn your pen to', value: '25' }]);
  assert.deepEqual(pass.storeCard.secondaryFields,
    [{ key: 'pen', label: 'Today', value: 'Glow' }]);
});

test('configured is false without credentials or certificates', () => {
  assert.equal(wallet.configured(), false);
});

test('zip builds a stored archive with a local header and central directory', () => {
  const z = wallet.zip({ 'a.txt': Buffer.from('hello') });
  assert.equal(z.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
  assert.ok(z.includes(Buffer.from('PK\x01\x02')));
  assert.ok(z.includes(Buffer.from('a.txt')));
  assert.ok(z.includes(Buffer.from('hello')));
  const eocd = z.subarray(z.length - 22);
  assert.equal(eocd.subarray(0, 4).toString('latin1'), 'PK\x05\x06');
  assert.equal(eocd.readUInt16LE(8), 1); // one entry
});

test('zip counts every file in the end record', () => {
  const z = wallet.zip({ 'a.txt': Buffer.from('a'), 'b.txt': Buffer.from('bb') });
  assert.equal(z.subarray(z.length - 22).readUInt16LE(8), 2);
});
