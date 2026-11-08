/* Control probes. The audit gate is pass/fail: if any check here fails, the
   entrypoint refuses to run a reproduction. Each check is something the
   skill requires and Docker can provide; this file proves the run actually
   got it rather than trusting the command line. */
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns/promises';
import { execFileSync } from 'node:child_process';

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

function read(path) {
  try { return fs.readFileSync(path, 'utf8'); } catch { return null; }
}

/* --- identity and privilege ------------------------------------------------ */
const uid = process.getuid?.() ?? -1;
record('non-root-uid', uid !== 0, `uid=${uid}`);

const status = read('/proc/self/status') || '';
const cap = /^CapEff:\s*([0-9a-f]+)$/im.exec(status);
record('capabilities-empty', !!cap && /^0+$/.test(cap[1]), cap ? `CapEff=${cap[1]}` : 'CapEff missing');

const nnp = /^NoNewPrivs:\s*(\d+)$/im.exec(status);
record('no-new-privileges', !!nnp && nnp[1] === '1', nnp ? `NoNewPrivs=${nnp[1]}` : 'NoNewPrivs missing');

/* --- filesystem ------------------------------------------------------------ */
for (const [name, path] of [['repo-read-only', '/repo/.probe'], ['app-read-only', '/app/.probe']]) {
  let blocked = false;
  try { fs.writeFileSync(path, 'x'); } catch { blocked = true; }
  record(name, blocked, blocked ? `${path} refused` : `${path} was writable`);
}

let workWritable = false;
try {
  fs.writeFileSync('/work/.probe', 'x');
  fs.unlinkSync('/work/.probe');
  workWritable = true;
} catch {}
record('scratch-writable', workWritable, workWritable ? '/work writable' : '/work not writable');

/* --- resource limits ------------------------------------------------------- */
function cgv2(file) { return read(`/sys/fs/cgroup/${file}`); }
const memMax = cgv2('memory.max') || read('/sys/fs/cgroup/memory/memory.limit_in_bytes');
const mem = memMax && memMax.trim() !== 'max' ? Number(memMax.trim()) : null;
record('memory-limit', mem === null ? null : (mem > 0 && mem <= 1.5e9),
  mem === null ? 'not visible in container; parent verifies via docker inspect' : `memory.max=${memMax.trim()}`);

const pidsMax = cgv2('pids.max');
const pids = pidsMax && pidsMax.trim() !== 'max' ? Number(pidsMax.trim()) : null;
record('pids-limit', pids === null ? null : (pids > 0 && pids <= 512),
  pids === null ? 'not visible in container; parent verifies via docker inspect' : `pids.max=${pidsMax.trim()}`);

let fsize = null;
let fsizeRaw = '';
try {
  fsizeRaw = execFileSync('/bin/sh', ['-c', 'ulimit -f'], { encoding: 'utf8' }).trim();
  fsize = Number(fsizeRaw);
} catch {}
record('file-size-limit', Number.isFinite(fsize) && fsize > 0 ? true : null,
  Number.isFinite(fsize) && fsize > 0 ? `ulimit -f=${fsize} (512-byte blocks)` : `raw=${fsizeRaw || 'unreadable'}; parent verifies via docker inspect`);

/* --- network --------------------------------------------------------------- */
async function externalBlocked(host, port) {
  return await new Promise(resolve => {
    const s = net.connect({ host, port });
    const done = ok => { try { s.destroy(); } catch {} resolve(ok); };
    s.setTimeout(2500, () => done(true));
    s.once('connect', () => done(false));
    s.once('error', () => done(true));
  });
}
record('no-external-tcp', await externalBlocked('1.1.1.1', 443), 'TCP to 1.1.1.1:443');
let dnsBlocked = false;
try { await dns.lookup('example.com'); } catch { dnsBlocked = true; }
record('no-external-dns', dnsBlocked, 'DNS lookup for example.com');

let loopback = false;
try {
  await new Promise((resolve, reject) => {
    const srv = net.createServer(sock => {
      sock.on('error', () => {});
      sock.end('ok');
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const c = net.connect({ host: '127.0.0.1', port }, () => {
        c.destroy();
        srv.close(() => resolve());
      });
      c.on('error', e => { srv.close(() => reject(e)); });
    });
  });
  loopback = true;
} catch {}
record('loopback-works', loopback, '127.0.0.1 listener reachable');

/* --- environment ----------------------------------------------------------- */
const allow = new Set([
  'PATH', 'HOME', 'PWD', 'SHLVL', '_', 'TERM', 'HOSTNAME', 'PORT',
  'CARD_STORE', 'CARD_FILE', 'DOSE_FILE', 'SUB_FILE', 'FEED_FILE', 'TOMBSTONE_FILE',
  'STUDIO_PASSPHRASE', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
  'PUSH_RUN_SECRET', 'WEB_ROOT', 'NODE_ENV', 'NODE_EXTRA_CA_CERTS',
  'PLAYWRIGHT_BROWSERS_PATH', 'FIREBASE_EMULATORS_PATH',
  'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'FIRESTORE_EMULATOR_HOST',
  'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_CONFIG',
  'DEBIAN_FRONTEND', 'LANG', 'LC_ALL', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
]);
const unexpected = Object.keys(process.env).filter(k => !allow.has(k));
record('env-allowlist', unexpected.length === 0, unexpected.length ? `unexpected: ${unexpected.join(',')}` : 'only allowlisted vars');

/* --- result ---------------------------------------------------------------- */
/* A null check means "not observable inside the container". The parent
   verifies those against `docker inspect` and records the result in
   containment.json; only an explicit false fails the gate here. */
const ok = results.every(r => r.ok !== false);
const out = { ok, at: new Date().toISOString(), uid, results };
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(ok ? 0 : 1);
