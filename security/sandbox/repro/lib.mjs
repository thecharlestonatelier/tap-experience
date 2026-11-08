/* Shared reproduction plumbing. Everything here runs inside the sandbox:
   the portal on 127.0.0.1, a Chromium from the image, and the file store
   under /work. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';

export { sleep };

export function vapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  return {
    publicKey: Buffer.from(pub).toString('base64url'),
    privateKey: privateKey.export({ format: 'jwk' }).d,
  };
}

export async function startPortal(extraEnv = {}) {
  const port = 8300 + Math.floor(Math.random() * 500);
  const env = {
    ...process.env,
    PORT: String(port),
    WEB_ROOT: '/app/public',
    ...extraEnv,
  };
  const child = spawn(process.execPath, ['server.js'], { cwd: '/app', env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(`${base}/health`); if (r.ok) return { base, port, child, stop: () => child.kill('SIGTERM') }; } catch {}
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error('portal did not start');
}

export async function session(base, passphrase = 'testpassphrase') {
  const r = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  const cookie = r.headers.getSetCookie().find(c => c.startsWith('ca_studio='));
  if (!cookie) throw new Error(`no session cookie (status ${r.status})`);
  return cookie.split(';')[0];
}

export async function call(base, path, { method = 'GET', cookie, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (body !== undefined) {
    if (typeof body === 'string') {
      payload = body;
      h['content-type'] = h['content-type'] || 'text/plain; charset=utf-8';
    } else {
      payload = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
  }
  const r = await fetch(base + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
}

export async function mint(base, cookie, body) {
  const r = await call(base, '/api/cards', { method: 'POST', cookie, body });
  if (r.status !== 201) throw new Error(`mint failed: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
}

export function emit(name, result) {
  process.stdout.write(JSON.stringify({ name, at: new Date().toISOString(), ...result }) + '\n');
}

/* Run a body and always emit a JSON result, even on a harness error. */
export async function guard(name, fn) {
  try {
    emit(name, { ok: true, ...(await fn()) });
  } catch (err) {
    emit(name, { ok: false, error: String(err && err.message || err) });
    process.exitCode = 1;
  }
}
