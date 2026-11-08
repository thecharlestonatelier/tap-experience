/* Parent-side promotion. The container only ever writes to a tmpfs; this
   copies the evidence out with the controls the audit skill requires:
   path confinement, no symlinks, regular files only, per-file and total
   size caps, and exclusive creation. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [rawRoot, outRoot] = process.argv.slice(2);
if (!rawRoot || !outRoot) {
  console.error('usage: promote.mjs <raw-dir> <out-dir>');
  process.exit(64);
}

const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 16 * 1024 * 1024;

const rawAbs = fs.realpathSync(rawRoot);
fs.mkdirSync(outRoot, { recursive: true });
const outAbs = fs.realpathSync(outRoot);

const promoted = [];
let total = 0;

function inside(base, candidate) {
  const rel = path.relative(base, candidate);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { promoted.push({ file: full, skipped: 'symlink' }); continue; }
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.isFile()) { promoted.push({ file: full, skipped: 'not a regular file' }); continue; }

    const real = fs.realpathSync(full);
    if (!inside(rawAbs, real)) { promoted.push({ file: full, skipped: 'escapes raw root' }); continue; }

    const st = fs.statSync(real);
    if (!st.isFile()) { promoted.push({ file: full, skipped: 'not a regular file' }); continue; }
    if (st.size > MAX_FILE) { promoted.push({ file: full, skipped: 'file too large', size: st.size }); continue; }
    if (total + st.size > MAX_TOTAL) { promoted.push({ file: full, skipped: 'total budget exceeded', size: st.size }); continue; }

    const rel = path.relative(rawAbs, real);
    const dest = path.join(outAbs, rel);
    if (!inside(outAbs, dest)) { promoted.push({ file: full, skipped: 'destination escapes' }); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const data = fs.readFileSync(fd);
      const target = fs.openSync(dest, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      try { fs.writeFileSync(target, data); } finally { fs.closeSync(target); }
      total += data.length;
      promoted.push({
        file: rel,
        bytes: data.length,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
      });
    } finally {
      fs.closeSync(fd);
    }
  }
}

walk(rawAbs);

const report = {
  raw: rawAbs,
  out: outAbs,
  total_bytes: total,
  limits: { max_file: MAX_FILE, max_total: MAX_TOTAL },
  promoted,
};
fs.writeFileSync(path.join(outAbs, 'promotion.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ promoted: promoted.filter(p => !p.skipped).length, skipped: promoted.filter(p => p.skipped).length, total_bytes: total }));
