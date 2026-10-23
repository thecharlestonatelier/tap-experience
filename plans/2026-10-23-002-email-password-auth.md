# Email and Password Authentication — Implementation Plan

**Spec:** `specs/2026-10-23-002-email-password-auth.md`
**Plan:** `plans/2026-10-23-002-email-password-auth.md`

## Context

- **What the spec requires.** Add Firebase email + password authentication next to
  the Google sign-in from SPEC-001. The welcome gate gains a secondary "use email
  instead" path behind a single form that toggles sign-in/sign-up (name field only
  on sign-up). Client validation requires a valid email format and a password of at
  least 8 characters before any SDK call. Sign-up runs
  `createUserWithEmailAndPassword` → `updateProfile(displayName)` →
  `getIdToken(true)` (force refresh) before `POST /api/activate/<slug>`. Sign-in
  runs `signInWithEmailAndPassword` and shows one uniform, non-enumerating failure
  message. `auth/email-already-in-use` on the create path is the "account already
  exists" signal (no `fetchSignInMethodsForEmail`). A "Forgot password?" action
  sends `sendPasswordResetEmail(auth, email, { url: '<origin>/<slug>',
  handleCodeInApp: false })`. The stuck screen gains provider-agnostic copy; no
  auto-merge and `activatedBy` is never overwritten. No server change is expected —
  `provider: 'password'` falls out of `decoded.firebase.sign_in_provider`
  automatically.
- **Graph status.** `GRAPH_USED` with a caveat. `graphify-out/graph.json` (report
  dated 2026-10-22, "first-tap-auth") covers the surrounding structure but does
  **not** include `patients/jessica/assets/auth-gate.js` or `firebase.js` — those
  files are absent from the manifest/corpus, and there are no `password`/`email`
  nodes. The graph still locates the integration points precisely: `loadProtocol()`
  (god node, 34 edges — the boot that awaits `window.__authGate.ensureActivated()`),
  the "Portal Store Subscriptions" / "Local File Store" / "Firestore" communities
  (`activate()` at `portal/store/index.js:280`/`:354`, which compares only the
  uid), the "Card Decode & Config Build" community (`loadProtocol`,
  `readSlug`), the "Page Boot & Card Links" community, and the "SMS Deep Links"
  community (`smsHref()` used by the stuck/welcome screens). `auth-gate.js` and
  `firebase.js` are grounded from direct file reads, not the graph.
- **Key constraints and applicable patterns.** No build step — the SDK stays the
  `firebase-app.js` + `firebase-auth.js` 13.1.0 CDN ES modules already imported by
  `auth-gate.js`; add no new SDK and no new server dependency. Enumeration
  protection: branch only on `auth/email-already-in-use` (create) and a single
  uniform sign-in failure message; never on `auth/user-not-found` or
  `auth/wrong-password`. The reset page is Firebase-owned (`__/auth/action`),
  unbranded. Tests authenticate like patients: same CDN SDK +
  `connectAuthEmulator` as `signInGoogle`; reset is verified via the Admin SDK
  `generatePasswordResetLink` (Node layer) → `oobCode` → `confirmPasswordReset` in
  the browser page. Emulators per `firebase.json` (Auth 9099, Firestore 8081);
  servers run with `FIREBASE_AUTH_EMULATOR_HOST` + `GOOGLE_CLOUD_PROJECT` per
  SPEC-001's README.

## Phases

### Phase 1 — Email helpers, gate assertion update, and the email form UI

**Goal:** `auth-session.mjs` exposes `signUpEmail`/`signInEmail` helpers, `gate.mjs`
stops asserting a single button, and `auth-gate.js` renders a working email form
(toggle + client validation) without yet wiring the SDK flows.

**Tasks:**
- [ ] Add `signUpEmail(page, { email, password, name })` to
      `portal/tests/auth-session.mjs`, mirroring `signInGoogle`: `page.evaluate`
      importing the same `CDN_APP`/`CDN_AUTH` and `/assets/firebase.js`, then
      `createUserWithEmailAndPassword(auth, email, password)` +
      `updateProfile(auth.currentUser, { displayName: name })`, with
      `connectAuthEmulator(auth, 'http://127.0.0.1:9099')` on localhost (FR-24,
      NFR-6).
