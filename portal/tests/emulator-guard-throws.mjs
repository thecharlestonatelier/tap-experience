/* The fail-closed guards, proven to throw rather than assumed. A suite
   process with no FIREBASE_AUTH_EMULATOR_HOST must stop before any
   network call; one pointed at a dead port must stop too; and with the
   emulator up the same guard must pass. Runs against the emulator on
   127.0.0.1:9099 — no service needed. */
import { requireAuthEmulatorHost, assertAuthEmulatorUp } from './emulator-guard.mjs';

let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};
const throws = async (fn, needle, label) => {
  try { await fn(); check(label, false, 'did not throw'); }
  catch (e) { check(label, String(e.message).includes(needle), e.message); }
};

/* Arrange — the environment the runner normally provides */
const saved = process.env.FIREBASE_AUTH_EMULATOR_HOST;

/* Act — with the variable missing */
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
/* Assert — refused, naming the variable */
await throws(() => requireAuthEmulatorHost(), 'FIREBASE_AUTH_EMULATOR_HOST is not set',
  'a missing host refuses to talk to live Firebase Auth');

/* Act — with a host that does not answer */
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:1';
/* Assert — refused, naming the host */
await throws(() => assertAuthEmulatorUp(), 'did not answer',
  'a dead emulator stops the suite');

/* Act — with the emulator really up */
process.env.FIREBASE_AUTH_EMULATOR_HOST = saved;
/* Assert — the guard passes, and nothing was disturbed */
await assertAuthEmulatorUp();
check('the guard passes when the emulator answers', true, saved);

console.log(bad ? `\n${bad} FAILED` : '\nPASS — the guards fail closed, and only fail closed.');
process.exit(bad ? 1 : 0);
