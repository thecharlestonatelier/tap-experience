/* The /studio prefix is its own web root: a path that climbs out of it
   must be refused and must never serve the service's own source. Pins
   the containment the traversal fix hardened. Run against a fixed-code
   server (any of the runbook ports; BASE env overrides). */
const BASE = process.env.BASE || 'http://localhost:8096';

let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};
const get = async p => {
  try {
    const r = await fetch(`${BASE}${p}`);
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  } catch (e) {
    return { error: String(e && e.message || e).slice(0, 200) };
  }
};

/* Arrange — the studio itself answers, so the probes below are meaningful */
const home = await get('/studio/');
check('the studio is served', home.status === 200, `HTTP ${home.status}`);

/* Act — climbs out of the studio root, in both encodings */
const climbs = [
  '/studio/..%2f..%2fserver.js',
  '/studio/%2e%2e%2f%2e%2e%2fpackage.json',
  '/studio/..%2f..%2f..%2fetc%2fpasswd'
];
for (const p of climbs) {
  const r = await get(p);
  /* Assert — refused, and the service's own source never appears */
  check(`${p} is refused`,
    r.status === 403 || r.status === 404 || r.status === 400, `HTTP ${r.status}`);
  check(`${p} leaks no server source`,
    !r.body.includes('node:http') && !r.body.includes('atelier tap service on'),
    (r.body || '').slice(0, 80));
}

/* Act — the service still answers after the climbs */
const after = await get('/health');
/* Assert — alive */
check('the service survives the studio climbs', after.status === 200,
  after.error || `HTTP ${after.status}`);

console.log(bad ? `\n${bad} FAILED` : '\nPASS — the studio root is contained.');
process.exit(bad ? 1 : 0);
