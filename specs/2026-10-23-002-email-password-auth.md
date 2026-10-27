# Email and Password Authentication

**Spec ID:** SPEC-002
**Date:** 2026-10-23
**Slug:** email-password-auth
**Status:** Draft

## 1. Overview

This spec adds email and password authentication to the first-tap card gate.
The new method sits next to the Google sign-in from SPEC-001. A patient can
sign in with Google, or create an account with a name, an email, and a
password, or sign in with an existing email account. The link-once model from
SPEC-001 does not change. Whichever provider signs in first links the card.
`activatedBy` is written once and never overwritten.

## 2. Goals and Non-Goals

### Goals

- Add Firebase email and password authentication next to the Google sign-in.
- Let a patient create an account with a name, an email, and a password at the
  first tap.
- Let a patient with an existing email account sign in directly.
- Keep the Google sign-in flow from SPEC-001 unchanged.
- Keep the link-once rule. The first provider to sign in links the card.
- Add a forgot-password reset flow with a Firebase reset email.
- Keep the no-build invariant. Add no new SDK and no new server dependency.

### Non-Goals

- Sign in with Apple. This stays deferred.
- Separate usernames. The email is the sign-in identifier.
- Auto-merge or link two providers for one person. This is rejected.
- A server change. None is expected.
- Branding the Firebase reset page. This stays out of scope.

## 3. Current Behavior

Today the gate offers one provider. It shows one Google button and one
"Message the atelier" fallback link (`000-system.md §3.2`). The gate lives in
`patients/jessica/assets/auth-gate.js`. It loads the Firebase Auth SDK from the
gstatic CDN and posts the ID token to `POST /api/activate/<slug>`
(`000-system.md §4.1`). The service derives `activatedBy.name` from the ID
token's name claim and `activatedBy.provider` from
`decoded.firebase.sign_in_provider` (`portal/server.js`, lines 503-508). The
store links a card exactly once and compares only the uid
(`portal/store/index.js`). A different-uid tap shows the stuck screen.

## 4. Invariants and Scope Boundary

These must not change:

- The no-build constraint. The portal stays plain ES modules.
- The slug as the credential. The card address keeps working.
- The public shape of the card read (`/api/card/<slug>`).
- The link-once rule. `activatedBy` is written once and never overwritten.
- The rule that no clinical record transits a host without a BAA.
- The rule that a card that cannot reach the service still shows its dose.

These are excluded from this spec:

- Sign in with Apple.
- Account linking or provider merge.
- A server change. This spec records only the assumption and the fallback.
- Card Studio changes. Studio stays as in SPEC-001.

## 5. User Flows

### 5.1 First tap — email sign-up

The atelier creates a card. The patient taps the card. The gate shows. The
patient taps the secondary "use email instead" path. The gate shows the sign-up
form. The patient enters a name, an email, and a password. The gate validates
the email format and the password length. The gate creates the account. The
gate writes the display name. The gate refreshes the ID token. The card posts
the token to the activate endpoint. The service links the card. The portal
opens.

### 5.2 First tap — Google

This flow does not change from SPEC-001. The patient taps "Sign in with
Google". Google sign-in runs. The card links to the Google account.

### 5.3 Return tap

The patient taps the card again on the same device. The device has a live
session. The portal opens. The gate does not appear. This flow does not change.

### 5.4 Session lost

The session is gone. The gate shows again. The patient signs in with the same
method. The gate verifies that the signed-in uid matches the linked uid. It
writes nothing. The portal opens.

### 5.5 Email sign-in failure

The patient signs in with an email and a password. The email is wrong, or the
password is wrong. The gate shows one uniform failure message. The message does
not reveal which part was wrong.

### 5.6 Forgot-password reset

The patient taps "Forgot password?" on the sign-in form. The patient enters the
email. The gate sends a Firebase reset email. The email carries a link. The
patient opens the link on a Firebase-owned page. The patient sets a new
password. Firebase redirects the patient back to the card. The patient signs in
with the new password.