- [ ] Add `signInEmail(page, { email, password })` to `auth-session.mjs`: same
      pattern, `signInWithEmailAndPassword(auth, email, password)` (FR-24).
- [ ] In `auth-gate.js`, extend the CDN import list with
      `createUserWithEmailAndPassword`, `signInWithEmailAndPassword`,
      `updateProfile`, `sendPasswordResetEmail` (the latter is used in Phase 3;
      add it now so the bundle is stable). No new CDN module — only new named
      exports from the already-imported `firebase-auth.js`.
- [ ] Add a secondary "use email instead" affordance to `showWelcome()` below the
      Google button, above the "Message the atelier" fallback link (FR-3, FR-4;
      spec open question 1 — default label "Use email instead"). Keep the Google
      button and the `sms:` fallback unchanged.
- [ ] Add the email form (one form, toggling sign-in/sign-up): an email input, a
      password input, a name input visible only in sign-up mode, a primary submit,
      a mode toggle ("Already have an account? Sign in" / "New here? Create
      account"), and a "Forgot password?" action visible only in sign-in mode
      (FR-5, FR-6, FR-17).
- [ ] Implement client validation before any SDK call: reject a malformed email and
      a password shorter than 8 characters, render a field error next to the field
      and a single form error region (FR-7, FR-8, FR-9). No `fetch`, no SDK call on
      invalid input.
- [ ] Update `portal/tests/gate.mjs`: the "exactly one Google button" assertion
      (`buttons === 1`) becomes "exactly one Google button **and** one email
      affordance"; assert the email affordance renders for the stored card
      (`gate.t`) and that fragment (`/#Gate~nad`) and legacy (`?card=legacy`) cards
      still show no gate (FR-22).

**Acceptance criteria:**
- The welcome gate shows a Google button and an email path (AC-1).
- The email path opens a form; the name field shows only in sign-up mode (AC-2).
- Malformed email and a password shorter than 8 are rejected before any SDK call
  (AC-3).
- `auth-session.mjs` exports `signUpEmail` and `signInEmail` (AC-11).
- `gate.mjs` passes with the two-option assertion (FR-22).

**Tests:**
```bash
# terminal 1 — Auth emulator (the helpers and gate connect to it)
firebase emulators:start --only auth

# terminal 2 — service on a seeded file store
cd portal
SEED_FILE=.data-test/gate-cards.json npm run seed
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/gate-cards.json PORT=8097 node server.js &

# terminal 3 — the gate UI suite (updated assertions)
node tests/gate.mjs
```
- `gate.mjs` must assert: `gate.t` shows one `Sign in with Google` button, one
  email affordance, and an `sms:` link; clicking the email affordance reveals the
  form; in sign-up mode the name field is present, toggling to sign-in hides it;
  submitting a bad email / a short password shows a field/form error and does not
  navigate or post to `/api/activate`; fragment and legacy cards show no
  `#auth-gate`.
- The email helpers are not yet exercised here (they are driven in Phase 4), but
  the module must load and export both functions without throwing.

**Touch points:**
- `portal/tests/auth-session.mjs`, `portal/tests/gate.mjs`,
  `patients/jessica/assets/auth-gate.js`.

**Baseline refs:**
- `specs/000-system.md` §3.2 (two provider options), §5 (no new SDK / no build).

---

### Phase 2 — Wire the flows: create, sign-in, name, force-refresh, link, error mapping, refined stuck copy

**Goal:** The email path actually authenticates and links: sign-up creates the
account, writes the display name, force-refreshes the ID token, and posts it to
`/api/activate/<slug>`; sign-in verifies an existing account; error cases map to
uniform/suggestive messages; the stuck screen gains provider-agnostic copy.

**Tasks:**
- [ ] Implement sign-up submit in `auth-gate.js`: `createUserWithEmailAndPassword`
      → on success `updateProfile(auth.currentUser, { displayName })` →
      `user.getIdToken(true)` → `POST /api/activate/<slug>` with only the
      refreshed token (FR-10, FR-11, FR-12; R1).
- [ ] Implement sign-in submit: `signInWithEmailAndPassword` → on success
      `user.getIdToken()` (no name write) → same activate POST (FR-14).
- [ ] Error mapping (FR-13, FR-15, FR-16): on the create path, map
      `auth/email-already-in-use` to an "account already exists — sign in instead"
      state (switch the form to sign-in mode and show a non-enumerating hint); do
      **not** call `fetchSignInMethodsForEmail`. On the sign-in path, map every
      credential failure (including `auth/invalid-credential`,
      `auth/user-not-found`, `auth/wrong-password`) to one uniform message that
      reveals nothing about which part was wrong (AC-7).
- [ ] Refined stuck copy (FR-21): keep the stuck screen provider-agnostic. The
      settled copy reads: "This card is already activated with a different account.
      If you used Google before, sign in with Google; if you used email, sign in
      with that email." It names both methods rather than guessing. Show it for
      every `409` uid-mismatch and for the same-email-other-provider case. The
      server's `409` body stays `{ error: 'uid_mismatch' }` — no provider field.
      `activatedBy` is never written by this path (it is only ever set server-side).
- [ ] Preserve `signedInUser()` / `ensureActivated()` behavior: email-authenticated
      users flow through the same `POST /api/activate/<slug>` → `200` open / `409`
      stuck / fetch-failure best-effort-open as Google users; the service needs no
      change because `provider` already derives from
      `decoded.firebase.sign_in_provider` (server.js:505) and `store.activate`
      compares only the uid.
- [ ] Record (not implement) the one server contingency in the plan notes, not as
      a code task: if the force-refreshed token still lacks the name claim, the
      fallback is `getUser(uid).displayName` on the service. The
      same-email-other-provider case needs no server support — the provider-agnostic
      stuck message above covers it, so the activate `409` stays
      `{ error: 'uid_mismatch' }`.

**Acceptance criteria:**
- A new account with name/email/password links the card; `activatedBy.name` equals
  the typed name (AC-4, the name-claim force-refresh).
- `activatedBy.provider` equals `password` after an email sign-up (AC-5).
- An existing email account signs in directly and the card writes nothing again
  (AC-6) — asserted end-to-end in Phase 4, but the code path is complete here.
- A wrong email or password shows one uniform message that reveals nothing (AC-7).
- `auth/email-already-in-use` on create suggests sign-in; no
  `fetchSignInMethodsForEmail` (FR-13).
- The stuck screen shows the provider-agnostic copy for a same-email-other-provider
  tap and for any `409` uid-mismatch; `activatedBy` never changes (AC-9 partial).

**Tests:**
```bash
# terminal 1 — Auth emulator
firebase emulators:start --only auth

# terminal 2 — service for gate-edge (regression of the Google block path)
cd portal
SEED_FILE=.data-test/gate-edge-cards.json npm run seed
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/gate-edge-cards.json \
  STUDIO_PASSPHRASE=testpassphrase PORT=8098 node server.js &

# terminal 3
node tests/gate-edge.mjs
```
- `gate-edge.mjs` must stay green with the Google helper unchanged (the email
  affordance must not break the block / remember / re-link paths). This is the
  SPEC-001 regression guard for the `409` → stuck-screen path (AC-10 partial).
- No dedicated new suite runs in this phase; the sign-up/sign-in/error paths are
  asserted by `gate-email.mjs` in Phase 4. Phase 2 is complete when `gate-edge.mjs`
  is green and the module still loads (a manual smoke against the emulator
  completes a create + link without error).

**Touch points:**
- `patients/jessica/assets/auth-gate.js` (flows + error mapping + stuck copy),
  `portal/tests/gate-edge.mjs` (regression only — no change expected).

**Baseline refs:**
- `specs/000-system.md` §3.2 (email/password as a second sign-in method), §4.1
  (the "Google uid" wording in the `/api/activate/<slug>` note becomes "Firebase
  uid"), §5 (console password policy + email/password provider are deploy-time,
  not code).

---

### Phase 3 — Forgot-password reset flow

**Goal:** The sign-in form's "Forgot password?" action sends a Firebase reset email
with the card's origin as the continue URL, and the reset completes on the Firebase
page and redirects back to the card.

**Tasks:**
- [ ] Add the "Forgot password?" action to the sign-in mode of the email form and
      render a small reset panel (email input + send + a resolved-for-any-address
      confirmation message) (FR-17).
- [ ] On submit, call `sendPasswordResetEmail(auth, email, {
      url: '<origin>/<slug>', handleCodeInApp: false })` (FR-18, FR-19). Do not
      reveal whether the address is registered — resolve with the same confirmation
      for any address (FR-20). In the emulator the email is captured, not sent
      (NFR-6).
- [ ] Ensure the continue URL is the card's own origin + slug (built from
      `location.origin` and the current `CARD_SLUG`), so the reset completes on
      Firebase's `__/auth/action` page and redirects back to the card (FR-19).

