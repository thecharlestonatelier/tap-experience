# First-Tap Authentication — Implementation Plan

**Spec:** `specs/2026-10-22-001-first-tap-auth.md`
**Plan:** `plans/2026-10-22-001-first-tap-auth.md`

## Context

- What the spec requires: a full-screen welcome gate inside `loadProtocol()`
  that appears only for a stored card (a slug with a Firestore record), a
  Google sign-in via redirect using the modular Firebase Auth SDK loaded from
  the gstatic CDN as ES modules (no bundler), and a new public endpoint
  `POST /api/activate/<slug>` that verifies the Google ID token server-side
  with `firebase-admin` and writes `activatedBy {uid, provider, name, at}`
  exactly once. Later taps on the same device skip the sign-in screen and
  verify only; a different Google account is blocked with a quiet stuck
  screen; Card Studio shows a LINKED / NOT LINKED pill with a detail line.
- Modules and communities the graph shows are touched: `loadProtocol()` (god
  node, 34 edges — the boot where the gate goes), the "Patient Protocol App
  Core" and "Card Decode & Config Build" communities (`readSlug`,
  `isHomeScreenApp`, `rememberCard`, `noteTap`), the "Portal Slug Utilities"
  and "Portal Store Subscriptions" / "Local File Store" / "Firestore"
  communities (`openStore`, `sanitize`, `carryCounters`, `publicView`), the
  "Portal Package Metadata" community (`@google-cloud/firestore`, where
  `firebase-admin` is added), the "Studio Rendering Boot" community
  (`refresh()`, `renderStats()` in `portal/studio/index.html`), and the "SMS
  Deep Links" community (`smsHref()`).
- Key constraints: no build step (CDN ES modules alongside the classic
  `protocol.js` script — the two coordinate through a global handshake);
  `activatedBy` must be excluded from `publicView()` and carried forward on a
  Studio save; Firestore stays behind the BAA (no client Firestore SDK, no
  security rules); the flow runs on the Firebase Auth and Firestore emulators.
- Applicable research patterns from the spec: alt-setup CDN loading
  (`firebase-app.js` + `firebase-auth.js` v13.x, `type="module"`);
  `signInWithRedirect` + `getRedirectResult()` with
  `account-exists-with-different-credential` handled; Admin SDK
  `verifyIdToken()` before write; merge writes mirroring `touch()` /
  `setState()`; `isHomeScreenApp()` (iOS standalone) tested early (R1).

## Phases

### Phase 1 — Activation endpoint, store write, and emulator-backed tests

**Goal:** The service can verify a Google ID token and link a card exactly
once, while the store carries `activatedBy` forward and hides it from the
public card read.

**Tasks:**
- [ ] Add `firebase-admin` to `portal/package.json` `dependencies` (pinned to
      a current major, alongside `@google-cloud/firestore`).
- [ ] Add `require('firebase-admin')` lazily (same pattern as
      `@google-cloud/firestore` in `portal/store/index.js`) so the file store
      path still runs on a laptop without credentials.
- [ ] Add a store method `activate(slug, activatedBy)` on both backings in
      `portal/store/index.js`, or a shared helper + one call per backing, that
      implements the once-only rule: no existing `activatedBy` → merge-write
      it; existing same `uid` → no-op (return "verified", write nothing);
      existing different `uid` → return a blocked result (never overwrite).
      Use a merge write (like `touch()` / `setState()`), never a full `put`.
- [ ] Carry `activatedBy` forward on a Studio save: extend `carryCounters()`
      (or add a parallel `carryActivation()`) so `sanitize()` preserves
      `existing.activatedBy` exactly, satisfying FR-22 / R5.