### 5.7 Same-email-other-provider block

A card already links to a Google account. A person taps the card and opens the
email path. That person enters an email that already belongs to the linked
Google account. The create path returns `auth/email-already-in-use`. The gate
shows the refined stuck message. The message says the card already uses Google
and tells the person to sign in with Google. `activatedBy` never changes. The
reverse case is the same: a card links to an email account, and a Google tap
for the same email shows the refined stuck message.

## 6. Functional Requirements

### 6.1 The welcome gate

- **FR-1.** Keep the gate once inside the shared `loadProtocol()` boot. Do not
  add the gate per page.
- **FR-2.** Show the gate only for a stored card. Do not show the gate for a
  fragment or legacy card.
- **FR-3.** Show two options on the welcome gate. Show the primary
  "Sign in with Google" button and a secondary "use email instead" path.
- **FR-4.** Keep the "Message the atelier" fallback link below the two options.

### 6.2 The email form

- **FR-5.** Put one form behind the secondary path. The form toggles between
  sign-in and sign-up modes.
- **FR-6.** Show the name field only in sign-up mode. Do not show the name
  field in sign-in mode.
- **FR-7.** Validate the email format in the browser before any SDK call.
- **FR-8.** Validate the password length in the browser before any SDK call.
  Require a minimum of 8 characters. Firebase's default minimum is 6. Do not
  accept fewer than 8.
- **FR-9.** Show one error region on the form. Show field errors next to the
  field. Show one uniform message for a failed sign-in.

### 6.3 Sign-up

- **FR-10.** Create the account with `createUserWithEmailAndPassword` from the
  existing `firebase-auth.js` bundle. Import no new SDK.
- **FR-11.** After account creation, set the display name with
  `updateProfile(auth.currentUser, { displayName })`.
- **FR-12.** After setting the name, force a token refresh with
  `user.getIdToken(true)`. Post only the refreshed token to the activate
  endpoint. A token minted before the name write stores an empty name.
- **FR-13.** Treat `auth/email-already-in-use` on the create path as the
  "account already exists" signal. Do not call `fetchSignInMethodsForEmail`.

### 6.4 Sign-in

- **FR-14.** Sign in with `signInWithEmailAndPassword` from the existing
  `firebase-auth.js` bundle.
- **FR-15.** Show one uniform failure message for a failed sign-in. Do not use
  `auth/user-not-found` or `auth/wrong-password` to choose a path. Email
  enumeration protection makes these unreliable.
- **FR-16.** Do not use `auth/user-not-found` to switch between sign-in and
  sign-up.

### 6.5 Forgot password

- **FR-17.** Add a "Forgot password?" action on the sign-in form.
- **FR-18.** Send the reset email with `sendPasswordResetEmail(auth, email,
  actionCodeSettings)` from the existing bundle.
- **FR-19.** Set `actionCodeSettings` to
  `{ url: '<origin>/<slug>', handleCodeInApp: false }`. The reset completes on
  the Firebase `__/auth/action` page and redirects back to the card.
- **FR-20.** Resolve the reset request even for an unregistered address. Do not
  reveal whether the address exists.

### 6.6 The stuck screen

- **FR-21.** Refine the stuck-screen copy. When the linked provider is known,
  tell the person which method to use. For example, "This card is already
  activated with Google. Use Sign in with Google." Do not overwrite
  `activatedBy`.

### 6.7 Tests

- **FR-22.** Change the assertion in `portal/tests/gate.mjs` that expects one
  button. The gate now shows a Google button and an email path.
- **FR-23.** Add `portal/tests/gate-email.mjs`. It covers sign-up, sign-in,
  and reset.
- **FR-24.** Add email helpers to `portal/tests/auth-session.mjs`. Name them
  `signUpEmail` and `signInEmail`. Use the same CDN SDK the gate uses.
- **FR-25.** Keep the "tests authenticate like patients, no bypass" policy in
  `portal/tests/README.md`.

