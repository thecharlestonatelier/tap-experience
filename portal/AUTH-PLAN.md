# Authentication — build plan

How `portal/AUTH.md` gets built, in order, with the test that proves each
phase before the next one starts. **Google sign-in only.** Apple and the
email link are a later plan.

Two rules the whole plan rests on:

1. **Everything lands on `atelier-tap-test` first.** It has its own cards,
   its own collections and its own passphrase. A phase is not finished on
   test until its tests pass; it does not reach production the same day.
2. **No phase leaves the dashboard unopenable or a patient unable to
   dose.** Every phase below is reversible by deploying the previous Cloud
   Run revision, and each one says what that means.

A phase that fails its tests is not patched forward. It is rolled back and
re-cut, because the thing being built is the lock on the door.

---

## Phase 0 — Console, no code

Identity Platform on, Google provider on, nothing enforced.

**Build**
- Enable Identity Platform in the project.
- Enable the Google sign-in provider.
- Authorised domains: the Cloud Run URL, the test service URL,
  `tap.thecharlestonatelier.com`, `localhost`.
- Grant yourself `clinician` and `admin` claims with a throwaway script.
- **Confirm Identity Platform is in scope under the BAA.** This gates
  Phase 7, not Phase 1 — staff identities are not PHI, patient emails are.

**Tests**

| | Expect |
|---|---|
| `gcloud identity-platform config describe` (or the console) | Google provider enabled |
| Sign in on Firebase's own test page | returns a token |
| Decode the token at jwt.io | `aud` is the project, `email` is yours |
| `admin.auth().getUser(uid)` in a scratch script | `customClaims: { clinician: true, admin: true }` |

**Rollback** Disable the provider. Nothing in the app refers to it yet.

---

## Phase 1 — The server can verify a token, and enforces nothing

**Build**
- `firebase-admin` into `portal/package.json`.
- `portal/lib/auth.js` with `whoIs(req)` as sketched in AUTH.md §6.
- `GET /api/whoami` — returns what `whoIs` made of the request. Temporary,
  removed in Phase 4.
- **Nothing calls it yet.** `requireClinician` is untouched.

**Tests — automated, against the Firebase Auth emulator**

The emulator is what makes this testable here: no project, no network, and
it mints real-shaped tokens. `portal/tests/auth-verify.mjs`:

| Case | Expect |
|---|---|
| valid token, `clinician: true` | `{ uid, email, clinician: true }` |
| valid token, no claims | `{ uid, email, clinician: false }` |
| expired token | `null` |
| signature tampered (last char flipped) | `null` |
| token from a different project | `null` |
| no `Authorization` header | `null` |
| header present, not `Bearer` | `null` |
| revoked user, `checkRevoked: true` | `null` |

**Test — live on `atelier-tap-test`**
`curl -H "Authorization: Bearer $TOKEN" .../api/whoami` returns your uid
and `clinician: true`. Without the header: `null`.

**Rollback** Previous revision. The endpoint is additive; nothing depends
on it.

---

## Phase 2 — Staff can sign in with Google, and the passphrase still works

The phase that makes the rest safe. Both mechanisms are accepted, so there
is no moment where the dashboard cannot be opened.

**Build**
- `requireClinician` becomes async and accepts **either** a valid ID token
  with `clinician: true` **or** the existing `ca_studio` cookie. Seven call
  sites to await.
- Firebase JS SDK vendored into `portal/studio/` — not loaded from a CDN,
  consistent with how fonts are handled.
- A **Sign in with Google** button beside the passphrase field.
- `api()` in Studio attaches `Authorization: Bearer <token>` when signed in.
- Each request logs which mechanism it used: `auth=token` or `auth=cookie`.

**Tests — automated**

Extend `portal/tests/` with `auth-gate.mjs`, run against a local server
with the emulator:

| Case | Expect |
|---|---|
| `GET /api/cards`, no auth | 401 |
| with a valid clinician token | 200, cards |
| with a valid token, **no** `clinician` claim | **403**, not 401 |
| with the passphrase cookie | 200, cards |
| with an expired token | 401 |
| `POST /api/cards` with a clinician token | 201 |
| `PUT /api/cards/:slug`, no auth | 401 |
| `GET /api/card/:slug` (patient route), no auth | **200** — unchanged |
| `POST /api/dose`, no auth | **200** — unchanged |
| `GET /ics/:slug`, no auth | **200** — unchanged |

