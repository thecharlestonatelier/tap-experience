/* ==================================================================
   PUBLIC FIREBASE CONFIGURATION
   ------------------------------------------------------------------
   What a browser needs to reach Firebase Authentication. Every value
   here is public — the apiKey is an identifier, not a secret; the real
   security is the Admin SDK verification on the service, which a
   browser can never reach.

   The live values come from the Firebase console for the atelier-tap
   project (Project settings → General → Your apps). Until the atelier
   pastes the real apiKey in, local development still works end to end:
   auth-gate.js connects to the Auth emulator whenever the page is
   served from localhost, and the emulator accepts any key.
   ================================================================== */

export const firebaseConfig = {
  // TODO(at deploy): the real Web API key for project atelier-tap.
  apiKey: 'atelier-tap-web-api-key-placeholder',
  authDomain: 'atelier-tap.firebaseapp.com',
  projectId: 'atelier-tap'
};
