# The Charleston Atelier Tap Card Experience — System Baseline

**Spec ID:** SPEC-000
**Status:** Current state

## 1. Overview

The Charleston Atelier uses NFC tap cards to open a private portal on a
patient's phone. A card holds one of two things. A legacy card holds its
protocol in the URL fragment. A stored card holds a short address, called a
slug, that points to a record in Firestore. The portal shows the patient's
dosing schedule and instructions. The atelier edits cards in Card Studio, a
passphrase-protected dashboard. No patient signs in today.

## 2. Architecture and Components

The system has these parts:

- **Root hub** (`index.html`). A public page. It has links, a peptide
  calculator, and a wallet tab. It is not per-patient.
- **Patient portal** (`patients/jessica/`). The private portal. It has many
  pages. Every page boots through one shared engine, `assets/protocol.js`.
- **Shared protocol engine** (`patients/jessica/assets/protocol.js`). One
  client-side script. It reads `protocol.json` or a card record. It computes
  the dosing schedule. It handles card identity, dose logging, reminders,
  calendar export, and state reporting.
- **First-tap auth client** (`patients/jessica/assets/firebase.js`,
  `patients/jessica/assets/auth-gate.js`). Two ES modules. They load the
  Firebase Auth SDK from the gstatic CDN and drive the first-tap sign-in gate.
- **Portal service** (`portal/server.js`). A Node.js HTTP server on Google
  Cloud Run. It serves the patient portal, card addresses (`/<slug>`), the
  `/api` endpoints, and Card Studio. It verifies the Firebase ID token with
  `firebase-admin` before linking a card, and records the provider from the
  token as `google.com` or `password`.
- **Store layer** (`portal/store/`). One interface with two backings. Firestore
  on Cloud Run; a JSON file on a laptop. Files: `index.js` (cards),
  `doses.js`, `feeds.js`, `subs.js`.
- **Shared libraries** (`portal/lib/`). `slug.js` builds and validates card
  slugs. `push.js` sends Web Push. `wallet.js` builds Apple Wallet passes.
- **Card Studio** (`portal/studio/index.html`). The atelier's dashboard. It is
  behind a passphrase.
- **Redirect site** (`redirect/`). A small Netlify site that forwards
  Jessica's old card.

Deployment:

- Cloud Run service `atelier-tap` serves `tap.thecharlestonatelier.com`. The
  `Dockerfile` copies `patients/jessica` into the container as the public web
  root.
- Firestore (Native mode, `nam5`) holds card records and PHI under the Google
  Cloud BAA.
- Secret Manager holds the Studio passphrase and the push and wallet secrets.
- Netlify serves the static portal at `ca-tap.netlify.app` (legacy) and
  `atelier-portal-jessica.netlify.app` (Jessica).
- `firebase.json` configures the Auth (port 9099) and Firestore (port 8081)
  emulators for local development.
- Test suites that open a stored card sign in through the Auth emulator
  (`portal/tests/auth-session.mjs`, which exposes `signInGoogle`, `signUpEmail`,
  and `signInEmail` helpers; `portal/tests/gate-email.mjs` covers the email
  path). `npm run seed` (`portal/scripts/seed.js`) writes the dev and test
  cards.

## 3. Current Behaviors

### 3.1 Card identity and resolution

A card has one of two forms. A fragment card carries its protocol in the URL
fragment (`#Name~pen`). The browser never sends the fragment to a server. A
stored card carries a slug address (`/phil.h`). The server resolves the slug
to a Firestore record. The slug is the whole credential. It is printed on the
card and can be guessed. Card Studio adds three random characters by default.

### 3.2 Card boot (`loadProtocol`)

Every patient page calls `loadProtocol()`. It installs a link guard. It reads
the card from the fragment or the slug. It fetches `templates.json`. It builds
the config. It loads the patient's device settings. It reports state to the
server. It remembers the card on the device.

For an assigned stored card, the boot also runs the sign-in gate. The first
tap shows a full-screen welcome with two paths. The Google path runs a
redirect sign-in. The email path opens a form that toggles between sign-up and
sign-in. Sign-up asks for a name, an email, and a password of at least 8
characters. Sign-in asks for the email and password only. A failed sign-in
shows one uniform message that does not reveal which part was wrong. The form
offers a forgot-password reset that returns to the card. The service links the
card once, to whichever provider signs in first. Later sign-ins verify only. A
different account shows a stuck screen. A card sees the gate when it has a
name, a prescribed pen, or a patient-added pen. A retired card sees the gate
too. Fragment, legacy, and blank cards never see the gate.

### 3.3 Dose logging

A vial tag opens `/v/<id>`. The page asks the patient to confirm her own name.
The confirmed dose posts to `/api/dose`. The record lives in the
`administrations` collection. Logging is device-independent. A dose tapped in
Safari shows on the home-screen app.

A pen's start date and time-of-day lock for the patient at the pen's first
logged dose (`firstDoseDay`). The atelier override stays above the lock
through `settings.rev` and `settings.force`. `/api/logged` returns the logged
days and `firstAt`, the earliest logged instant per pen. The card reads the
first dose's clock time from `firstAt`.

### 3.4 Reminders

The patient turns reminders on from her card. The device posts a list of
future instants to `/api/push/subscribe`. Cloud Scheduler calls
`/api/push/run` every 15 minutes. The service sends one generic notification
per due dose.

`upcomingDoses()` builds the due instants. It reads each pen's per-pen time
from `timeFor(pen)`. `timeFor(pen)` resolves the time in this order, most
trusted first:

1. the atelier's per-pen value;
2. the patient's per-pen value;
3. the clock time of the first logged dose;
4. the band default.

