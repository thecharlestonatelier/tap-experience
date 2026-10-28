/* Fail-closed emulator guards, shared by the suites.

   The two surfaces a suite can accidentally reach live Firebase with:

     1. firebase-admin in a Node suite (activate, unlink, gate-email,
        unlink-reattribute). With FIREBASE_AUTH_EMULATOR_HOST unset the
        Admin SDK quietly talks to the real identitytoolkit API — a
        missing env once sent a real createUser at it.

     2. The browser helpers in auth-session.mjs. The gate wires the Auth
        emulator only when the page is served from localhost; pointed at
        a deployed URL, signIn* would quietly sign into live Firebase.

   Both must refuse loudly instead. */

/* Throws unless the suite process is pointed at the Auth emulator. */
export function requireAuthEmulatorHost() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) {
    throw new Error(
      'FIREBASE_AUTH_EMULATOR_HOST is not set — refusing to talk to live ' +
      'Firebase Auth. Start the emulator first: ' +
      'firebase emulators:start --only auth');
  }
  return host;
}

/* Verifies the emulator named by FIREBASE_AUTH_EMULATOR_HOST actually
   answers, so a wrong port fails at the top of the suite instead of
   surfacing as a baffling SDK error. */
export async function assertAuthEmulatorUp() {
  const host = requireAuthEmulatorHost();
  let up = false;
  try {
    const r = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(3000) });
    up = r.ok;
  } catch { /* falls through to the throw below */ }
  if (!up) {
    throw new Error(
      `The Auth emulator at ${host} did not answer — start it with: ` +
      'firebase emulators:start --only auth');
  }
}

/* Throws unless the page is on the loopback, where the gate (and these
   helpers) wire the Auth emulator. Any other host means the suite is
   pointed at a real deployment, and signing in there is forbidden. */
export function requireLocalHost(page) {
  const url = String(page.url());
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
    throw new Error(
      `Refusing to sign into live Firebase from "${host}" — the gate wires ` +
      'the Auth emulator only on localhost. Point BASE at the local service.');
  }
  return url;
}
