/* Prove the service survives a hostile path (see the QA report, Bug #1):
   an unauthenticated traversal must be refused, and the process must keep
   serving. Run against a DEDICATED server (the bug currently kills it):
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

/* Act — one unauthenticated directory climb */
const escape = `${'..%2f'.repeat(4)}etc%2fpasswd`;
const hostile = await get(`/${escape}`);

/* Assert — refused, and the service is still alive */
check('service answered before the hostile path', before.status === 200, JSON.stringify(before));
check('the climb is refused', hostile.status === 403 || hostile.status === 404,
  `${hostile.status} ${hostile.body}`);
const after = await get('/health');
check('the service survives the hostile path', after.status === 200,
  after.error || `${after.status} ${after.body}`);

console.log(bad ? `\n${bad} FAILED` : '\nPASS — a traversal is refused without killing the service.');
process.exit(bad ? 1 : 0);