The per-pen time changes only which instants `upcomingDoses()` emits. The
15-minute sweep, the two-hour grace, and the `sentUpTo` dedupe stay the same.
A settings change on a cold open re-syncs the stored due list through
`refreshReminders()`. That function refuses while the pen list is empty, so an
early call cannot post an empty schedule.

### 3.5 Calendar export and feed

The card builds an iCalendar file from the schedule. It posts the file to
`/api/ics/<slug>`. A patient can download it or subscribe to
`/ics/<slug>.ics`.

`buildICS()` builds each event's time from the per-pen time through
`timeFor(pen)` and `icsInstant()`. `DTSTART` stays a UTC instant with the `Z`
suffix. The file has no floating times and no `TZID` or `VTIMEZONE` blocks.

### 3.6 Card Studio

Card Studio is the atelier's dashboard. It lists cards. It shows each card's
opens and last-open time. It shows what the patient's phone reports. The
atelier creates, edits, and retires cards there. Studio sign-in is a
passphrase exchanged for a signed cookie.

Each card row carries a LINKED or NOT LINKED pill. Clicking the pill opens a
detail line with the linked name, provider, uid, and timestamp. A linked card
shows an Unlink action, which clears the link so the next sign-in links again.

### 3.7 Card creation and editing

Card Studio posts to `/api/cards` to create a card. The store sanitizes the
input. It keeps the counters (`taps`, `firstSeen`, `lastSeen`, `days`) and the
patient's `state` on every save. The editor shows one time row per band and
one row per pen. A per-pen row sets `settings.penTimes`; an empty per-pen row
clears the key, so the pen falls back to the chain from §3.4.

## 4. Interfaces and Data

### 4.1 HTTP endpoints

Public (no passphrase):

- `/health`
- `/api/card/<slug>`
- `/api/tap/<slug>`
- `/api/activate/<slug>` (POST). Links a card to the verified Firebase uid.
  The provider is recorded from the token as `google.com` or `password`.
  Returns 200 `linked` or `verified`; 409 `uid_mismatch`; 400 `bad_request`;
  404 `not_found`; 503 `auth_unavailable`.
- `/v/<payload>`
- `/api/dose`
- `/api/added/<slug>`
- `/api/ics/<slug>` and `/ics/<slug>.ics`
- `/api/state/<slug>`
- `/api/logged/<slug>`
- `/api/push/key`, `/api/push/subscribe`, `/api/push/unsubscribe`
- `/api/wallet/*`

Passphrase-protected:

- `/api/session`
- `/api/cards`
- `/api/cards/<slug>`
- `/api/cards/<slug>/unlink` (POST). Clears `activatedBy`. Returns 200; 401
  without a session; 404 `not_found`.
- `/api/doses/<slug>`
- `/api/push/phones/<slug>`
- `/api/push/test`
- `/api/blanks`

Secret-protected:

- `/api/push/run`

### 4.2 Data stores

- `cards` (Firestore collection; env `CARD_COLLECTION`). One document per card,
  keyed by slug.
- `administrations` (doses). One document per patient, pen, and day.
- `feeds`. One calendar text per card.
- `reminders` (subs). One document per phone, keyed by a hash of the push
  endpoint.

On a laptop, each maps to a JSON file under `portal/.data/`.

### 4.3 Card record shape

A card record holds:

- `slug`, `name`, `pens`, `startDate`, `status` (`active` | `blank` |
  `retired`), `note`
- counters: `taps`, `firstSeen`, `lastSeen`, `days`
- `state`: what the patient's phone last reported
- `settings`: `startDate`, `times` (band times), and `penTimes` (a per-pen
  `HH:MM` map) the atelier set for the patient, plus `rev`. `sanitizeSettings`
  keeps only real clock times: hours 00 to 23, minutes 00 to 59. The phone
  applies `settings` only when `rev` increases; `force` raises `rev` even when
  nothing changed.
- `added`, `dropped`: pens the patient added or removed herself
- `activatedBy`: `{uid, provider, name, at}`, set once at first sign-in. The
  `name` is the Google token's name or the name typed at email sign-up.
- `createdAt`, `updatedAt`

A card is `blank` when it has no name, no prescribed pen, and no patient-added
pen. It becomes `active` as soon as it has any one of the three. `retired` is
the atelier's word; the store never clears it.

`publicView()` returns only `slug`, `name`, `status`, `startDate`, `pens`,
`added`, `dropped`, `settings`. The returned `settings` includes `penTimes`.
The note, the counters, the state, and `activatedBy` stay on the clinician
side. A Studio save carries `activatedBy` forward. Only the clinician Unlink
action removes it.

## 5. Constraints

- No build step. The portal is plain ES modules and classic scripts. It has no
  bundler.
- No client Firestore SDK and no security rules. Every patient write goes
  through `/api` endpoints. The slug is the credential. The server sanitizes
  all input.
- PHI stays in Firestore under the Google Cloud BAA. Netlify signs no BAA. No
  clinical record transits Netlify.
- The repository is public. The site URL is unlisted but guessable.
- The tag capacity bounds the card URL length (see `NFC-CARDS.md`).
- Firebase Auth is registered against the `atelier-tap` project. The Firebase
  console must list a web app with its `apiKey`, the Google and email/password
  providers enabled, and the authorized domains `tap.thecharlestonatelier.com`
  and `localhost`. Netlify is inactive.
- The console password policy should match the client check: a minimum of 8
  characters. The client enforces 8. The Firebase default is 6.
- The forgot-password reset page is owned by Firebase. It uses the default
  template. Custom branding is a later console change, not code.

## 6. Known Gaps

- Apple Wallet needs a developer membership and signing certificates before
  passes are issued (see `WALLET.md`).
- Five titrations are flagged `needsDose` in `templates.json`. They are
  placeholders.
- Practice Better integration is open (see `DEPLOY.md`).
