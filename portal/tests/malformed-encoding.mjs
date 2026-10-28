/* Prove the service treats a malformed percent-encoding — in a URL path, a
   card cookie, or the studio session cookie — as bad input and refuses it
   with a 4xx, never a 500 that leaks "URI malformed" (QA report).
   Run against any running server:
     CARD_STORE=file STUDIO_PASSPHRASE=testpassphrase PORT=8086 node server.js &
     BASE=http://localhost:8086 node tests/malformed-encoding.mjs */

const BASE = process.env.BASE || 'http://localhost:8086';
let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const req = async (path, opts = {}) => {
  try {
    const r = await fetch(`${BASE}${path}`, opts);
    return { status: r.status, body: (await r.text()).slice(0, 120) };
  } catch (e) { return { error: String(e && e.message || e).slice(0, 120) }; }
};

/* Arrange — the health baseline and a control page */
const before = await req('/health');
const control = await req('/ritual.html');

/* Act — a malformed escape in each kind of path */
for (const p of ['/ritual%zz.html', '/index%zz.html', '/dose%', '/v/%zz']) {
  const r = await req(p);
  /* Assert — refused with a 4xx, never a 500 */
  check(`malformed path ${JSON.stringify(p)} is refused (not 500)`,
    r.status >= 400 && r.status < 500, `${r.status} ${r.body}`);
}

/* Act — a malformed card cookie on the vial page */
const vBadCookie = await req('/v/abc123', { headers: { Cookie: 'ca_card=%zz' } });
/* Assert — the page still serves, no 500 */
check('a malformed ca_card cookie does not 500 the vial page',
  vBadCookie.status < 500, `${vBadCookie.status} ${vBadCookie.body}`);

/* Act — a malformed studio session cookie on the dashboard */
const sBadCookie = await req('/api/cards', { headers: { Cookie: 'ca_studio=%zz' } });
/* Assert — refused as unauthorized, not a 500 */
check('a malformed ca_studio cookie is refused as unauthorized (not 500)',
  sBadCookie.status === 401, `${sBadCookie.status} ${sBadCookie.body}`);

/* Assert — the service is alive, and the control page still serves */
const after = await req('/health');
check('the service survives the hostile encodings', after.status === 200, after.error || `${after.status} ${after.body}`);
check('the control page still serves', control.status === 200, `${control.status}`);
check('health answered before the probes', before.status === 200, JSON.stringify(before));

console.log(bad ? `\n${bad} FAILED` : '\nPASS — malformed encodings are refused without a 500.');
process.exit(bad ? 1 : 0);
