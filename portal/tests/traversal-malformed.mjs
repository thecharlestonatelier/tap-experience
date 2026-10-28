/* Prove the service survives a malformed percent-encoding: %zz and the
   overlong / invalid UTF-8 sequences %c0%af, %e0%80%96 and %f0%80%80%96.
   traversal-crash.mjs covers climbs in valid encodings; these raw bytes
   defeat decodeURIComponent, and the service must answer a refusal or a
   500 rather than die, and keep serving afterwards. Run against a
   DEDICATED server (or any file-store port; BASE overrides):
     CARD_STORE=file CARD_FILE=.data-test/traversal-malformed-cards.json \
       PORT=8086 STUDIO_PASSPHRASE=testpassphrase node server.js &
     BASE=http://localhost:8086 node tests/traversal-malformed.mjs */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8086';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const get = async p => {
  try {
    const r = await fetch(`${BASE}${p}`);
    return { status: r.status, body: (await r.text()).slice(0, 120) };
  } catch (e) {
    return { error: String(e && e.message || e).slice(0, 120) };
  }
};

/* Arrange — a studio session, and the health baseline */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: `travm${Date.now().toString(36)}.t`, name: 'Traversal', pens: [{ template: 'ghk' }] }) });
const before = await get('/health');

/* Act — one malformed encoding in each form a caller can carry it in */
const MALFORMED = ['%c0%af', '%e0%80%96', '%f0%80%80%96', '%zz'];
for (const enc of MALFORMED) {
  const r = await get(`/${enc}`);
  /* Assert — refused or a 500 that does not crash the process */
  check(`the malformed ${enc} is refused or 500-without-crash`,
    [400, 403, 404, 500].includes(r.status),
    r.error || `${r.status} ${r.body}`);
}

/* Assert — the service is still alive after all of them */
const after = await get('/health');
check('the service survives the malformed encodings', after.status === 200,
  after.error || `${after.status} ${after.body}`);
check('the health baseline answered before the probes', before.status === 200, JSON.stringify(before));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — a malformed percent-encoding is answered without killing the service.');
process.exit(bad ? 1 : 0);