**Acceptance criteria:**
- The forgot-password action sends a reset email with the card origin + slug as the
  continue URL (AC-8 partial — the reset completes on the Firebase page; the
  emulator test exercises the equivalent oobCode path).

**Tests:**
- This phase's behavior is asserted in `gate-email.mjs` (Phase 4), which drives the
  reset end-to-end via `generatePasswordResetLink`. Phase 3 is complete when a
  manual smoke against the Auth emulator shows the reset panel, `sendPasswordResetEmail`
  resolves, and `admin.auth().generatePasswordResetLink` yields a usable `oobCode`.
- No standalone suite is added here to avoid a throwaway test; the reset is fully
  verified in Phase 4.

**Touch points:**
- `patients/jessica/assets/auth-gate.js`.

**Baseline refs:**
- `specs/000-system.md` §5 (the reset page is Firebase-owned and unbranded).

---

### Phase 4 — `gate-email.mjs` end-to-end and full SPEC-001 regression

**Goal:** A Playwright suite proves the email flows against the emulators (sign-up
links with `provider: 'password'` and a non-empty name; sign-in re-verifies without
rewriting; uniform failure; email-already-in-use suggests sign-in; reset changes the
password and the new password opens the card), and every SPEC-001 suite stays green
with the Google helper unchanged.

