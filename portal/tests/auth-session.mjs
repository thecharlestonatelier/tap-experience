/* Shared Playwright helper: sign a page into the Auth emulator as a fake
   Google account, the way a patient would — through the Firebase client
   SDK, against the emulator, persisted in the app's own session.

   Suites that need a stored card open import this, run signInGoogle(page)
   once, and every later navigation carries a real remembered session. The
   emulator accepts a JWT as the fake Google id_token and derives the
   account from its claims, so the same `identity` always means the same
   account — and a different identity is how a suite pretends to be a
   different person.

   Requires the Auth emulator on 127.0.0.1:9099 (firebase emulators:start
   --only auth). No production code is touched; this only speaks the same
   SDK calls the gate itself uses. */

const CDN_APP = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
const CDN_AUTH = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';

import { requireLocalHost } from './emulator-guard.mjs';

export async function signInGoogle(page, { identity = 'alice' } = {}) {
  requireLocalHost(page);
  await page.evaluate(async ({ identity, CDN_APP, CDN_AUTH }) => {
    // A JWT-shaped fake id_token, one stable account per identity.
    const b64u = s => btoa(unescape(encodeURIComponent(s)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const now = Math.floor(Date.now() / 1000);
    const jwt = b64u(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' +
      b64u(JSON.stringify({
        sub: `fake-${identity}`,
        email: `${identity}@example.com`,
        name: `${identity[0].toUpperCase()}${identity.slice(1)} Example`,
        iss: 'accounts.google.com',
        aud: 'atelier-tap',
        iat: now,
        exp: now + 3600
      })) + '.';

    const [{ firebaseConfig }] = await Promise.all([
      import('/assets/firebase.js'),
      import(CDN_APP),
      import(CDN_AUTH)
    ]);
    const { initializeApp } = await import(CDN_APP);
    const { getAuth, GoogleAuthProvider, signInWithCredential, connectAuthEmulator } = await import(CDN_AUTH);
    // Same default app the gate initializes, so the session is the gate's
    // own session — nothing is faked about the persistence layer.
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
    await signInWithCredential(auth, GoogleAuthProvider.credential(jwt, 'fake-access-token'));
  }, { identity, CDN_APP, CDN_AUTH });
}

/* Clear the session the way WebKit ITP can: drop the SDK's IndexedDB and
   anything else script-writable on the origin. The next navigation must
   show the gate again. */
export async function clearSession(page) {
  await page.evaluate(async () => {
    try { await new Promise(r => { const q = indexedDB.deleteDatabase('firebaseLocalStorageDb'); q.onsuccess = q.onerror = q.onblocked = r; }); } catch {}
    localStorage.clear();
    sessionStorage.clear();
  });
}

/* ---------- email + password ----------
   The same CDN SDK and emulator wiring the gate uses, so a suite holds a
   real Firebase session exactly like a patient. */

export function signUpEmail(page, { email = 'alice@example.com', password = 'password123', name = 'Alice Example' } = {}) {
  requireLocalHost(page);
  return page.evaluate(async ({ email, password, name, CDN_APP, CDN_AUTH }) => {
    const [{ firebaseConfig }] = await Promise.all([
      import('/assets/firebase.js'),
      import(CDN_APP),
      import(CDN_AUTH)
    ]);
    const { initializeApp } = await import(CDN_APP);
    const { getAuth, createUserWithEmailAndPassword, updateProfile, connectAuthEmulator } = await import(CDN_AUTH);
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    // Refresh the session's cached token so a later navigation links the
    // card with the name claim present — the same freshness the gate's
    // own sign-up path forces at link time.
    await cred.user.getIdToken(true);
  }, { email, password, name, CDN_APP, CDN_AUTH });
}

export function signInEmail(page, { email = 'alice@example.com', password = 'password123' } = {}) {
  requireLocalHost(page);
  return page.evaluate(async ({ email, password, CDN_APP, CDN_AUTH }) => {
    const [{ firebaseConfig }] = await Promise.all([
      import('/assets/firebase.js'),
      import(CDN_APP),
      import(CDN_AUTH)
    ]);
    const { initializeApp } = await import(CDN_APP);
    const { getAuth, signInWithEmailAndPassword, connectAuthEmulator } = await import(CDN_AUTH);
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
    await signInWithEmailAndPassword(auth, email, password);
  }, { email, password, CDN_APP, CDN_AUTH });
}
