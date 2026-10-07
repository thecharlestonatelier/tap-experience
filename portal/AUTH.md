# Authentication — Firebase / Identity Platform

A specification for putting real accounts behind Card Studio, and for
deciding — deliberately — what stays open.

Status: proposal. Nothing in here is built.
Build order and tests: `portal/AUTH-PLAN.md`. Starting with Google.

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

### Patients — yes, claimed at issue

**Decided: a card is claimed by a patient account before it shows anything.**
Card Studio creates the card; the patient signs in once and that account is
bound to that address. §11 is the design.

This reverses the recommendation this document originally made, so the
reasoning it overrides is kept rather than deleted — a later reader should
know the cost was weighed, not missed.

**What it costs.** A login sits between a patient and her dose. The moment
that matters is a patient at her bathroom counter at 8pm holding a pen; if
she is signed out, she is doing email verification instead of injecting.
Adherence is the product, and this is the most direct way to damage it.
§11 is built around keeping that moment from happening — claim in the
room, sessions that persist, and a fallback when they do not.

**What it buys**, and it is not only security:

- **Identity stops being guesswork.** The vial-tag flow currently infers
  who is holding the phone from localStorage, then a cookie, and tells her
  to "open your card first" when both are empty. That has gone wrong for a
  real patient. An account answers the question outright.
- **The card survives a new phone.** Today the memory is per-browser and
  per-device. An account follows her.
- **A card can be unbound.** A tag lost with a protocol on it can be
  revoked. Today the address is the credential and that is final.
- **The addressing weakness below stops mattering**, because the address
  alone stops being enough.

### The addressing weakness, which was the finding worth most

The model being replaced is **capability by URL** — the same as a Google
Doc shared by link. Weaker than that comparison suggests: a slug is
`first4.lastinitial` plus **three characters from a 27-character
alphabet — 19,683 combinations**. That defeats someone typing `/john.s` on
a whim. It does not defeat anyone willing to make twenty thousand requests,
which is a few minutes of work.

Patient accounts close this for claimed cards. Two things are still worth
doing, because neither depends on Firebase and both protect the window
before a card is claimed:

- **Rate-limit `/api/card/:slug`.** Unknown slugs should be slow and
  counted.
- **Lengthen the suffix** on new cards. Six characters takes it from
  19,683 to 387 million at no cost to legibility.

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

**Patient accounts change the weight of this.** With §11 in scope, the auth
system holds **patient email addresses** — an identifier, and therefore PHI
in combination with the fact of being a patient here. This moves the BAA
question from "small exposure, confirm anyway" to a genuine prerequisite:

- Identity Platform must be confirmed in scope under your BAA **before any
  patient claims a card**, not before staff sign-in.
- No protocol data goes in a token or a display name. The auth record holds
  an email and a uid; everything clinical stays in Firestore.
- If Identity Platform turns out not to be covered, staff can fall back to
  IAP (§5) — but **patient accounts have no fallback** and would not be
  built.

---

## 10. Migration

**The build order, with the test that proves each phase, is in
`portal/AUTH-PLAN.md`.** What follows is the shape; that document is the
work.

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

**Phase 6 — patient accounts, one patient first.**
Build the claim flow (§11) and bind **one** card — ideally your own test
card, then one patient who is comfortable being first and who you will see
again soon. Watch it for a fortnight before any more. The failure modes
here land on a patient at 8pm, not on a dashboard, and that asymmetry
deserves a slow rollout.

**Phase 7 — the rest, at their next visit.**
Claim each remaining card in the room rather than by email campaign. The
unclaimed cards keep working until they are claimed, which is what makes
this phase unhurried.

Rollback at any point before Phase 4 is: deploy the previous revision.
Cloud Run keeps them, and traffic can be moved back in one command.

---

## 11. Patient accounts

### The binding

One field on the card record:

```js
  owner: {
    uid:       'firebase-uid',      // the account that holds this card
    email:     'patient@example.com',   // may be an Apple relay address
    provider:  'apple',             // so the signed-out screen can say
                                    // "you used Apple last time"
    claimedAt: '2026-10-07T14:12:00.000Z',
    claimedBy: 'kendall@…'          // the staff account present at the claim
  }
```

A card with no `owner` is **unclaimed**. A card with one serves its protocol
only to a request carrying that uid's token.

### Claim in the room, not at home

This is the decision the rest of the design hangs on.

