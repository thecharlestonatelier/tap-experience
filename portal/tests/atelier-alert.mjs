/* The atelier being told that a patient stopped a prescription:
   the subscription, the one push, the silence when nothing is new,
   and the rule that the payload names nobody and nothing clinical. */
import crypto from 'node:crypto';
import fs from 'node:fs';

/* Arrange — the harness, and the sink's hit log */
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

/* Arrange — the atelier's laptop: a real P-256 key, because the payload
   is really encrypted to it and a made-up one fails silently */
const dev = crypto.createECDH('prime256v1'); dev.generateKeys();
const sub = {
  endpoint: 'https://localhost:9443/atelier',
  keys: { p256dh: b64u(dev.getPublicKey()), auth: b64u(crypto.randomBytes(16)) }
};

/* Arrange — a patient's card with two prescribed pens */
const slug = `alert${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Alert Test', pens: [{ template: 'ghk' }, { template: 'bpc' }],
  settings: { startDate: '2026-10-22' } }) });

/* Act — read the subscription state */
let state = await (await fetch(`${BASE}/api/push/atelier`, { headers: H })).json();
/* Assert — off until turned on */
check('off to begin with', state.on === 0 && state.available === true, JSON.stringify(state));

/* Act — read it with no session */
const anon = await fetch(`${BASE}/api/push/atelier`, { headers: { 'Content-Type': 'application/json' } });
/* Assert — not readable without the passphrase */
check('and not readable without the passphrase', anon.status === 401, `HTTP ${anon.status}`);

/* Act — turn it on */
const on = await fetch(`${BASE}/api/push/atelier`, { method: 'POST', headers: H,
  body: JSON.stringify({ sub }) });
/* Assert — a device can subscribe, and is counted */
check('a device can subscribe', on.status === 201, `HTTP ${on.status}`);
state = await (await fetch(`${BASE}/api/push/atelier`, { headers: H })).json();
check('and is counted', state.on === 1, JSON.stringify(state));

/* Act — a patient stops a prescribed pen */
let n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: ['ghk'] }) });
await new Promise(r => setTimeout(r, 1200));
/* Assert — exactly one push */
check('stopping a prescribed pen rings the atelier', since(n) === 1, `${since(n)} push(es)`);

/* Act — her phone re-posts the same list */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: ['ghk'] }) });
await new Promise(r => setTimeout(r, 1000));
/* Assert — must not ring again */
check('the same list again rings nothing', since(n) === 0, `${since(n)} push(es)`);

/* Act — a second pen is newly stopped */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: ['ghk', 'bpc'] }) });
await new Promise(r => setTimeout(r, 1000));
/* Assert — rings once more */
check('a second pen rings once more', since(n) === 1, `${since(n)} push(es)`);

/* Act — she adds a peptide of her own */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ added: [{ id: 'bpc+zz', template: 'bpc', startDate: '2026-10-22' }] }) });
await new Promise(r => setTimeout(r, 1000));
/* Assert — hers to do, not an alert */
check('adding one of her own does not ring', since(n) === 0, `${since(n)} push(es)`);

/* Act — she puts the pen back */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: [] }) });
await new Promise(r => setTimeout(r, 1000));
/* Assert — not an alert either */
check('putting a pen back does not ring', since(n) === 0, `${since(n)} push(es)`);

/* Act — read the card back */
const rec = await (await fetch(`${BASE}/api/card/${slug}`)).json();
/* Assert — the prescription is intact throughout */
check('and the prescription is intact throughout',
      JSON.stringify(rec.pens) === JSON.stringify([{ template: 'ghk' }, { template: 'bpc' }]),
      JSON.stringify(rec.pens));

/* Act — take the notification body straight from the server source */
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const line = (src.match(/'A patient has taken[^']*'/) || [''])[0].toLowerCase();
const forbidden = ['tirzepatide', 'semaglutide', 'nad', 'unit', ' mg', 'jessica', 'dusty', 'christie'];
const found = forbidden.filter(w => line.includes(w));
/* Assert — nothing clinical rides in it */
check('the notification names no drug and no patient', line && !found.length,
      found.length ? `contains ${found.join(', ')}` : line);

/* Act — turn it off */
await fetch(`${BASE}/api/push/atelier`, { method: 'POST', headers: H,
  body: JSON.stringify({ off: true, endpoint: sub.endpoint }) });
state = await (await fetch(`${BASE}/api/push/atelier`, { headers: H })).json();
/* Assert — off */
check('it can be turned off', state.on === 0, JSON.stringify(state));

/* Act — a stop, with the alert off */
n = hits().length;
await fetch(`${BASE}/api/added/${slug}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: ['ghk'] }) });
await new Promise(r => setTimeout(r, 1000));
/* Assert — stays quiet */
check('and then stays quiet', since(n) === 0, `${since(n)} push(es)`);

console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
