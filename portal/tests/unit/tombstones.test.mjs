/* A deleted slug is remembered, so it can never be minted again. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { openTombstones } = require('../../store/tombstones.js');

test('a file tombstone remembers and reloads a deleted slug', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomb-'));
  const file = path.join(dir, 'tombstones.json');
  const prevStore = process.env.CARD_STORE;
  const prevFile = process.env.TOMBSTONE_FILE;
  process.env.CARD_STORE = 'file';
  process.env.TOMBSTONE_FILE = file;

  try {
    const t = openTombstones();
    assert.equal(t.kind, 'file');
    assert.equal(await t.has('gone.t'), false);
    await t.mark('gone.t');
    assert.equal(await t.has('gone.t'), true);

    // A second instance reads the same file, as a restarted server would.
    const again = openTombstones();
    assert.equal(await again.has('gone.t'), true);
    assert.equal(await again.has('other.t'), false);
  } finally {
    if (prevStore === undefined) delete process.env.CARD_STORE;
    else process.env.CARD_STORE = prevStore;
    if (prevFile === undefined) delete process.env.TOMBSTONE_FILE;
    else process.env.TOMBSTONE_FILE = prevFile;
  }
});