**Tasks:**
- [ ] Add `portal/tests/gate-email.mjs` (Playwright + Node Admin SDK, modeled on
      `gate-edge.mjs` + `activate.mjs`). It signs up via `signUpEmail`, navigates to
      a stored card, and asserts the link; signs in via `signInEmail` and asserts no
      rewrite; asserts the uniform failure message; asserts the email-already-in-use
      → sign-in suggestion; and drives the reset via
      `admin.auth().generatePasswordResetLink(email, { url })` (with
      `FIREBASE_AUTH_EMULATOR_HOST` on the Admin SDK) → extract `oobCode` →
      `confirmPasswordReset(auth, oobCode, newPassword)` in the browser page →
      `signInEmail` with the new password → the card opens.
- [ ] In `gate-email.mjs`, assert `activatedBy.provider === 'password'` and
      `activatedBy.name` equals the typed name (via the clinician `/api/cards/<slug>`
      read behind `STUDIO_PASSPHRASE`, as `gate-edge.mjs` does), and that a repeat
      sign-in leaves `activatedBy.at` unchanged.
- [ ] Keep the no-bypass policy: `gate-email.mjs` authenticates through the real
      SDK + emulator, never through a test-only code path (FR-25). Update
      `portal/tests/README.md` with the `signUpEmail`/`signInEmail` usage and the
      reset-verification note.
- [ ] Run the SPEC-001 regression: `gate.mjs`, `gate-edge.mjs`, `activate.mjs`,
      `unlink.mjs`, `studio-link.mjs`, and the pre-existing browser suites, with the
      Google helper unchanged.

**Acceptance criteria:**
- A new account links the card with `provider: 'password'` and a non-empty name
  equal to the typed name (AC-4, AC-5).
- An existing email account signs in directly and writes nothing again (AC-6).
- A wrong email/password shows one uniform message (AC-7).
- The forgot-password action yields a working reset; the new password opens the card
  (AC-8).
- A same-email-other-provider tap shows the refined stuck message and
  `activatedBy` never changes (AC-9).
- The Google flow still passes its SPEC-001 criteria (AC-10).
- `gate.mjs` and `gate-email.mjs` pass against the emulators; `auth-session.mjs`
  exposes `signUpEmail` and `signInEmail` (AC-11).
- No new SDK and no new server dependency (AC-12) — verified by a dependency grep.

