/* Browser test harness: a real portal server on a file store, plus a
   headless Chromium, for pinning the front-end pages. No Firebase and no
   Auth emulator are needed for the pages that do not gate. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORTAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function startPortal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-browser-'));
  const port = 8200 + Math.floor(Math.random() * 700);
  const env = {
    ...process.env,
    CARD_STORE: 'file',
    CARD_FILE: path.join(dir, 'cards.json'),
    DOSE_FILE: path.join(dir, 'doses.json'),
    SUB_FILE: path.join(dir, 'subs.json'),
    FEED_FILE: path.join(dir, 'feeds.json'),
    STUDIO_PASSPHRASE: 'testpassphrase',
    PORT: String(port),
  };
  const child = spawn(process.execPath, ['server.js'], { cwd: PORTAL, env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${base}/health`); if (r.ok) return { base, dir, stop: () => child.kill('SIGTERM') }; } catch {}
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error('portal did not start');
}

/* Seed a card through the clinician API and return the studio cookie. */
export async function seedCard(base, body) {
  const s = await fetch(`${base}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpassphrase' }),
  });
  const cookie = s.headers.getSetCookie().find(c => c.startsWith('ca_studio='));
  const r = await fetch(`${base}/api/cards`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { cookie, card: await r.json() };
}