- [ ] Exclude `activatedBy` from `publicView()` in `portal/store/index.js`
      (open question 1: yes — the card's own read needs no uid or name).
- [ ] Add `POST /api/activate/<slug>` to `portal/server.js` (public, after the
      `/api/state` block): `assertSlug`, read the JSON body (`{ idToken }`),
      verify with `firebase-admin` `getAuth().verifyIdToken()`, derive
      `{ uid, provider: decodedToken.firebase.sign_in_provider, name:
      decodedToken.name, at: nowIso() }`, confirm the card exists (404 if not),
      call `store.activate()`. Return `200 {ok:true, linked|verified}` on
      success, `409` (or `403`) `{error:'uid_mismatch'}` on a different-uid
      block, `400 {error:'bad_request'}` on a missing/invalid token.

**Acceptance criteria:**
- The endpoint links a card exactly once; re-POST with the same uid writes
  nothing; a different uid is blocked.
- `activatedBy` holds exactly `uid`, `provider`, `name`, `at` — no email (AC-3,
  AC-9).
- `publicView()` does not expose `activatedBy`.
- A Studio `PUT` to `/api/cards/<slug>` does not drop `activatedBy` (FR-22).

**Tests:**
- New `portal/tests/activate.mjs` (Node, no browser; mirrors `push-flow.mjs`
  style): against the Auth emulator, mint a user with a display name
  (`auth.updateUser(uid, {displayName})`), mint a custom token, exchange it
  for an ID token via the emulator REST endpoint, then assert the endpoint
  behavior.
- Exact commands:
  ```bash
  # terminal 1 — Auth emulator (firebase-tools; firebase.json added in Phase 5,
  # but the auth emulator alone is sufficient here)
  firebase emulators:start --only auth

  # terminal 2 — the service on the file store
  cd portal
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    GOOGLE_CLOUD_PROJECT=atelier-tap \
    CARD_STORE=file CARD_FILE=.data-test/activate-cards.json \
    PORT=8095 node server.js &

  # terminal 3
  cd portal
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    GOOGLE_CLOUD_PROJECT=atelier-tap \
    node tests/activate.mjs
  ```
- `activate.mjs` must assert: first POST writes the four fields; second POST
  with the same uid returns success and leaves `at` unchanged; POST with a
  different uid returns `409` and leaves `activatedBy` unchanged; `GET
  /api/card/<slug>` omits `activatedBy`; a Studio `PUT` (with `STUDIO_PASSPHRASE`
  set) that edits `name` still returns the same `activatedBy`.
- Existing suite unchanged; `node portal/tests/*.mjs` still green.

**Touch points:**
- `portal/package.json`, `portal/server.js`, `portal/store/index.js`,
  `portal/tests/activate.mjs`.

**Baseline refs:**
- `specs/000-system.md` §2 (firebase-admin dep, `/api/activate/<slug>`),
  §4.1 (public endpoint list), §4.3 (`activatedBy` shape), §4.3 publicView.

---

### Phase 2 — Patient-side auth boot, welcome gate, and link flow

**Goal:** A stored card with no live session shows the full-screen welcome
gate, Google sign-in completes by redirect, and the ID token is posted to
`/api/activate/<slug>`.

**Tasks:**
- [ ] Add a public Firebase config module `patients/jessica/assets/firebase.js`
      exporting the public config (apiKey, authDomain, projectId =
      `atelier-tap`; open question 5) — public values only, no secrets.
- [ ] Add `patients/jessica/assets/auth-gate.js` as an ES module
      (`type="module"`): imports `firebase-app.js` and `firebase-auth.js`
      v13.x from the gstatic CDN, initializes the app, and exposes a global
      `window.__authGate.ensureActivated({slug})` promise so the classic
      `protocol.js` script can await it (R2 module bridging via a window
      handshake).
- [ ] Implement the gate states: no session → render the full-screen welcome
      gate (centered monogram, one "Sign in with Google" button, small
      "Message the atelier" link using `smsHref()`); sign-in via
      `GoogleAuthProvider` + `signInWithRedirect` (never popup) with
      `getRedirectResult()` on load and `account-exists-with-different-credential`
      handled (FR-6..FR-11, FR-17).
- [ ] After sign-in, POST the ID token to `/api/activate/<slug>`; on `200`
      resolve so the portal opens; on `409` resolve to a "blocked" state
      (stuck screen lands in Phase 3).
- [ ] Wire the gate into `loadProtocol()` in
      `patients/jessica/assets/protocol.js`: after `CARD_SLUG` is known and the
      record has a slug, `await window.__authGate.ensureActivated({slug})`.
      Skip the gate entirely for fragment (`card`) and legacy (`legacy`) cards
      (FR-1, FR-2).
- [ ] Add the welcome-gate overlay markup/CSS to
      `patients/jessica/index.html` (full-screen, theme palette) so sibling
      pages inherit it through the shared boot; the module injects the overlay
      for stored cards only.

**Acceptance criteria:**
- A fresh stored card shows the welcome gate on first tap (AC-1).
- "Sign in with Google" runs by redirect and the portal opens after the uid is
  written (AC-2).
- Fragment/legacy cards never show the gate (FR-2).
- The "Message the atelier" action is reachable via an `sms:` deep link
  (AC-7, FR-18).

**Tests:**
- New `portal/tests/gate.mjs` (Playwright, mirrors `empty-card.mjs` /
  `push-ui.mjs`): assert the gate renders for a stored card with no session,
  and does not render for a fragment card and a legacy card.
- Exact commands:
  ```bash
  # serve the patient side through the service (or http-server) + Auth emulator
  cd portal
  CARD_STORE=file CARD_FILE=.data-test/gate-cards.json PORT=8097 node server.js &

  # patient side can also be served statically with no backend write path:
  # npx http-server . -p 8080 -c-1

  node tests/gate.mjs
  ```
- `gate.mjs` must assert: `/<slug>` (stored) shows the monogram, one Google
  button, and a link whose `href` starts with `sms:`; `/#Name~pen` (fragment)
  and a `?card=legacy` address show no gate.

**Touch points:**
- `patients/jessica/assets/firebase.js` (new), `patients/jessica/assets/auth-gate.js`
  (new), `patients/jessica/assets/protocol.js`, `patients/jessica/index.html`,
  `portal/tests/gate.mjs`.

**Baseline refs:**
- `specs/000-system.md` §2 (Firebase Auth client SDK), §3.2 (sign-in gate in
  `loadProtocol()`), §5 (authorized domains).

---

### Phase 3 — Stuck/edge screens and verify-only session handling

**Goal:** The different-uid block shows the quiet stuck screen; a same-account
re-link after session loss re-opens without rewriting; a live-session return
tap skips the sign-in screen and verifies silently.

**Tasks:**
- [ ] In `auth-gate.js`, render the stuck screen on a `409` response: one
      short message and a single "Message the atelier" action via `smsHref()`
      (FR-18, AC-6). Use this for the different-uid case and the
      no-Google-account fallback (AC-7).
- [ ] Implement verify-only: when `onAuthStateChanged` already has a user,
      retrieve the current ID token and POST to `/api/activate/<slug>`; on
      same-uid `200` open the portal with no gate (AC-4, AC-5); on `409` show
      the stuck screen.
- [ ] Handle session-lost (WebKit ITP) case: no session → gate again → sign in
      → server verifies same uid and writes nothing (AC-5).
- [ ] Handle `auth/account-exists-with-different-credential` from
      `getRedirectResult()` (FR-10).
- [ ] Keep the gate from blocking an offline dose (R3): if a live session
      exists locally, do not hold the portal open on the network verify call —
      bound it (short timeout / best-effort) so a signed-in device past the
      gate still shows its dose when the service is unreachable (NFR-5).

**Acceptance criteria:**
- A different Google account on an activated card is blocked with the stuck
  screen (AC-6).
- Same-account re-link re-opens the portal and does not change `activatedBy`
  (AC-5).
- A second tap on the same device opens the portal with no gate (AC-4).
- A patient with no Google account can reach "Message the atelier" (AC-7).

**Tests:**
- New `portal/tests/gate-edge.mjs` (Playwright): drive sign-in state against
  the Auth emulator to cover block, re-link, and session-remembered paths.
- Exact commands:
  ```bash
  cd portal
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
    CARD_STORE=file CARD_FILE=.data-test/gate-edge-cards.json PORT=8098 node server.js &

  node tests/gate-edge.mjs
  ```
- `gate-edge.mjs` must assert: a card linked to uid A then opened by uid B
  shows the stuck screen (message action only); re-linking uid A after the
  session is cleared leaves `activatedBy.at` unchanged (compare via the
  clinician `/api/cards` read behind `STUDIO_PASSPHRASE`); a remembered session
  on the same device opens the portal with no gate.

**Touch points:**
- `patients/jessica/assets/auth-gate.js`, `patients/jessica/assets/protocol.js`,
  `portal/tests/gate-edge.mjs`.

**Baseline refs:**
- `specs/000-system.md` §3.2 (return tap / session-lost behavior).

---

### Phase 4 — Studio pill, detail line, and portal surface

**Goal:** Card Studio shows a LINKED / NOT LINKED pill per card and a detail
line with the name, provider, uid, and timestamp on demand.

**Tasks:**
- [ ] In `portal/studio/index.html` `refresh()` (the `$('rows')` render), add a
      LINKED / NOT LINKED pill derived from `c.activatedBy` (FR-19).
- [ ] Add a click handler on the pill that toggles a detail line under the row
      showing `name`, `provider`, `uid`, and `at` (AC-8). Style the pill and
      detail line in the existing palette.
- [ ] Confirm `/api/cards` returns the full record including `activatedBy`
      (it already lists full records) — no server change, but assert it in a
      test so a later `publicView` refactor cannot silently strip it.
- [ ] Confirm a Studio save keeps `activatedBy` (already carried in Phase 1);
      render from the full record, never from `publicView()`.

**Acceptance criteria:**
- Card Studio shows the LINKED / NOT LINKED pill (AC-8).
- The detail line shows the name, provider, uid, and timestamp (AC-8).
- No email appears in the Studio surface (AC-9).

**Tests:**
- New `portal/tests/studio-link.mjs` (Playwright): sign in to Studio with the
  passphrase, assert a linked card shows "LINKED" and that clicking reveals the
  four detail fields; a fresh card shows "NOT LINKED".
- Exact commands:
  ```bash
  cd portal
  CARD_STORE=file CARD_FILE=.data-test/studio-link-cards.json \
    STUDIO_PASSPHRASE=testpassphrase PORT=8099 node server.js &

  node tests/studio-link.mjs
  ```
- `studio-link.mjs` must assert: linked card pill text is `LINKED`; detail line
  contains the name, `google.com`, the uid, and an ISO timestamp; fresh card
  pill text is `NOT LINKED`; no `@` email-like token is rendered.

**Touch points:**
- `portal/studio/index.html`, `portal/tests/studio-link.mjs`.

**Baseline refs:**
- `specs/000-system.md` §3.6 (Card Studio dashboard) — "see who activated a
  card".

---

### Phase 5 — Emulator/dev wiring, docs, and final regression

**Goal:** Local development runs end-to-end on the Firebase Auth + Firestore
emulators, the authorized domains are documented, the baseline is updated, and
the full suite is green.

**Tasks:**
- [ ] Add `firebase.json` (auth + firestore emulator config) and a short
      `portal/tests/README.md` section (or `AUTH.md`) documenting the
      emulator-first workflow (AC-10, NFR-6).
- [ ] Document the local dev matrix: file store + Auth emulator for endpoint
      tests; `CARD_STORE=firestore` + `FIRESTORE_EMULATOR_HOST` for a full
      Firestore path; `FIREBASE_AUTH_EMULATOR_HOST` for the patient side.
- [ ] Document the two authorized domains —
      `tap.thecharlestonatelier.com` and `localhost` — in `portal/DEPLOY.md`
      (FR-8, R4).
- [ ] Update `specs/000-system.md` per Baseline Impact §12: §2 (client SDK,
      endpoint, firebase-admin), §3.2 (gate in boot), §4.1 (endpoint), §4.3
      (`activatedBy`), §5 (authorized domains), §6 (remove the "cannot see who
      activated" gap).
- [ ] Run the complete regression — all existing and new tests — and verify
      the patient side locally with `npx http-server . -p 8080 -c-1` and with
      `node portal/server.js`.

**Acceptance criteria:**
- The flow runs on the emulators with no live project (AC-10).
- Every acceptance criterion AC-1 through AC-10 is covered by some phase's
  tests.

**Tests:**
- Full regression, exact commands:
  ```bash
  cd portal
  node tests/activate.mjs
  node tests/gate.mjs
  node tests/gate-edge.mjs
  node tests/studio-link.mjs
  # and the pre-existing suite, each with its own server setup per README:
  node tests/empty-card.mjs
  node tests/doses.mjs
  node tests/tirzepatide.mjs
  node tests/card-links.mjs
  node tests/click-every-link.mjs
  node tests/added-pens.mjs
  node tests/protocol-change.mjs
  node tests/studio-pens.mjs
  node tests/logging.mjs
  node tests/push-crypto.mjs
  node tests/push-flow.mjs
  node tests/push-ui.mjs
  ```
- Patient-side local smoke: `npx http-server . -p 8080 -c-1` then load
  `http://localhost:8080/` and a stored-card slug against a running
  `node portal/server.js`.

**Touch points:**
- `firebase.json` (new), `portal/tests/README.md`, `portal/DEPLOY.md`,
  `specs/000-system.md`.

**Baseline refs:**
- All sections listed in `specs/000-system.md` §12 Baseline Impact.

---

## Risks and open questions

- **R1 — iOS standalone redirects.** `isHomeScreenApp()` already exists in
  `protocol.js`; the gate and `signInWithRedirect` path must be exercised in
  that case. Add a Playwright check in Phase 2 or 3 that stubs
  `matchMedia('(display-mode: standalone)')`.
- **R2 — module bridging.** The CDN SDK is ES modules; `protocol.js` is a
  classic script. The `window.__authGate` handshake is the chosen seam; if a
  page's inline `start()` runs before the module evaluates, the gate must
  await readiness (poll `window.__authGate`).
- **R3 — offline gate.** A live-session device must not be blocked from its
  dose by a network verify call (handled by the best-effort verify in Phase 3).
- **Open question 1 — `publicView()` exclusion.** Recommended and planned: yes.
- **Open question 5 — config location.** Planned as
  `patients/jessica/assets/firebase.js` with public-only values; the parent
  should confirm the exact `apiKey`/`authDomain` values to hardcode (they are
  public, but the source is the Firebase console for the `atelier-tap` project).
- **Open questions 2, 3, 4** are settled by the spec as planned (no fragment
  gate; endpoint `POST /api/activate/<slug>`; stuck screen offers only "Message
  the atelier").