## 7. Data Model

### 7.1 `activatedBy`

The field does not change. It still holds `uid`, `provider`, `name`, and `at`.

```json
{
  "activatedBy": {
    "uid": "AbC123xYz...",
    "provider": "password",
    "name": "Phillip",
    "at": "2026-10-23T12:34:56.789Z"
  }
}
```

Field rules:

- `provider` is `password` for an email and password user. The service reads
  this value from `decoded.firebase.sign_in_provider` (`portal/server.js`, line
  505). For a Google user it stays `google.com`.
- `name` comes from the typed name at sign-up. The gate writes it with
  `updateProfile`. The service reads it from the ID token's name claim, as it
  does today. The force refresh in FR-12 makes the name present.
- `uid` is the Firebase Auth uid. It is opaque and stable.
- The store compares only the uid. The provider value does not change the
  link-once logic.
- No email is stored. The email stays in Firebase Auth only.

## 8. Non-Functional Requirements

- **NFR-1 (No build).** The SDK loads from the CDN. No bundler enters the
  project.
- **NFR-2 (No new server dependency).** The service keeps only
  `firebase-admin` and `@google-cloud/firestore`.
- **NFR-3 (Privacy).** No email is stored. `name` is PHI and stays in Firestore
  behind the BAA.
- **NFR-4 (Enumeration protection).** The gate shows one uniform sign-in
  failure. The reset request resolves for any address.
- **NFR-5 (Compatibility).** The flow works on iOS Safari, Android, and
  desktop. The iOS home-screen case from SPEC-001 is tested.
- **NFR-6 (Local development).** The flow runs on the Firebase Auth and
  Firestore emulators with no live project.
- **NFR-7 (Failure tolerance).** A card past the gate keeps its current
  behavior when the service is unreachable.

## 9. Acceptance Criteria

- **AC-1.** The welcome gate shows a Google button and an email path.
- **AC-2.** A patient opens the email path and sees a form. The name field
  shows only in sign-up mode.
- **AC-3.** The form rejects an email with a bad format and a password shorter
  than 8 characters, before any SDK call.
- **AC-4.** A new patient creates an account with a name, an email, and a
  password. The card links. The portal opens. `activatedBy.name` equals the
  typed name.
- **AC-5.** `activatedBy.provider` equals `password` after an email sign-up.
- **AC-6.** An existing email patient signs in directly. The portal opens. The
  card writes nothing again.
- **AC-7.** A wrong email or password shows one uniform failure message. The
  message reveals nothing about which part was wrong.
- **AC-8.** The forgot-password action sends a reset email. The reset link
  completes on the Firebase page and returns to the card.
- **AC-9.** A same-email-other-provider tap shows the refined stuck message.
  `activatedBy` never changes.
- **AC-10.** The Google flow from SPEC-001 still passes its own criteria.
- **AC-11.** `portal/tests/gate.mjs` and `portal/tests/gate-email.mjs` pass
  against the emulators. `auth-session.mjs` exposes `signUpEmail` and
  `signInEmail`.
- **AC-12.** No new SDK and no new server dependency enter the project.

## 10. Research and Best Practices

The tap portal is a static, no-build site: plain ES modules load `firebase-app.js`
and `firebase-auth.js` 13.1.0 from the gstatic CDN
(`patients/jessica/assets/auth-gate.js`). Card writes go only through the Cloud
Run service (`portal/server.js`), which verifies ID tokens with `firebase-admin`.
Email and password sign-in extends that shape with no new SDK and no server
change.

