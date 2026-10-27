/* Prove the service survives a hostile path (see the QA report, Bug #1):
   an unauthenticated traversal must be refused, and the process must keep
   serving — across every encoding a caller can carry a climb in. Run
   against a DEDICATED server (the bug used to kill it):
     CARD_STORE=file CARD_FILE=.data-test/traversal-cards.json PORT=8086 \
       STUDIO_PASSPHRASE=testpassphrase node server.js &
     node tests/traversal-crash.mjs */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8086';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };

let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};
const get = async p => {
  try {
    const r = await fetch(`${BASE}${p}`);
    return { status: r.status, body: (await r.text()).slice(0, 120) };
  } catch (e) {
    return { error: String(e && e.message || e).slice(0, 120) };
  }
};

/* Arrange — a studio session and the health baseline to compare against */
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
  body: JSON.stringify({ slug: 'trav.t', name: 'Traversal', pens: [{ template: 'ghk' }] }) });
const before = await get('/health');

/* Act — one climb in every encoding a caller could carry it in */
const CLIMBS = [
  `${'..%2f'.repeat(4)}etc%2fpasswd`,                  // plain encoded slash
  `${'%2e%2e%2f'.repeat(4)}etc%2fpasswd`,              // encoded dots and slash
  `${'..%2f'.repeat(30)}etc%2fpasswd`,                 // deep
  `${'%252e%252e%252f'.repeat(4)}etc%252fpasswd`,      // double-encoded
  `${'..%255c'.repeat(4)}etc%255cpasswd`,              // encoded backslash
  `....//....//etc/passwd`,                            // plain dots and slashes
  `..%2f..%2f..%2f..%2fetc%2fpasswd%00.html`           // trailing null byte
];

for (const climb of CLIMBS) {
  const hostile = await get(`/${climb}`);
  /* Assert — refused, whatever the encoding */
  check(`the climb ${climb.slice(0, 28)}… is refused`,
    [400, 403, 404].includes(hostile.status), `${hostile.status} ${hostile.body}`);
}

/* Assert — the service is still alive after all of them */
const after = await get('/health');
check('the service survives the hostile paths', after.status === 200,
  after.error || `${after.status} ${after.body}`);
check('the health baseline answered before the climbs', before.status === 200, JSON.stringify(before));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — a traversal in any encoding is refused without killing the service.');
process.exit(bad ? 1 : 0);
