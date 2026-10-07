# Authentication — Firebase / Identity Platform

A specification for putting real accounts behind Card Studio, and for
deciding — deliberately — what stays open.

Status: proposal. Nothing in here is built.

---

## 1. What this is for

Card Studio is protected today by **one shared passphrase**. That has three
consequences worth naming plainly:

- **No identity.** The record says a card was edited at 14:12. It cannot say
  by whom. For a system that holds dosing protocols, that is the gap that
  matters most.
- **No revocation.** A passphrase given to a locum, an MA, or typed into a
  borrowed laptop can only be withdrawn by changing it for everybody.
- **No second factor.** The whole clinical dashboard is one guessable string
  away, and that string is reused for as long as nobody rotates it.

Firebase Authentication fixes all three. It does not, by itself, make the
application more secure in any other respect, and it is worth being clear
about what it is *not* solving — see §3.

---

## 2. What authenticates, and what does not

This is the central decision in the document, so it comes before the
architecture.

### Staff — yes

Card Studio, the dose log, the deploy panel, the patient list. Everything
behind `requireClinician` today becomes a Firebase-authenticated session
with a named human attached.

### Patients — no, and this is deliberate

A patient taps a card and sees her dose. There is no sign-in, and there
should not be. The card's address *is* the credential: a long, unguessable
slug written to a tag she keeps in her wallet.

Putting a login in front of that would mean a patient standing at her
bathroom counter at 8pm, holding a pen, being asked for a password she set
up six weeks ago. Adherence is the entire point of this product, and a
login is the single most effective way to damage it.

The security model it replaces is not "nothing" — it is **capability by
URL**, the same model as a Google Doc shared by link or a password-reset
email. But it is weaker than that comparison suggests, and the spec should
say so: a slug is `first4.lastinitial` plus **three characters from a
27-character alphabet — 19,683 combinations**. That defeats someone typing
`/john.s` on a whim. It does not defeat anyone willing to make twenty
thousand requests, which is a few minutes of work.

Two things follow, neither of which is Firebase Auth's job:

- **Rate-limit `/api/card/:slug`.** Unknown slugs should be slow and
  counted. This is the single highest-value security change available to
  this application, and it is independent of everything in this document.
- **Lengthen the suffix** for cards issued from here on. Six characters
  takes it from 19,683 to 387 million at no cost to legibility.

**If you ever decide patients should sign in**, that is a product decision
with a measurable adherence cost, not a security upgrade to be slipped in.
It needs its own discussion, and §11 sketches what it would involve.

---

## 3. What this does not fix

Said up front so the document is not read as a security review.

- The patient portal remains reachable by anyone holding a card address.
- Firestore rules are unchanged; the Cloud Run service account still has
  full access and the server is still the only thing enforcing anything.
- It does not encrypt anything that is not already encrypted.
- It does not create an audit *log* — §8 adds authorship to records, which
  is a different and smaller thing.

---

## 4. Where things stand

