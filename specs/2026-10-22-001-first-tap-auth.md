# First-Tap Authentication

**Spec ID:** SPEC-001
**Date:** 2026-10-22
**Slug:** first-tap-auth
**Status:** Draft

## 1. Overview

When the atelier generates a card for a new customer, the first time the
customer taps the card, the customer signs in with Google through Firebase
Authentication. After sign-in, the service writes the Firebase uid and the
patient's name to the customer's card record in Firestore. The atelier can then
see who activated
each card. Later taps from the same device remember the session and skip the
sign-in screen. Sign in with Apple is deferred.

## 2. Goals and Non-Goals

### Goals

- Link each new stored card to one Google account on its first tap.
- Write the Firebase uid and the patient's name to the card record, once.
- Let the atelier see who activated each card.
- Keep the sign-in screen out of later taps on the same device.
- Keep Firestore behind the Google Cloud BAA.

### Non-Goals

- Sign in with Apple. This is deferred. The sign-in UI keeps a provider list
  so a second provider is a later additive change.
- Storing the patient's email. The spec stores the uid, the provider, the
  name, and a timestamp.
- Adding a client Firestore SDK or security rules.
- Linking legacy fragment cards. Those cards have no Firestore record.

## 3. Current Behavior

Today a tap resolves a card and shows the portal with no sign-in. A tap is
counted, but no account is linked to it (`000-system.md §3.2`, `§6`). Every
patient write goes through a `/api` endpoint that treats the card slug as the
credential and sanitizes the input (`000-system.md §5`). The portal service
has one dependency today, `@google-cloud/firestore`; it has no Firebase Admin
SDK.

## 4. Invariants and Scope Boundary

These must not change:

- The no-build constraint. The portal stays plain scripts.
- The slug as the credential. The card address keeps working.
- The public shape of the card read (`/api/card/<slug>`).
- The rule that a card that cannot reach the service still shows its dose.
- The rule that no clinical record transits a host without a BAA.

These are excluded from this spec:

- Sign in with Apple.
- Storing the patient's email.
- Changing the passphrase gate on Card Studio.
- Changing the dose log, reminders, calendar, or wallet features.

Netlify and the legacy redirect site are inactive. They are out of scope for
this feature. This spec does not configure them.

## 5. User Flows

### 5.1 First tap

The atelier creates a card in Card Studio. The customer taps the card. The
portal shows the full-screen welcome gate. The customer taps "Sign in with
Google". Google sign-in runs. The card sends the ID token to the new endpoint.
The service verifies the token and writes the uid. The portal opens.

### 5.2 Return tap

The customer taps the card again on the same device. The device has a live
session. The portal opens. The gate does not appear.

### 5.3 Session lost

The session is gone. This can happen when WebKit clears script-writable
storage. The portal shows the gate again. The customer signs in again. The gate
verifies that the signed-in uid matches the card's linked uid. It writes
nothing. The portal opens.

### 5.4 Different-uid block

A second person taps an already-activated card. That person signs in with a
different Google account. The service sees that the card already holds a
different uid. The service blocks the write. The card shows the quiet stuck
screen with one "Message the atelier" action. The atelier can now clear the
link, after which the next sign-in links the card to the correct account.

### 5.5 No-Google-account fallback

The customer has no Google account, or does not want to sign in. The customer
taps "Message the atelier". The card opens an SMS to the atelier through
`smsHref()`.

## 6. Existing cards (migration)

When the feature ships, existing cards behave as follows:

- An assigned stored card with no `activatedBy`. Its next open (a tap, a
  home-screen app, or a link) shows the welcome gate. The patient signs in
  with Google. The card links to that account exactly once. Nothing else about
  the card changes.
- First signer wins. The first Google account to sign in for a pre-existing
  card becomes its linked owner. If the wrong account links (a spouse, a
  caregiver, or a demo account), the atelier clears the link with the reset
  action (FR-23). The next sign-in links the card again.