The last three matter most. The commonest way to break this is to guard a
route a patient needs.

**Tests — by hand on `atelier-tap-test`**

1. Sign in with Google → the card list loads.
2. Sign out, sign in with the passphrase → the card list loads.
3. Open a card, change a dose time, save → it saves.
4. In a private window, no auth → the gate appears, not the dashboard.
5. Sign in with a Google account that has no claim → "not permitted",
   and the card list never renders.
6. **On a phone**, tap a test patient card → the protocol shows, no sign-in.
7. **On a phone**, tap a test vial tag → it logs, no sign-in.

6 and 7 are the regression that matters: staff auth must be invisible to
patients.

**Rollback** Previous revision — the passphrase alone, as today.

**Stop rule** If Google sign-in works on desktop but not on your phone,
stop and do Phase 6 first. That is the Safari problem arriving early, and
pushing on would mean a dashboard you cannot open in the clinic.

---

## Phase 3 — Watch, a week

No build. The logs from Phase 2 answer one question: is anyone still using
the passphrase?

**Test**
```
gcloud run services logs read atelier-tap --region us-east1 --limit 2000 \
  | grep -c 'auth=cookie'
```
Zero across a full week, including a day you are out of the office, before
Phase 4. Any non-zero is a person or a device that would be locked out —
find it first.

---

## Phase 4 — Retire the passphrase

**Build**
- Remove `signSession`, `validSession`, `POST /api/session`, the cookie
  branch of `requireClinician`, and the passphrase field in Studio.
- Remove `GET /api/whoami`.
- **Keep the local-development bypass.** `isClinician()` returns true today
  when `STUDIO_PASSPHRASE` is unset; the token equivalent must do the same
  or the test suite and every laptop stop working.
- Delete the `studio-passphrase` secret **only after Phase 5**, so the
  rollback path survives one more phase.

**Tests**

| Case | Expect |
|---|---|
| `POST /api/session` with the old passphrase | 404 |
| a forged `ca_studio` cookie | 401 |
| a real old cookie from before the deploy | 401 |
| Google sign-in | 200 |
| `node portal/tests/*.mjs` locally, no env | all pass — the bypass holds |
| `GET /api/card/:slug` unauthenticated | 200 |

**Rollback** Previous revision, and the secret still exists.

---

## Phase 5 — Authorship

**Build** `updatedBy: { uid, email, at }` on every card write; "last edited
by Kendall, Tuesday 14:12" in the card list.

**Tests**
- Save a card signed in as you → the record carries your uid and email.
- Save it from a second account with the claim → it carries theirs.
- The card list shows the name and time.
- An older card with no `updatedBy` renders without an error.

**Rollback** Previous revision; the field is additive and harmless if left.

---

## Phase 6 — The custom auth domain

**The gate for everything patient-facing, and the phase most likely to
eat a day.** Firebase's handler lives on `*.firebaseapp.com`; Safari
partitions third-party storage and redirect sign-in dies silently.

**Build** Serve `/__/auth/*` from the portal's own origin — proxied
through `server.js`, or the custom domain on Firebase Hosting with
everything else routed to Cloud Run. Set `authDomain` in the client config
to that origin.

**Tests — and these cannot be automated**

| Device | Case | Expect |
|---|---|---|
| **iPhone Safari** | redirect sign-in | returns signed in |
| **iPhone Safari** | close the tab, reopen the portal | still signed in |
| **iPhone**, card on the home screen | sign in from the installed app | returns signed in |
| iPhone Safari, Private Browsing | sign in | works for the life of the tab |
| Desktop Safari | popup sign-in | works |
| Chrome / Android | both | work |
| iPhone Safari, **leave 8 days untouched**, reopen | likely signed out — confirm it is a *recoverable* sign-in and not an error page |

The last row is Apple's storage eviction, documented in AUTH.md §11. It
cannot be fixed, only handled gracefully, and this is where you find out
whether it has been.

