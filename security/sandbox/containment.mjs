/* Parent-side containment verification. Reads `docker inspect` for the
   live container and asserts the run actually got the flags we passed.
   This is the authoritative check for limits Docker Desktop does not
   expose inside the container's cgroup view. */
import fs from 'node:fs';

const [inPath, outPath] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const c = Array.isArray(raw) ? raw[0] : raw;
const h = c.HostConfig || {};

const ulimits = h.Ulimits || [];
const fsize = ulimits.find(u => u.Name === 'fsize');

const checks = [
  ['network-none', h.NetworkMode === 'none', h.NetworkMode],
  ['readonly-rootfs', h.ReadonlyRootfs === true, h.ReadonlyRootfs],
  ['memory-1g', h.Memory === 1073741824, h.Memory],
  ['memory-swap-1g', h.MemorySwap === 1073741824, h.MemorySwap],
  ['pids-128', h.PidsLimit === 128, h.PidsLimit],
  ['cap-drop-all', (h.CapDrop || []).includes('ALL'), h.CapDrop],
  ['no-new-privileges', (h.SecurityOpt || []).some(s => String(s).includes('no-new-privileges')), h.SecurityOpt],
  ['fsize-ulimit', !!fsize && Number(fsize.Hard) > 0, fsize || null],
  ['non-root-user', c.Config && c.Config.User === '1000:1000', c.Config && c.Config.User],
  ['shm-256m', h.ShmSize === 268435456, h.ShmSize],
];

const ok = checks.every(([, pass]) => pass);
const out = {
  ok,
  at: new Date().toISOString(),
  observed: checks.map(([name, pass, value]) => ({ name, pass, value })),
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
process.exit(ok ? 0 : 1);