- Old fragment cards (`#Name~pen`), the legacy card (`?card=legacy`), and
  blank or unassigned tags are never gated. They stay unauthenticated by
  design.
- A home-screen app saved before the feature gates on its next open the same
  as any boot. The gate lives in `loadProtocol()`, so every boot runs it.

## 7. Functional Requirements

### 7.1 The gate

- **FR-1.** Put the sign-in gate once inside the shared `loadProtocol()` boot
  in `patients/jessica/assets/protocol.js`. Do not add the gate per page.
- **FR-2.** Show the gate only for a stored card. A stored card has a slug and
  a Firestore record. Do not show the gate for a fragment or legacy card.
- **FR-3.** On the first tap of a stored card with no live session, show the
  full-screen welcome gate.
- **FR-4.** When the device has a live session, skip the gate and open the
  portal.
- **FR-5.** When the session is gone, show the gate again. The patient signs
  in again. The gate verifies that the signed-in uid matches the linked uid.
  It writes nothing.

### 7.2 Google sign-in

- **FR-6.** Load `firebase-app.js` and `firebase-auth.js` version 13.x from the
  gstatic CDN as ES modules, inside a `script` element with `type="module"`.
  Use no bundler.
- **FR-7.** Register the Firebase app against the existing `atelier-tap` GCP
  project.
- **FR-8.** Add these authorized domains to Firebase Auth:
  `tap.thecharlestonatelier.com` and `localhost`.
- **FR-9.** Start sign-in with `GoogleAuthProvider` and `signInWithRedirect`.
  Do not use `signInWithPopup`.
- **FR-10.** Recover the result on load with `getRedirectResult()`. Handle the
  `auth/account-exists-with-different-credential` error.
- **FR-11.** Keep a simple provider list in the sign-in UI. Put one provider
  (Google) in the list. Do not add Apple now.

### 7.3 The link endpoint

- **FR-12.** Add a new public endpoint on the portal service, for example
  `POST /api/activate/<slug>`. The request body carries the Google ID token.
- **FR-13.** The endpoint verifies the token with the Firebase Admin SDK
  (`getAuth().verifyIdToken()`).
- **FR-14.** The endpoint links the card exactly once. When the card has no
  link, it writes `activatedBy` with the uid, the provider, the name, and the
  timestamp. The name comes from the ID token's name claim.
- **FR-15.** If the card already holds a different uid, the endpoint blocks
  the write and returns an error. If the card already holds the same uid, the
  endpoint writes nothing and returns success. It never overwrites an existing
  link.
- **FR-16.** Add `firebase-admin` as a new `portal/` dependency.

### 7.4 UI — visual decisions

These three decisions are settled.

- **FR-17 (Decision 1 — welcome gate).** The gate is a full-screen welcome.
  Center the atelier monogram. Show one "Sign in with Google" button. Show a
  small "Message the atelier" fallback link below the button.
- **FR-18 (Decision 2 — stuck screens).** A stuck screen is quiet and simple.
  It shows one short message and a single "Message the atelier" action. Use the
  existing `smsHref()` deep link. Use this for the different-uid block and the
  no-Google-account case.
- **FR-19 (Decision 3 — Studio display).** In the Card Studio card table,
  show a compact pill. The pill reads LINKED or NOT LINKED. When the atelier
  clicks the pill, show the name, the provider, the uid, and the timestamp in a
  detail line under the row.

### 7.5 Privacy and data

- **FR-20.** Store `uid`, `provider`, `name`, and `at` in `activatedBy`. Take
  the name from the ID token's name claim. Do not store the email.
- **FR-21.** Keep Firestore behind the BAA. Write the uid through the Cloud Run
  service. Add no client Firestore SDK and no security rules.
- **FR-22.** Do not let Card Studio edits overwrite `activatedBy`.

### 7.6 Link reset (clinician)