Card Studio creates the card and shows a **claim screen** — a QR code and a
short link — while the patient is still sitting there. She scans it on her
own phone, signs in, and the card is bound before she leaves. One minute,
with you present to help.

The alternative is to let her claim it later at home. Rejected: the first
time she taps her card would be a sign-up form, alone, at the moment she is
least patient with one. The support calls would all land on you anyway, and
later rather than now.

The claim link is single-use and short-lived — a signed token naming the
slug, good for 30 minutes, invalidated once used. Without that, anyone who
photographs the QR over her shoulder claims her card.

### What a patient signs in with

**Google first, and only Google to begin with.** Apple follows once the
developer membership is bought; the email link follows with it. The order
on the finished screen is Apple, Google, email link — but nothing waits on
that, and shipping one provider well beats shipping three at once.

Google is the right one to start with for three reasons: it needs no paid
membership, it returns a real email address rather than a relay, and
almost every patient here has one even if they live on an iPhone.

**Still coming, not cancelled:**

- **Apple** — $99/year developer membership, and then it leads the screen,
  because on an iPhone it is Face ID and one tap. Everything below about
  private relay and two-provider accounts applies the day it ships, which
  is why `owner.provider` is recorded from the first Google claim: the
  data has to be ready before the second provider exists, not after.
- **Email magic link** — the fallback for a patient with no Google
  account. Until it ships, that patient is claimed by you from Studio
  rather than turned away.

SMS stays rejected — phone numbers in the auth system, a cost per message,
and silent failure on a landline.

**The Safari problem below is not an Apple problem.** It breaks Google
redirect sign-in exactly the same way, and it is the first real piece of
work in the build.

#### Apple, when it comes: what it costs and what it does to the record

**It needs a paid Apple Developer Program membership — $99 a year.** Sign
in with Apple is configured with a Services ID and a signing key from the
developer portal; there is no free tier. This is the same membership Apple
Wallet passes were blocked on, so one payment unlocks both. **If that
membership is not bought, Apple sign-in cannot ship** and the screen is
Google plus email link.

**Private relay changes what you see.** A patient can choose "Hide My
Email", and Apple hands over `something@privaterelay.appleid.com` instead
of her real address. Consequences worth knowing before the first patient
does it:

- `owner.email` on her card will read as a relay address. You will not
  recognise her from it in the card list — so the card list should show
  **the patient's name from the card record**, which you typed, and treat
  the auth email as an identifier rather than a label.
- Mail sent to a relay address does reach her, forwarded by Apple, for as
  long as she allows it.
- She can revoke it later from her Apple ID settings, at which point
  forwarding stops. The account still works; only mail to it stops.

**Apple gives the patient's name once.** It is returned on the very first
authorization and never again. Since the name on the card comes from what
you typed in Studio, this does not matter here — noted so nobody later
builds something that depends on it.

#### The Safari problem, which is the real integration work

Firebase's sign-in handler normally lives on `your-project.firebaseapp.com`.
**Safari partitions third-party storage, and that breaks redirect sign-in** —
the patient goes to Apple, comes back, and arrives signed out. On an
iPhone-only patient base this is not an edge case, it is the default path.

The fix is to serve the auth handler from the same origin as the portal:

```
  tap.thecharlestonatelier.com/__/auth/*   →  the Firebase auth handler
```

On Cloud Run that means proxying `/__/auth/` through `server.js`, or
putting the custom domain on Firebase Hosting and sending everything else
to Cloud Run. Either way it must be settled **before** the first patient
claims a card, because the symptom — sign-in that silently does nothing —
is indistinguishable from the patient doing it wrong.

Popup sign-in (`signInWithPopup`) sidesteps the problem and is the better
default on desktop, but iOS Safari blocks popups often enough that the
redirect path has to work.

#### One patient, two providers — a problem Apple brings, prepared for now

A patient who uses Apple today and Google tomorrow gets **two Firebase
accounts** unless they are linked. Firebase links accounts sharing a
*verified* email automatically — but Apple's private relay address is not
her Google address, so for the patients most likely to use Apple, it will
not link.

The card is bound to a uid. A second account means a second uid, which
means her own card answering **"This card is not yours"** — the single
most alarming message this application can show, to the person least able
to diagnose it.

Three things keep that from happening:

1. **Record the provider at claim time** — `owner.provider: 'apple'` — and
   have the signed-out screen say *"You signed in with Apple last time"*
   above the buttons. Most of this problem is solved by remembering.