- **Email/password client flows.** `createUserWithEmailAndPassword`,
  `signInWithEmailAndPassword`, `updateProfile`, and `sendPasswordResetEmail`
  are all part of the modular `firebase-auth.js` bundle the gate already
  imports (<https://firebase.google.com/docs/auth/web/password-auth>,
  <https://firebase.google.com/docs/auth/web/manage-users>). No new dependency
  enters the project; the no-build invariant holds.
  - Verdict: Applicable. Rationale: `auth-gate.js` already imports
    `firebase-auth.js` 13.1.0 from the CDN.

- **The stored name for email/password users.** The service derives
  `activatedBy.name` from the ID token's name claim (`portal/server.js`). A
  Google token carries it automatically. An email/password user has no name
  until `updateProfile(auth.currentUser, { displayName })` runs after
  `createUserWithEmailAndPassword`. The ID token minted at account creation
  predates that write, so the gate must call `user.getIdToken(true)` (force
  refresh) before posting to `/api/activate/<slug>`, or the name is stored empty
  (<https://firebase.google.com/docs/auth/web/manage-users>,
  <https://firebase.google.com/docs/auth/admin/verify-id-tokens>).
  - Verdict: Applicable. Rationale: this is the one place the existing server
    derivation could silently break.

- **Error handling under email enumeration protection.** Projects created after
  September 15, 2023 have email enumeration protection on by default. This makes
  `signInWithEmailAndPassword` return the generic `auth/invalid-credential` for
  both unknown-email and wrong-password, and makes `sendPasswordResetEmail`
  resolve even for unregistered addresses
  (<https://firebase.google.com/docs/auth/web/password-auth>). The gate must show
  one uniform sign-in failure message and must not use `auth/user-not-found` to
  choose between sign-in and sign-up. The reliable "account already exists"
  signal is `auth/email-already-in-use` on the create path, or
  `fetchSignInMethodsForEmail`.
  - Verdict: Applicable. Rationale: the repo is public and the project is
    assumed enumeration-protected.

- **Two-provider welcome gate.** A phone-first gate shows one primary Google
  button, a secondary "use email instead" path, and a single form toggling
  sign-in and sign-up. The name field appears only in sign-up mode. Validate
  email format and password length client-side, and enable a console password
  policy if a minimum above Firebase's default of 6 characters is wanted
  (<https://firebase.google.com/docs/auth/web/password-auth>,
  <https://docs.cloud.google.com/identity-platform/docs/password-policy>).
  - Verdict: Applicable. Rationale: `showWelcome()` in `auth-gate.js` is the
    extension point, and `portal/tests/gate.mjs` currently asserts one button
    and must change.

- **Same email under two providers.** Firebase's account-linking flow merges
  two sign-in methods into one uid, but the card links by uid and stores PHI,
  and `linkWithCredential` has a documented SDK issue
  (<https://firebase.google.com/docs/auth/web/account-linking>,
  <https://github.com/firebase/firebase-js-sdk/issues/7675>). Do not auto-merge.
  Keep the first-provider-wins block, and refine the stuck-screen copy so a
  patient who already used one provider is told to use it again.
  - Verdict: Reject linking. Rationale: adopt the block-with-message refinement.

- **Forgot password.** `sendPasswordResetEmail(auth, email, actionCodeSettings)`
  sends the default template. Pass `actionCodeSettings = { url: '<origin>/<slug>',
  handleCodeInApp: false }` so the reset completes on Firebase's `__/auth/action`
  page and redirects back to the card
  (<https://firebase.google.com/docs/auth/web/manage-users>,
  <https://firebase.google.com/docs/auth/web/passing-state-in-email-actions>).
  - Verdict: Applicable. Rationale: the continue URL is the card's own origin.

- **Local development and tests.** The Auth emulator supports email/password and
  captures reset emails rather than sending them. A Playwright suite signs up
  and signs in with the same CDN SDK the gate uses, and verifies reset by
  obtaining the out-of-band code from the Admin SDK's
  `generatePasswordResetLink` against the emulator, then calling
  `confirmPasswordReset` in the browser
  (<https://firebase.google.com/docs/emulator-suite/connect_auth>,
  <https://firebase.google.com/docs/auth/admin/email-action-links>).
  - Verdict: Applicable. Rationale: extend `portal/tests/auth-session.mjs`
    alongside `signInGoogle`, keeping the "tests authenticate like patients, no
    bypass" policy in `portal/tests/README.md`.

- **Server impact.** `activatedBy.provider` is read from
  `decoded.firebase.sign_in_provider`, which is `password` for email/password
  users, and `store.activate` compares only the uid. No server change is
  expected unless the force-refreshed token proves to lack the name claim. In
  that case a `getUser(uid).displayName` lookup is the fallback.
  - Verdict: Applicable. Rationale: record the assumption and the fallback.

## 11. Baseline Impact

When this feature lands, update these sections of `specs/000-system.md`:

- `§3.2` (Card boot): the gate now shows two provider options, Google and
  email and password.
- `§3.6` (Card Studio): no change. Studio stays as in SPEC-001.
- `§4.1` (HTTP endpoints): the endpoint list does not change. Fix the small
  word "Google uid" to "Firebase uid" in the `/api/activate/<slug>` note.
- `§5` (Constraints): add two deploy-time notes. Enable the email and password
  provider in the Firebase console. Set a console password policy for a
  minimum of 8 characters, and note that the reset page is Firebase-owned and
  unbranded.

## 12. Risks

- **R1 — Stale token name.** A token minted before the name write stores an
  empty name. Mitigate: force a refresh with `getIdToken(true)` in FR-12. If
  the refreshed token still lacks the name, use the `getUser(uid).displayName`
  fallback on the server.
- **R2 — Enumeration-protection drift.** A future Firebase change or an older
  project could restore `auth/user-not-found`. Mitigate: never branch on that
  code. Use only `auth/email-already-in-use` and one uniform failure message.
- **R3 — Password policy mismatch.** The client enforces 8 characters. Firebase
  default is 6. Mitigate: set a console password policy of 8 characters at
  deploy time. This is a deploy prerequisite, not code.
- **R4 — Reset-page branding.** The reset page is Firebase-owned and does not
  carry the atelier's look. Mitigate: accept it now. Note it as a deploy-time
  consideration.

## 13. Settled Decisions and Open Questions

### Settled decisions

- Use Firebase native email and password. No separate usernames.
- The patient picks Google or creates an account at the first tap. Existing
  email accounts sign in directly.
- Minimum password length is 8, enforced in the browser. The console password
  policy is a deploy prerequisite, not code.
- No auto-merge or linking of providers. A same-email-other-provider tap shows
  the refined stuck message. `activatedBy` is never overwritten.
- Do not call `fetchSignInMethodsForEmail`. Use `auth/email-already-in-use`
  from the create path.
- The reset continue URL is `<origin>/<slug>`. The reset page is
  Firebase-owned. Branding is out of scope.
- No server change is expected. Record the assumption and the
  `getUser(uid).displayName` fallback as a risk.

### Open questions

None block the build. Two minor choices are left to the implementer:

1. The exact label for the secondary "use email instead" path.
2. The exact stuck-screen sentence when the linked provider is known.

## 14. Glossary

- **slug.** The short address of a stored card, for example `/phil.h`.
- **stored card.** A card whose slug points to a Firestore record.
- **uid.** The opaque, stable Firebase Auth user identifier.
- **ID token.** A short-lived token from Firebase that proves a sign-in.
- **name claim.** The `name` field inside a Firebase ID token.
- **activatedBy.** The field on the card document that records `{uid,
  provider, name, at}`.
- **provider.** The identity provider id, for example `google.com` or
  `password`.
- **email enumeration protection.** A Firebase policy that hides whether an
  email is registered.
- **BAA.** Business Associate Agreement. Google signs one for covered services.
- **PHI.** Protected health information.
- **Firebase Auth.** Google's identity service.
- **Admin SDK.** The server-side Firebase library, `firebase-admin`.
- **force refresh.** A token request that bypasses the cache, `getIdToken(true)`.
- **loadProtocol.** The shared boot function in
  `patients/jessica/assets/protocol.js`.
- **auth-gate.js.** The first-tap auth gate ES module.