- **FR-23.** Add a clinician-only link reset, for example
  `POST /api/cards/<slug>/unlink`. The action sits behind the Studio passphrase
  session. It clears `activatedBy` from a card document. Card Studio shows the
  action on a linked card. After the reset, the next sign-in links the card
  again.

## 8. Data Model

### 8.1 `activatedBy`

The field lives on the card document in the `cards` collection.

```json
{
  "activatedBy": {
    "uid": "AbC123xYz...",
    "provider": "google.com",
    "name": "Phillip",
    "at": "2026-10-22T12:34:56.789Z"
  }
}
```

Field rules:

- `uid` is the Firebase Auth uid. It is opaque and stable.
- `provider` is the Firebase provider id. It is `google.com` today. A second
  provider later adds its own value.
- `name` is the patient's display name from the Google ID token's name claim.
  It is PHI. It lives only in Firestore behind the BAA. It is never written to
  `localStorage` and never sent back to the card.
- `at` is the first-link time, in ISO 8601.
- The endpoint writes the field once, at link time. The `uid`, the `name`, and
  the `at` never change after the first write.
- The write uses a merge, like `touch()` and `setState()` in
  `portal/store/index.js`. It never clobbers a concurrent edit.
- The store must carry `activatedBy` forward on a Studio save, like it carries
  the counters today.

## 9. Non-Functional Requirements

- **NFR-1 (No build).** The SDK loads from the CDN. No bundler enters the
  project.
- **NFR-2 (Privacy).** The stored name is PHI. It lives only in Firestore
  behind the BAA. It is never written to `localStorage` and never sent back to
  the card. Only the uid, provider, name, and timestamp are stored.
- **NFR-3 (Idempotency).** The write is idempotent and race-safe.
- **NFR-4 (Compatibility).** The flow works on iOS Safari, Android, and
  desktop. The iOS home-screen (standalone) case that `isHomeScreenApp()`
  detects is tested.
- **NFR-5 (Failure tolerance).** A card already past the gate keeps its current
  behavior when the service is unreachable.
- **NFR-6 (Local development).** The flow runs on the Firebase Auth and
  Firestore emulators with no live project.

## 10. Assumptions and Dependencies

- The Firebase app is registered against the existing `atelier-tap` GCP
  project. Firebase Auth is enabled there.
- The modular Firebase Auth SDK and the classic `protocol.js` script must work
  together. The exact wiring is an implementation choice.
- `firebase-admin` is added to `portal/package.json`.
- The customer has a Google account for the main path. The no-account fallback
  covers the other case.

## 11. Acceptance Criteria

- **AC-1.** A new stored card on a fresh device shows the welcome gate on the
  first tap.
- **AC-2.** "Sign in with Google" completes by redirect. The portal opens
  after the uid is written.
- **AC-3.** The card document gains `activatedBy` with `uid`, `provider`,
  `name`, and `at` after the first sign-in.
- **AC-4.** A second tap on the same device opens the portal with no gate.
- **AC-5.** After the session is cleared, the gate shows again. Signing in
  with the same account re-opens the portal and does not change `activatedBy`.
- **AC-6.** Signing in with a different Google account on an activated card is
  blocked. The patient sees the stuck screen.
- **AC-7.** A patient with no Google account can reach the "Message the
  atelier" action.
- **AC-8.** Card Studio shows the LINKED / NOT LINKED pill. The detail line
  shows the name, the provider, the uid, and the timestamp.
- **AC-9.** The `activatedBy` field holds no email. The name matches the Google
  account's name claim.
- **AC-10.** The flow runs on the Firebase emulators with no live project.
- **AC-11.** A clinician signed into Card Studio can clear a card's
  `activatedBy`. The card shows NOT LINKED again.
- **AC-12.** After the reset, the next Google sign-in links the card to the new
  account. The old uid is gone.
