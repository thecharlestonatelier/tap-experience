/* Browser test harness: a real portal server on a file store, plus a
   headless Chromium, for pinning the front-end pages. No Firebase and no
   Auth emulator are needed for the pages that do not gate. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PORTAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function vapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  return {
    publicKey: Buffer.from(pub).toString('base64url'),
    privateKey: privateKey.export({ format: 'jwk' }).d,
  };
}

export async function startPortal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-browser-'));
  const port = 8200 + Math.floor(Math.random() * 700);
  const keys = vapid();
  const env = {
    ...process.env,
    CARD_STORE: 'file',
    CARD_FILE: path.join(dir, 'cards.json'),
    DOSE_FILE: path.join(dir, 'doses.json'),
    SUB_FILE: path.join(dir, 'subs.json'),
    FEED_FILE: path.join(dir, 'feeds.json'),
    TOMBSTONE_FILE: path.join(dir, 'tombstones.json'),
    STUDIO_PASSPHRASE: 'testpassphrase',
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'mailto:test@example.com',
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

/* Headless Chromium has no push service. Stand in for that one piece — the
   browser's plumbing, not ours — so the subscribe path runs for real. */
export function stubPush(page) {
  return page.addInitScript(() => {
    const keys = {
      p256dh: 'BEl6-VJHF0Vy0kMluQKGRLLBZZmJ5jVCbMLm7DL9oCcXvhTMhVvGP8SNVsN9tRhVh5j3zvNBHJQFwCiJZ3vTiHY',
      auth: 'k9XzM1nQpR7sT2uVwXyZ0A',
    };
    const KEY = 'stub.push.live';
    const fake = {
      get endpoint() { return 'https://fcm.googleapis.com/stub/' + keys.auth; },
      toJSON() { return { endpoint: this.endpoint, keys }; },
      async unsubscribe() { localStorage.removeItem(KEY); return true; },
    };
    const pushManager = {
      async getSubscription() { return localStorage.getItem(KEY) ? fake : null; },
      async subscribe() { localStorage.setItem(KEY, '1'); return fake; },
    };
    const registration = { pushManager, scope: location.origin + '/' };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        async register() { return registration; },
        async getRegistration() { return registration; },
        get ready() { return Promise.resolve(registration); },
      },
    });
    window.PushManager = function () {};
  });
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