| Surface | Guard today | After |
|---|---|---|
| `/studio/` and its API | shared passphrase → signed cookie, 12h | Firebase ID token |
| `/api/cards`, `/api/cards/:slug`, `/api/blanks` | `requireClinician` | ID token + `clinician` claim |
| `/api/doses/:slug` | `requireClinician` | ID token + `clinician` claim |
| `/api/push/phones/:slug`, `/api/push/test` | `requireClinician` | ID token + `clinician` claim |
| `/api/card/:slug` (the patient's own protocol) | open — slug is the credential | **unchanged** |
| `/api/tap`, `/api/dose`, `/api/state`, `/api/logged`, `/api/ics` | open, slug-scoped | **unchanged** |
| `/ics/:slug` (calendar feed) | open — fetched by Apple, carries no cookie | **unchanged** |
| `/api/push/run` | `x-push-secret` header from Cloud Scheduler | **unchanged** |
| `/health` | open | **unchanged** |

The current mechanism, for reference: `POST /api/session` compares the
passphrase against `STUDIO_PASSPHRASE` with `crypto.timingSafeEqual`, then
sets `ca_studio` to an HMAC of an expiry timestamp. `isClinician()` verifies
it. Note `isClinician()` returns **true** when `STUDIO_PASSPHRASE` is unset,
so a laptop runs with the dashboard open — that behaviour must survive, or
local development stops working.

---

## 5. Which product

| | Firebase Auth (free tier) | **Identity Platform** | IAP in front of Cloud Run |
|---|---|---|---|
| Google / email sign-in | yes | yes | Google only |
| **Multi-factor** | no | **yes, enforceable** | via Google account |
| Per-user audit of sign-ins | no | yes (Cloud Audit Logs) | yes |
| App code required | moderate | moderate | almost none |
| Needs a load balancer | no | no | **yes** |
| Cost at this size | free | ~free under 50k MAU | LB ≈ $18/mo |

**Recommendation: Identity Platform**, which is Firebase Authentication with
the enterprise features switched on — same SDK, same API, same tokens. The
deciding factor is MFA. A dashboard holding dosing protocols for named
patients should not be reachable with a password alone, and MFA is not
available on the free Firebase Auth tier.

IAP deserves a mention because it is genuinely less work — Google sign-in
enforced at the edge, no token handling in the app at all. It is rejected
only because it requires an external load balancer in front of Cloud Run,
which is a bigger change to the deployment than this is to the code, and
because it cannot protect anything below the whole-path level.

**Sign-in method: Google, restricted to the atelier's Workspace domain.**
No passwords to manage, MFA inherited from the Workspace account, and
offboarding someone removes their access everywhere at once. Email/password
should be left disabled.

---

## 6. How a request is authenticated

```
  Browser (Card Studio)                    Cloud Run (server.js)
  ─────────────────────                    ─────────────────────
  signInWithPopup(Google)
        │
        ├─ Firebase returns an ID token (JWT, 1h)
        │
        ├─ fetch('/api/cards', {
        │     headers: { Authorization: 'Bearer <token>' } })
        │                                        │
        │                                        ├─ verifyIdToken(token)
        │                                        │   signature, expiry,
        │                                        │   audience, issuer
        │                                        │
        │                                        ├─ claims.clinician === true?
        │                                        │
        │                                        └─ 200, or 401 / 403
        │
        └─ SDK refreshes the token before it expires; the page does not
           notice, and a revoked account stops working within the hour
```

Tokens go in the `Authorization` header, **not** a cookie. Two reasons: the
cookie approach needs CSRF protection that the header approach does not, and
`/ics/:slug` is fetched by Apple's servers with no cookie at all — keeping
auth out of cookies keeps those two worlds from interfering.

### Server

Add `firebase-admin` to `portal/package.json`. On Cloud Run it needs no
credentials file — it picks up the service account automatically.

```js
// portal/lib/auth.js  — sketch, not final
const admin = require('firebase-admin');
admin.initializeApp();                    // ADC on Cloud Run

async function whoIs(req) {
  // Local development with no passphrase set keeps working, exactly as
  // isClinician() does today.
  if (!process.env.FIREBASE_PROJECT_ID) return { uid: 'local', email: 'local', clinician: true };

  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  try {
    const t = await admin.auth().verifyIdToken(m[1], true);   // true = check revocation
    return { uid: t.uid, email: t.email, clinician: !!t.clinician, admin: !!t.admin };
  } catch { return null; }
}
```

`requireClinician(req, res)` becomes async and consults `whoIs`. That is the
one invasive change: every call site must be awaited. There are seven.

### Client

Card Studio loads the Firebase SDK, shows a Google sign-in button in place
of the passphrase field, and attaches the token to every `api()` call. The
existing `api()` helper is the only place that needs to change — one
function.

**CDN note:** the portal deliberately ships no external scripts, so the
Firebase SDK should be vendored into `portal/studio/` rather than loaded
from `gstatic.com`. That is consistent with how the fonts are handled and
keeps the dashboard working on a bad connection.

---

## 7. Roles

Two custom claims, set by an admin, carried in the token:

| Claim | Who | Can |
|---|---|---|
| `clinician` | Dr Phelps-Polirer, clinical staff | everything the dashboard does today |
| `admin` | Dr Phelps-Polirer | the above, plus granting and revoking claims |

A signed-in Google account with **neither** claim gets 403, not 401 — it is
authenticated and simply not permitted. That distinction matters when
someone in the Workspace domain signs in by accident.

Claims are set with a small script (`portal/scripts/grant.js`) rather than a
UI. Two people do not justify an admin screen, and a script leaves a record
in the shell history of who was granted what.

---

## 8. Authorship on records

Once requests carry a name, writes can record one. On every card write:

```js
  updatedBy: { uid, email, at: nowIso() }
```

Shown in Card Studio as "last edited by Kendall, Tuesday 14:12". This is the
reason to do the work at all, and it is three lines.

It is **not** a tamper-proof audit log. A real one means writing every change
to an append-only collection the service account cannot delete. If that is
required for your compliance posture, it is a separate piece of work and
should be specified separately.

---

## 9. HIPAA and the BAA

**Verify this before building, do not take my word for it.** Google's list
of HIPAA-eligible products changes, and my knowledge has a cutoff.

- Confirm **Identity Platform / Firebase Authentication** appears on Google
  Cloud's current HIPAA-covered services list.
- Confirm it is in scope under *your* BAA, not just eligible in general.
- Sign-in records hold staff identities, not patient data, which makes the
  exposure small — but "small" is not the standard, "covered" is.

If it turns out not to be covered, **IAP with Google Workspace accounts is
the fallback**, since that keeps identity inside Workspace, which your BAA
already covers.

Nothing in this design puts patient data in the auth system. No patient
accounts, no patient email addresses, no protocol data in a token.

---

## 10. Migration

Each phase is independently deployable and reversible.

**Phase 1 — stand it up, change nothing.**
Enable Identity Platform, restrict to the Workspace domain, grant yourself
both claims, add `firebase-admin`, build `whoIs()`. Nothing enforces it yet.

**Phase 2 — accept both.**
`requireClinician` accepts *either* a valid ID token *or* the existing
cookie. Add the Google button beside the passphrase field. Sign in both
ways; confirm both work. This is the phase that makes the rest safe —
there is no moment where you cannot get into the dashboard.

**Phase 3 — watch.**
A week of real use. The server logs which mechanism each request used. When
the passphrase count reaches zero, move on.

**Phase 4 — retire the passphrase.**
Remove the cookie path, `signSession`, `validSession`, `POST /api/session`
and the `STUDIO_PASSPHRASE` secret. Keep the local-development bypass.

**Phase 5 — authorship.**
Add `updatedBy` and show it in the card list.

Rollback at any point before Phase 4 is: deploy the previous revision.
Cloud Run keeps them, and traffic can be moved back in one command.

---

## 11. If patients ever do sign in

Not recommended (§2), recorded so the shape is known.

Passwordless email link or SMS sign-in, Firebase handles both. The card's
first tap would offer "this is my card" and bind the slug to the account.
Thereafter the vial page would know who is holding the phone without the
localStorage-and-cookie dance it does today, which would genuinely fix the
one failure patients hit — "Open your card first".

The cost: every patient needs an account, every lost phone is a support
call, patient email addresses and phone numbers enter the auth system
(which makes §9 materially harder), and the tap-and-go experience is gone.

A middle path, if the identity problem keeps biting: keep the portal open,
but let a patient optionally claim her card, and have the vial page use the
account when one exists and fall back to today's behaviour when it does not.

---

## 12. Decisions needed

1. **Identity Platform or plain Firebase Auth?** Comes down to whether MFA
   is required. Recommendation: Identity Platform.
2. **Who gets accounts on day one?** Just you, or staff as well?
3. **Google-only sign-in, or email/password as a fallback?**
   Recommendation: Google only.
4. **Is authorship (§8) enough, or is a tamper-proof audit log required?**
5. **Does the test service share the auth tenant, or get its own?**
   Recommendation: share it, with the claims granted separately, so test
   access does not imply production access.

---

## 13. Estimate

| Phase | Work |
|---|---|
| 1 — stand up | half a day, mostly console |
| 2 — accept both | half a day |
| 3 — watch | a week of elapsed time, no work |
| 4 — retire | an hour |
| 5 — authorship | an hour |

Cost: free under 50,000 monthly active users at the Identity Platform tier.
At this practice's size, nothing.