- **AC-13.** The reset endpoint rejects a request with no valid Studio session
  (HTTP 401).

## 12. Research and Best Practices

The atelier's tap portal is a static, no-build site (plain ES modules) served
from both Netlify and Google Cloud Run, with card records in Firestore reached
only through the Cloud Run service (`portal/server.js`, `portal/store/index.js`).
A first-tap Google sign-in must respect that shape.

- **Loading the SDK.** Firebase's modular Auth SDK loads without a bundler as
  ES modules from the gstatic CDN (`firebase-app.js` and `firebase-auth.js`,
  version 13.x) inside a `script` element with `type="module"`
  (<https://firebase.google.com/docs/web/alt-setup>). This fits the project's
  "no build step" constraint.
  - Verdict: Applicable. Rationale: `protocol.js` and every portal page are
    plain scripts; there is no bundler.

- **Where the uid is written.** The project has no client Firestore SDK and no
  security rules. Every patient write goes through `/api` endpoints that treat
  the card slug as the credential and sanitize the input. Keep that pattern:
  the patient signs in with the Firebase Auth client SDK, the card sends the
  resulting Google ID token to a new Cloud Run endpoint, and the server
  verifies it with the Admin SDK (`getAuth().verifyIdToken()`) before writing
  the uid to the card document
  (<https://firebase.google.com/docs/auth/admin/verify-id-tokens>). This keeps
  Firestore behind the Google Cloud BAA (`portal/DEPLOY.md`). The write must be
  idempotent and must never overwrite an existing link: if the card already
  holds a different uid, block with a message for the atelier.
  - Verdict: Applicable. Rationale: `portal/server.js` already routes all
    writes through `/api`, and `portal/store/index.js` already uses merge
    writes for `touch()` and `setState()`.

- **Google via redirect.** The card uses `GoogleAuthProvider`. On mobile,
  Firebase recommends `signInWithRedirect` over `signInWithPopup`, which is
  frequently blocked. The result is recovered with `getRedirectResult()` on
  load, and `auth/account-exists-with-different-credential` must be handled
  (<https://firebase.google.com/docs/auth/web/redirect-best-practices>). The
  iOS home-screen ("standalone") case this project already special-cases
  (`isHomeScreenApp()` in `patients/jessica/assets/protocol.js`) is exactly
  where OAuth redirects are fragile and must be tested. Sign in with Apple is
  deferred; the provider list in the sign-in UI is the only place a second
  provider would be added later.
  - Verdict: Applicable. Rationale: the project already special-cases
    `isHomeScreenApp()` for push and card memory.

- **Session persistence is best-effort.** The default local persistence uses
  IndexedDB, but WebKit's Intelligent Tracking Prevention can clear
  script-writable storage after about seven days without interaction
  (<https://webkit.org/tracking-prevention>). "Later taps skip sign-in" is
  therefore an optimization: if the session is gone, the card shows the
  sign-in choice again and re-links the same uid without harm. A patient with
  no Google account must still have an outcome — the card shows a message with
  the atelier's contact information, using the existing SMS deep-link helper
  `smsHref()` (`patients/jessica/assets/protocol.js`).
  - Verdict: Applicable. Rationale: the project already treats device storage
    as best-effort and already uses `smsHref()` for the concierge contact.

- **Local development.** The Firebase Emulator Suite provides Auth and
  Firestore emulators, so the sign-in-to-link flow can be developed and tested
  without a live project (<https://firebase.google.com/docs/emulator-suite>).
  - Verdict: Applicable. Rationale: the portal already runs locally with a JSON
    file store, so an emulator path fits the existing laptop workflow.

## 13. Baseline Impact

When this feature lands, update these sections of `specs/000-system.md`:

- `§2` (Architecture and Components): add the Firebase Auth client SDK, the
  new `/api/activate/<slug>` endpoint, and the `firebase-admin` dependency.
- `§3.2` (Card boot): add the sign-in gate inside `loadProtocol()`.
- `§3.6` (Card Studio): add the link-reset control on a linked card.
- `§4.1` (HTTP endpoints): add the activation endpoint to the public list, and
  the link-reset endpoint to the passphrase-protected list.
- `§4.3` (Card record shape): add `activatedBy`.
- `§5` (Constraints): add the Firebase authorized domains.
- `§6` (Known Gaps): remove the gap that the atelier cannot see who activated
  a card.

## 14. Risks

- **R1 — iOS standalone redirects.** OAuth redirects are fragile in a
  home-screen app. Test the `isHomeScreenApp()` case early.
- **R2 — Module bridging.** The Firebase SDK is ES modules. `protocol.js` is a
  classic script. The two must coordinate inside `loadProtocol()`.
- **R3 — Offline gate.** A gate that requires the network could block a dose a
  patient needs offline. Mitigate: skip the gate when a session exists locally,
  and keep the fallback message path.
- **R4 — Authorized domain drift.** A new origin that serves the page but is
  not in the authorized-domain list breaks sign-in. Mitigate: list the domains
  in FR-8 and test each.
- **R5 — `activatedBy` dropped on save.** A Studio save that does not carry
  `activatedBy` forward would erase the link. Mitigate: carry it like the
  counters.
- **R6 — Name exposure.** The stored name is PHI. Keep it in Firestore only.
  Never write it to `localStorage` and never send it back to the card. The card
  read must not include it.
- **R7 — Accidental reset.** Clearing the link removes the owner record. A wrong
  click unlinks a card. Mitigate: require a confirm step in Card Studio.

## 15. Settled Decisions and Open Questions

### Settled decisions

- `activatedBy` stores `uid`, `provider`, `name`, and `at`. The name comes from
  the Google ID token's name claim. No email is stored.
- A card is linked once. Later sign-ins verify only. Nothing is written again.
- Netlify and the legacy redirect site are inactive and out of scope. The
  authorized domains are `tap.thecharlestonatelier.com` and `localhost` only.

### Open questions

1. Should `activatedBy` (uid and name) be excluded from `publicView()` in
   `portal/store/index.js`? Recommended: yes — the uid and the name are not
   needed by the card's own read.
2. Should the gate also cover legacy fragment cards? Recommended: no — those
   cards have no Firestore record.
3. What is the endpoint name? Proposed: `POST /api/activate/<slug>`.
4. On a different-uid block, should the card offer a way to choose the correct
   Google account, or only "Message the atelier"? Recommended: only the message
   action for now.
5. What Firebase Auth config values (api key, auth domain, project id) does the
   card load, and how are they stored? They are public, but the loading file
   location is unset. Recommended: a small config module in the portal assets.
6. Should a link reset keep an audit trail? Recommended: no — clearing is
   enough. The next sign-in re-links, and the new `activatedBy` is the record.

## 16. Glossary

- **slug.** The short address of a stored card, for example `/phil.h`.
- **fragment card.** A legacy card that holds its protocol in the URL fragment.
- **stored card.** A card whose slug points to a Firestore record.
- **uid.** The opaque, stable Firebase Auth user identifier.
- **ID token.** A short-lived token from Firebase that proves a sign-in.
- **activatedBy.** The field on the card document that records `{uid,
  provider, name, at}`.
- **provider.** The identity provider id, for example `google.com`.
- **BAA.** Business Associate Agreement. Google signs one for covered services.
- **PHI.** Protected health information.
- **Firebase Auth.** Google's identity service.
- **Admin SDK.** The server-side Firebase library, `firebase-admin`.
- **loadProtocol.** The shared boot function in
  `patients/jessica/assets/protocol.js`.
- **publicView.** The store function that returns the card's public fields.
- **smsHref.** The SMS deep-link helper in the portal.
- **ITP.** Intelligent Tracking Prevention, a WebKit storage policy.