2. **Offer linking, not a dead end.** When a signed-in account does not own
   the card, the page should offer *"Link this sign-in to my card"*, which
   emails a link to the address on the original account. Firebase supports
   linking providers onto one account.
3. **You can re-bind from Studio** (below), which is the floor under all of
   it.

### What happens on a tap, after this

```
  Tag tapped  →  /phil.h
        │
        ├─ card unclaimed ─────────→ "Ask the atelier to set this up"
        │                             (it should never be handed over unclaimed)
        │
        ├─ signed in as the owner ─→ her protocol, as today
        │
        ├─ signed in as someone else → "This card is not yours"
        │
        └─ signed out ─────────────→ "Welcome back" + the provider she
                                      used last, offered first
```

The vial page gets simpler, not harder: the uid in the token *is* the
patient, so `recallCard()`, the `ca_card` cookie and the whole
"Open your card first" branch can go.

### The session, and the problem Safari creates

Firebase keeps a web session in IndexedDB. **Safari's ITP evicts that after
seven days without interaction** — the same mechanism that caused the
localStorage bug this application already hit.

What that means in practice:

- A patient dosing daily interacts daily, the clock keeps resetting, and
  she never sees a login again.
- **A patient who lapses for a week gets a sign-in wall at exactly the
  moment she is trying to restart.** That is the worst possible placement
  and it is Apple's behaviour, not something the design can remove.

Mitigations, in order of value:

1. **A card added to the home screen is exempt** — an installed web app's
   storage is not subject to ITP eviction the way a Safari tab's is. This
   turns "add to home screen" from a nicety into part of the claim flow.
2. **The sign-in link is one tap**, pre-filled with her address. Not a
   form — a button that says "Email me a link".
3. **The server-set cookie already built** (`ca_card`) stays as a hint, so
   a signed-out patient is greeted by name rather than by a blank form.

### What the clinician can still do

- **Re-bind a card** — wrong person claimed it, or she changed email.
- **Unbind** — lost tag, revoking the protocol on it.
- **See who holds what** — `owner.email` beside each card in the list.
- **Log a dose for a patient** — the Studio-side flow already built stays,
  and matters more now, because it is the path when a patient's phone will
  not cooperate in the room.

### What this does not fix

The home-screen app and Safari are still separate browsers with separate
storage, so a patient who uses both signs in to both. Accounts make that
recoverable rather than mysterious — she can sign in again — but they do
not merge the two.

### Scope

- `cards/{slug}.owner` on the record, and the claim token.
- A claim screen in Card Studio with the QR.
- A sign-in page on the patient side, and the signed-out state on every
  patient route.
- `/api/card/:slug` and the other slug-scoped routes gain an owner check.
  That is the part to be careful with: `/ics/:slug` is fetched by Apple's
  servers with no token at all, so the calendar feed either keeps its
  URL-as-credential model or stops working. **Recommendation: the feed
  keeps it**, with the suffix lengthened, and that exception is documented
  rather than forgotten.

## 12. Decisions needed

1. **Identity Platform or plain Firebase Auth?** Comes down to whether MFA
   is required. Recommendation: Identity Platform.
2. **Who gets accounts on day one?** Just you, or staff as well?
3. **Google-only sign-in, or email/password as a fallback?**
   Recommendation: Google only.
4. **Is authorship (§8) enough, or is a tamper-proof audit log required?**
4a. **Apple Developer Program membership — buy it?** $99/year, and Apple
    sign-in cannot ship without it. The same membership unlocks Wallet
    passes. If no, the screen is Google plus email link.
4b. **What happens to a card handed over unclaimed?** Recommendation: it
    cannot be — the claim is part of issuing it, in the room.
4c. **Does the calendar feed keep URL-as-credential?** Recommendation: yes;
    Apple's servers fetch it with no token and nothing can change that.
4d. **Custom auth domain: proxy `/__/auth/` through Cloud Run, or put the
    domain on Firebase Hosting?** Must be settled before the first claim —
    redirect sign-in does not work on Safari without it.
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
| 6 — patient accounts | three to four days, plus a fortnight watching one patient. The extra day is the custom auth domain and provider linking, not the sign-in buttons. |
| 7 — the rest | minutes per patient, at their visits |

Cost: free under 50,000 monthly active users at the Identity Platform tier.
At this practice's size, nothing — **plus $99 a year** for the Apple
Developer Program, without which Apple sign-in cannot be offered.
