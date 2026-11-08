/* Pin wallet.configured when the credentials and certificates are in place.
   wallet reads PASS_TYPE_ID/TEAM_ID/CERT_DIR at module load, so this file
   sets them before importing; the cert files are created in a temp dir. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-wallet-'));
const pass = path.join(tmp, 'pass.pem');
const wwdr = path.join(tmp, 'wwdr.pem');
fs.writeFileSync(pass, 'x');
fs.writeFileSync(wwdr, 'y');
process.env.PASS_TYPE_ID = 'pass.com.thecharlestonatelier.card';
process.env.APPLE_TEAM_ID = 'TEAMID123';
process.env.PASS_CERT_DIR = tmp;

const wallet = (await import('../../lib/wallet.js')).default;

test('configured is true with the id, team and both certificates', () => {
  assert.equal(wallet.configured(), true);
});

test('configured is false when the signing certificate is missing', () => {
  fs.rmSync(pass);
  assert.equal(wallet.configured(), false);
  fs.writeFileSync(pass, 'x');
  assert.equal(wallet.configured(), true);
});

test('configured is false when the WWDR certificate is missing', () => {
  fs.rmSync(wwdr);
  assert.equal(wallet.configured(), false);
  fs.writeFileSync(wwdr, 'y');
  assert.equal(wallet.configured(), true);
});
