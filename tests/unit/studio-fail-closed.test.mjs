/* Fail closed: with no Studio passphrase, the dashboard is not reachable,
   not even in a deployment that forgot the secret. Local development must
   opt in explicitly with STUDIO_OPEN=1. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the studio is closed when no passphrase is configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-closed-'));
  const port = 8700 + Math.floor(Math.random() * 200);
  const env = {
    ...process.env,
    PORT: String(port),
    CARD_STORE: 'file',
    CARD_FILE: path.join(dir, 'cards.json'),
    DOSE_FILE: path.join(dir, 'doses.json'),
    SUB_FILE: path.join(dir, 'subs.json'),
    FEED_FILE: path.join(dir, 'feeds.json'),
    TOMBSTONE_FILE: path.join(dir, 'tombstones.json'),
    STUDIO_PASSPHRASE: '',
    STUDIO_OPEN: '',
    NODE_ENV: 'production',
  };
  const child = spawn(process.execPath, ['server.js'], { cwd: PORTAL, env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;

  try {
    let up = false;
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(`${base}/health`); if (r.ok) { up = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(up, 'server started');

    const session = await fetch(`${base}/api/session`).then(r => r.json());
    assert.equal(session.configured, false);
    assert.equal(session.required, true);
    assert.equal(session.signedIn, false);

    const post = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: 'anything' }),
    });
    assert.equal(post.status, 503, 'the session endpoint refuses to open');

    const cards = await fetch(`${base}/api/cards`);
    assert.equal(cards.status, 401, 'clinician routes are closed');
  } finally {
    child.kill('SIGTERM');
  }
});
