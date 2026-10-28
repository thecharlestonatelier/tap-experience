/* The atelier alert stays silent when a blank tag starts being used, and
   rings when a prescription is stopped. atelier-alert.mjs pins the general
   alert; this pins the blank flip: a blank tag flipping active via
   POST /api/added with only `added` (no dropped) must not ring, while a
   prescribed pen stopped on an already-assigned card must still ring once.

   Needs the push sink recording to /tmp/hits.json and VAPID keys (see
   push-flow.mjs), plus a Studio session cookie in /tmp/tok.txt:
     source /tmp/qa-env.sh /tmp/qa-vapid.env && BASE=http://localhost:8096 node tests/alert-blank-flip.mjs */
import crypto from 'node:crypto';
import fs from 'node:fs';

/* Arrange — the harness, and the sink's hit log */
const BASE = process.env.BASE || 'http://localhost:8096';
const TOK = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hits = () => { try { return JSON.parse(fs.readFileSync('/tmp/hits.json', 'utf8')); } catch { return []; } };
const since = n => hits().length - n;

/* Arrange — the atelier's laptop: a real P-256 key, because the payload is
   really encrypted to it and a made-up one fails silently */
const dev = crypto.createECDH('prime256v1'); dev.generateKeys();
const stamp = Date.now().toString(36);
/* A fixed endpoint unique to this suite, so a re-run merges into one
   subscription instead of accumulating (atelier-alert.mjs does the same). */
const sub = {
  endpoint: 'https://localhost:9443/atelier-blank-flip',
  keys: { p256dh: b64u(dev.getPublicKey()), auth: b64u(crypto.randomBytes(16)) }
};

/* Act — subscribe */
const on = await fetch(`${BASE}/api/push/atelier`, { method: 'POST', headers: H,
  body: JSON.stringify({ sub }) });
/* Assert — the device is listening, so a missed alert would be visible */
check('a device can subscribe', on.status === 201, `HTTP ${on.status}`);

/* Arrange — a blank tag, and an already-assigned card with a prescribed pen */
const blank = `abl${stamp}.q`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: blank, status: 'blank' }) });
const assigned = `abp${stamp}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: assigned, name: 'Alert Patient', pens: [{ template: 'ghk' }] }) });

/* Act — the blank tag flips active on a patient-added pen (added only) */
let n = hits().length;
await fetch(`${BASE}/api/added/${blank}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ added: [{ id: 'bpc+zz', template: 'bpc', startDate: '2026-10-20' }] }) });
await new Promise(r => setTimeout(r, 1200));
/* Assert — hers to do, not an alert */
check('a blank tag flipping active does not ring the atelier', since(n) === 0, `${since(n)} push(es)`);

/* Act — a prescribed pen is stopped on the assigned card */
n = hits().length;
await fetch(`${BASE}/api/added/${assigned}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dropped: ['ghk'] }) });
await new Promise(r => setTimeout(r, 1200));
/* Assert — exactly one push */
check('stopping a prescribed pen still rings once', since(n) === 1, `${since(n)} push(es)`);

/* Act — turn the device back off, so the run leaves nothing listening */
await fetch(`${BASE}/api/push/atelier`, { method: 'POST', headers: H,
  body: JSON.stringify({ off: true, endpoint: sub.endpoint }) });

console.log(bad ? `\n${bad} FAILED` : '\nPASS — a blank flip is silent; a stopped prescription rings.');
process.exit(bad ? 1 : 0);