**Tests:**
```bash
# terminal 1 — emulators (Auth required; Firestore optional for the full path)
firebase emulators:start --only auth

# terminal 2 — service for the email suite
cd portal
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/gate-email-cards.json \
  STUDIO_PASSPHRASE=testpassphrase PORT=8098 node server.js &

# terminal 3 — the email end-to-end suite
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  node tests/gate-email.mjs
```
- `gate-email.mjs` must assert, in order: (1) `signUpEmail(page, {email,password,name})`
  then `goto /<slug>` opens the card with no gate and the clinician record shows
  `activatedBy.provider === 'password'`, a non-empty `name`, and a uid; (2) a fresh
  context `signInEmail(page, {email,password})` then `goto /<slug>` opens the card
  and leaves `activatedBy.at` unchanged (no rewrite); (3) `signInEmail` with a wrong
  password (or unknown email) produces one uniform failure message (same text for
  both wrong-email and wrong-password, no `user-not-found`/`wrong-password`
  wording); (4) signing up with an already-used email surfaces the "account already
  exists — sign in" suggestion (no `fetchSignInMethodsForEmail`); (5)
  `admin.auth().generatePasswordResetLink` yields an `oobCode`, the browser
  `confirmPasswordReset(auth, oobCode, newPassword)` succeeds, and
  `signInEmail` with the new password opens the card.
- Full regression (each against its own service per `tests/README.md`):
  ```bash
  cd portal
  node tests/gate.mjs
  node tests/gate-edge.mjs
  node tests/gate-email.mjs
  node tests/activate.mjs
  node tests/unlink.mjs
  node tests/studio-link.mjs
  node tests/empty-card.mjs
  node tests/click-every-link.mjs
  node tests/added-pens.mjs
  node tests/protocol-change.mjs
  node tests/push-ui.mjs
  node tests/logging.mjs
  node tests/card-links.mjs
  node tests/doses.mjs
  node tests/tirzepatide.mjs
  node tests/push-crypto.mjs
  node tests/push-flow.mjs
  node tests/studio-pens.mjs
  ```
- No-new-dependency and no-bypass guards (must both pass):
  ```bash
  git diff --stat -- portal/package.json                 # no new dependency rows
  grep -R "GATE_OFF\|__NO_GATE__\|fetchSignInMethodsForEmail" patients portal \
    && echo "FAIL: found" || echo "ok: no bypass / no enumeration probe"
  ```

**Touch points:**
- `portal/tests/gate-email.mjs` (new), `portal/tests/auth-session.mjs`,
  `portal/tests/README.md`, `patients/jessica/assets/auth-gate.js`.

**Baseline refs:**
- `specs/000-system.md` §3.2 (two provider options), §3.6 (no change), §4.1
  (endpoint list unchanged; "Google uid" → "Firebase uid"), §5 (enable the
  email/password provider + console password policy of 8 chars; reset page is
  Firebase-owned).

---

## Risks and open questions

- **R1 — Stale token name.** The ID token minted at `createUserWithEmailAndPassword`
  predates `updateProfile`; the gate force-refreshes with `getIdToken(true)`. If the
  refreshed token still lacks the name claim, the fallback is the server's
  `getUser(uid).displayName` — recorded as a contingency, not a planned task.
- **R2 — Enumeration drift.** Never branch on `auth/user-not-found` /
  `auth/wrong-password`; use only `auth/email-already-in-use` (create) and one
  uniform sign-in failure message. The no-enumeration-probe grep above enforces this.
- **R3 — Password policy mismatch.** Client enforces 8 chars; Firebase default is 6.
  A console password policy of 8 is a deploy prerequisite, not code (spec §12, §13).
- **R4 — Reset-page branding.** The reset page is Firebase-owned and unbranded;
  accepted for now and noted at deploy time (spec §12).
- **Same-email-other-provider stuck copy (settled).** The stuck screen is
  provider-agnostic and the server stays unchanged: the activate `409` body remains
  `{ error: 'uid_mismatch' }` (no provider field added). The settled copy is:
  "This card is already activated with a different account. If you used Google
  before, sign in with Google; if you used email, sign in with that email." It names
  both methods rather than guessing, and `activatedBy` is never overwritten.
- **Spec open question (minor, left to implementer):** the exact secondary label
  (default "Use email instead"). The stuck-screen sentence is settled above.