**Rollback** Revert `authDomain`. Staff sign-in returns to whatever
worked in Phase 2.

**Stop rule** If the home-screen app cannot complete sign-in, patient
accounts do not proceed. That is the configuration most patients will be
in, and a patient who cannot sign in cannot see her dose.

---

## Phase 7 — Patient claim, on the test service only

Nothing here touches a real patient.

**Build**
- `owner: { uid, email, provider, claimedAt, claimedBy }` on the card.
- Claim token: signed, names the slug, 30 minutes, single use.
- Claim screen in Studio with the QR.
- Patient sign-in page and the signed-out state on patient routes.
- Owner checks on `/api/card/:slug`, `/api/dose`, `/api/state`,
  `/api/logged`, `/api/tap`.
- **`/ics/:slug` keeps URL-as-credential** — Apple's servers fetch it with
  no token. Written into the code as a comment, not left to be rediscovered.
- Re-bind and unbind in Studio.

**Tests — automated**, `portal/tests/claim.mjs`:

| Case | Expect |
|---|---|
| unclaimed card, no auth | the "ask the atelier" screen |
| claim token, correct slug, first use | binds, `owner` written |
| the same token a second time | refused |
| a token 31 minutes old | refused |
| a token for a different slug | refused |
| owner requests her own card | 200 |
| a different signed-in account requests it | 403 and the **link** offer, not a bare refusal |
| no auth, claimed card | the sign-in screen naming the provider |
| `/ics/:slug` with no auth | **200** — the documented exception |
| `POST /api/dose` as the owner | logs |
| `POST /api/dose` as another account | 403 |
| clinician re-binds to a new uid | old uid loses access, new uid gains it |

**Tests — by hand, on test cards, on a real phone**
1. Make a card in the test Studio, claim it with a second Google account.
2. Tap the card: protocol shows.
3. Tap a vial tag: logs, with no "open your card first".
4. Sign out, tap the card: the sign-in screen, and it names Google.
5. Sign in again: back to the protocol, still signed in after a reload.
6. Re-bind from Studio: the first account is refused, the second works.
7. Subscribe to the calendar: still works — nothing broke the feed.

**Rollback** Previous revision. No production card has an `owner`, so
production is unaffected whatever happens here.

---

## Phase 8 — One real patient

**Build** Nothing. Deploy Phase 7 to production and claim **one** card.

Pick someone who doses daily (so the session never goes stale), who you
will see again inside a month, and who will tell you when something is
wrong rather than quietly stopping.

**Tests** A fortnight of her actually using it. What you are watching for:

- Does she stay signed in between doses?
- Does the vial tap still log, every time?
- Does the calendar still update?
- Any support call at all — and what time of day it came.

**Stop rule** One sign-in problem that she could not resolve herself ends
the rollout until it is understood. The whole asymmetry of this feature is
that its failures land on a patient at 8pm rather than on a dashboard.

**Rollback** Unbind her card from Studio. She is back to today's
behaviour in one click, with no deploy.

---

## Phase 9 — The rest, at their visits

One card per visit, in the room, with the QR. No email campaign and no
deadline. Unclaimed cards keep working, which is what makes this unhurried.

**Test** After each claim, before she leaves: she taps her card and sees
her protocol on her own phone. That is the whole acceptance test, and it
takes ten seconds.

---

## Later — Apple, and the email link

A separate plan, gated on the $99 developer membership. What this plan
leaves ready for it: `owner.provider` recorded from the first Google
claim, the signed-out screen already naming a provider, and the linking
path already designed in AUTH.md §11.

---

## The suite

New files under `portal/tests/`, run the way the others are:

| File | Phase | Covers |
|---|---|---|
| `auth-verify.mjs` | 1 | token verification, every failure mode |
| `auth-gate.mjs` | 2 | every route against every kind of caller |
| `claim.mjs` | 7 | the claim flow and the owner checks |

All three need the Firebase Auth emulator, which runs locally and needs no
project:

```
npx firebase-tools emulators:start --only auth
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 node portal/tests/auth-gate.mjs
```

And the existing four — `empty-card`, `card-links`, `click-every-link`,
`tirzepatide` — must pass unchanged at **every** phase. They are the
patient side, and the patient side is what must not move.
