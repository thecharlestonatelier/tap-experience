/* The atelier being told that a patient stopped a prescription:
   the subscription, the one push, the silence when nothing is new,
   and the rule that the payload names nobody and nothing clinical. */
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8095';
const TOK = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};
const b64u = b => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const hits = () => { try { return JSON.parse(fs.readFileSync('/tmp/hits.json', 'utf8')); } catch { return []; } };
const since = n => hits().length - n;

/* The atelier's laptop: a real P-256 key, because the payload is really
   encrypted to it and a made-up one fails silently. */
const dev = crypto.createECDH('prime256v1'); dev.generateKeys();
const sub = {
  endpoint: 'https://localhost:9443/atelier',
  keys: { p256dh: b64u(dev.getPublicKey()), auth: b64u(crypto.randomBytes(16)) }
};

const slug = `alert${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Alert Test', pens: [{ template: 'ghk' }, { template: 'bpc' }],
  settings: { startDate: '2026-10-22' } }) });

/* --- it is off until it is turned on --- */
let state = await (await fetch(`${BASE}/api/push/atelier`, { headers: H })).json();
check('off to begin with', state.on === 0 && state.available === true, JSON.stringify(state));

const anon = await fetch(`${BASE}/api/push/atelier`, { headers: { 'Content-Type': 'application/json' } });
check('and not readable without the passphrase', anon.status === 401, `HTTP ${anon.status}`);

/* --- turning it on --- */
const on = await fetch(`${BASE}/api/push/atelier`, { method: 'POST', headers: H,
  body: JSON.stringify({ sub }) });
check('a device can subscribe', on.status === 201, `HTTP ${on.status}`);
state = await (await fetch(`${BASE}/api/push/atelier`, { headers: H })).json();
check('and is counted', state.on === 1, JSON.stringify(state));

/* --- a patient stops a prescribed pen --- */
let n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: ['ghk'] }) });
await new Promise(r => setTimeout(r, 1200));
check('stopping a prescribed pen rings the atelier', since(n) === 1, `${since(n)} push(es)`);

/* --- her phone re-posting the same list must not ring again --- */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: ['ghk'] }) });
await new Promise(r => setTimeout(r, 1000));
check('the same list again rings nothing', since(n) === 0, `${since(n)} push(es)`);

/* --- a second pen is new, and does ring --- */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: ['ghk', 'bpc'] }) });
await new Promise(r => setTimeout(r, 1000));
check('a second pen rings once more', since(n) === 1, `${since(n)} push(es)`);

/* --- adding a peptide is hers to do and is not an alert --- */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ added: [{ id: 'bpc+zz', template: 'bpc', startDate: '2026-10-22' }] }) });
await new Promise(r => setTimeout(r, 1000));
check('adding one of her own does not ring', since(n) === 0, `${since(n)} push(es)`);

/* --- putting it back is not an alert either --- */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: [] }) });
await new Promise(r => setTimeout(r, 1000));
check('putting a pen back does not ring', since(n) === 0, `${since(n)} push(es)`);

/* --- the record still says what was prescribed --- */
const rec = await (await fetch(`${BASE}/api/card/${slug}`)).json();
check('and the prescription is intact throughout',
      JSON.stringify(rec.pens) === JSON.stringify([{ template: 'ghk' }, { template: 'bpc' }]),
      JSON.stringify(rec.pens));

/* --- the payload carries nothing clinical ---
   Checked against the body the server actually builds, not a copy of it. */
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const line = (src.match(/'A patient has taken[^']*'/) || [''])[0].toLowerCase();
const forbidden = ['tirzepatide', 'semaglutide', 'nad', 'unit', ' mg', 'jessica', 'dusty', 'christie'];
const found = forbidden.filter(w => line.includes(w));
check('the notification names no drug and no patient', line && !found.length,
      found.length ? `contains ${found.join(', ')}` : line);

/* --- turning it off --- */
await fetch(`${BASE}/api/push/atelier`, { method: 'POST', headers: H,
  body: JSON.stringify({ off: true, endpoint: sub.endpoint }) });
state = await (await fetch(`${BASE}/api/push/atelier`, { headers: H })).json();
check('it can be turned off', state.on === 0, JSON.stringify(state));

n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: ['ghk'] }) });
await new Promise(r => setTimeout(r, 1000));
check('and then stays quiet', since(n) === 0, `${since(n)} push(es)`);

console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
