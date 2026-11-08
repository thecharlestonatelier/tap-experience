/* The test deploy must not carry a known passphrase or production signing
   material. This is a source-level guard because the script only runs
   against a real GCP project. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const script = fs.readFileSync(path.join(root, 'deploy-test.sh'), 'utf8');

test('the test deploy has no default Studio passphrase', () => {
  assert.ok(!/TEST_STUDIO_PASS:-thisisatestenvironment/.test(script),
    'the known default must be gone');
  assert.match(script, /TEST_STUDIO_PASS:-/, 'the passphrase is still read from the environment');
  assert.match(script, /\$\{#PASS\}/, 'an unset or short passphrase is refused');
});

test('the test deploy binds test-only push secrets', () => {
  assert.ok(!/vapid-private-key:latest/.test(script), 'no production VAPID private key');
  assert.ok(!/push-run-secret:latest/.test(script), 'no production push-run secret');
  assert.match(script, /vapid-public-key-test:latest/);
  assert.match(script, /vapid-private-key-test:latest/);
  assert.match(script, /push-run-secret-test:latest/);
});

test('the test deploy points every collection at a test twin', () => {
  for (const twin of [
    'CARD_COLLECTION=cards-test',
    'DOSE_COLLECTION=administrations-test',
    'FEED_COLLECTION=feeds-test',
    'SUB_COLLECTION=reminders-test',
    'TOMBSTONE_COLLECTION=tombstones-test',
  ]) {
    assert.match(script, new RegExp(twin), `${twin} is missing`);
  }
});
