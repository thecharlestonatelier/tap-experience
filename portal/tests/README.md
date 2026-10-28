# Portal test suites

The suites fall into two groups: Node suites that talk HTTP only, and
Playwright suites that open the patient pages in a real browser.

## Stored cards and the sign-in gate

An assigned stored card (a slug with a name) now gates its first tap
behind a Google sign-in. Every suite that opens one must therefore run
against the **Auth emulator** and sign in like a patient:

```bash
cd portal/..
firebase emulators:start --only auth          # 127.0.0.1:9099 (firebase.json)
```

### Fail closed, not fail open

The suites refuse to touch live Firebase, loudly:

- Every suite that mints users through `firebase-admin` (`activate`,
  `unlink`, `gate-email`, `unlink-reattribute`) runs
  `assertAuthEmulatorUp()` from `tests/emulator-guard.mjs` before the
  SDK's first call. Missing `FIREBASE_AUTH_EMULATOR_HOST`, or an
  emulator that does not answer, stops the suite before any network call.
- The browser helpers in `tests/auth-session.mjs` sign in only on
  localhost. Pointed at any other host they throw
  ("Refusing to sign into live Firebase") instead of signing into a real
  deployment — the gate itself wires the emulator only on localhost, so a
  non-localhost page would mean live Firebase.

A suite never fails open: it either runs against the emulator or it does
not run.

The dev matrix:

- **Endpoint tests** (activate, unlink, gate-edge server side): file store
  plus `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
  GOOGLE_CLOUD_PROJECT=atelier-tap` on the service.
- **Patient-side suites**: the browser connects to the emulator itself —
  `auth-gate.js` wires `connectAuthEmulator` whenever the page is served
  from localhost. No env needed in the page.
- **Full Firestore path**: `CARD_STORE=firestore
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8081` with `firebase emulators:start`
  (the Firestore emulator needs a JRE). The file store covers the same
  interface, which is what the suites exercise.

The service for suites that exercise `/api/activate` additionally needs
the emulator wired in so it verifies tokens locally:

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/<file>.json PORT=<port> node server.js
```

Suites import the shared helper:

```js
import { signInGoogle, signUpEmail, signInEmail, clearSession } from './auth-session.mjs';

await page.goto(`${BASE}/`);
await signInGoogle(page);                 // a real Firebase session, persisted
await signUpEmail(page, { email, password, name });   // create + profile name
await signInEmail(page, { email, password });         // existing account
await clearSession(page);                 // simulate WebKit ITP wiping it
```

`signInGoogle` speaks the same SDK calls the gate itself uses — the Auth
emulator mints a fake Google account per `identity` (default `alice`), and
the same identity always means the same account. There is no gate-bypass
in the code: a suite passes because it is signed in, exactly like a
patient. Suites that open stored cards: `empty-card`, `click-every-link`,
`added-pens`, `protocol-change`, `push-ui`, `studio-pens`, `gate-edge`.

Those suites also expect the named dev cards — `est.t` (Established),
`layn.p-v2p` (Layna), `test.p` (Test), `rem.t` (Rem), `blank.q`
(blank), `edge.t` (Edge), `gate.t` (Gate) — which the seed tool writes
into any file store:

```bash
cd portal
SEED_FILE=.data-test/gate-cards.json npm run seed      # per-suite file
npm run seed                                           # or the dev store
```

Cards a suite opens in the browser carry a start date in `settings`,
so the ritual page never raises its first-run start-day scrim over the
clicks the suite is making. For suites that talk to the dashboard
(`added-pens`, `protocol-change`, `studio-pens`), mint a Studio session
token first:

```bash
TOK=$(curl -s -X POST http://localhost:<port>/api/session \
  -H "Content-Type: application/json" -d '{"passphrase":"testpassphrase"}' -i \
  | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: ca_studio=//' | cut -d';' -f1)
echo "$TOK" > /tmp/tok.txt
```

## gate-email.mjs

The email + password path end to end against the Auth emulator: sign-up
through the gate links the card with provider `password` and the typed
name; an existing email suggests sign-in and flips the form; a wrong
password and an unknown email show one uniform message; and a password
reset (Admin `generatePasswordResetLink` → `oobCode` →
`confirmPasswordReset` in the browser) lets the patient back in without
touching `activatedBy`. Needs the Auth emulator and a service with
`STUDIO_PASSPHRASE` and `FIREBASE_AUTH_EMULATOR_HOST`; the seed tool
provides the cards.

## unlink.mjs

The clinician's link reset, over HTTP: an unauthenticated POST to
`/api/cards/<slug>/unlink` is refused, a passphrase-protected POST clears
`activatedBy` and nothing else, and the next sign-in links the card again.
Node-only, activate-style; needs the Auth emulator and a service with
`STUDIO_PASSPHRASE` and `FIREBASE_AUTH_EMULATOR_HOST`.

## studio-link.mjs

Card Studio's activation surface in a real browser: the LINKED / NOT
LINKED pill, the detail line (name, provider, uid, timestamp — never an
email), and the confirmed Unlink control that returns the pill to NOT
LINKED. Needs a Studio session token (above) and a store seeded with
`linked.t` and `fresh.t` (the seed tool writes them).

## push-crypto.mjs

The cryptography, checked rather than assumed. Signs a VAPID token and
**verifies it against the published public key**, then encrypts a payload and
**decrypts it back with the receiver's private key** — what a browser does.
Also checks the payload for drug names, dose words and patient names, so the
rule that nothing clinical leaves the service is enforced by a test rather
than by memory.

```bash
cd portal
KEYS=$(node -e "const{generateKeys}=require('./lib/push');const k=generateKeys();console.log(k.publicKey+' '+k.privateKey)")
VAPID_PUBLIC_KEY=$(echo $KEYS|cut -d' ' -f1) \
VAPID_PRIVATE_KEY=$(echo $KEYS|cut -d' ' -f2) \
VAPID_SUBJECT=mailto:test@example.com \
node tests/push-crypto.mjs
```

## push-flow.mjs

The delivery loop against a running service: a reminder fires once, does not
fire twice, is dropped rather than delivered when it has gone stale, and stops
entirely when the card is retired. Needs a **fresh card file each run** — the
suite retires its own card and would collide with a previous run's record.

Needs a local HTTPS endpoint to stand in for Apple:

```bash
openssl req -x509 -newkey rsa:2048 -keyout /tmp/sink-key.pem \
  -out /tmp/sink-cert.pem -days 2 -nodes -subj "/CN=localhost"

node -e "const https=require('node:https'),fs=require('node:fs');
  https.createServer({key:fs.readFileSync('/tmp/sink-key.pem'),
  cert:fs.readFileSync('/tmp/sink-cert.pem')},(q,s)=>{s.writeHead(201);s.end()}).listen(9443)" &

NODE_TLS_REJECT_UNAUTHORIZED=0 CARD_STORE=file STUDIO_PASSPHRASE=testpassphrase \
  PUSH_RUN_SECRET=run-secret PORT=8096 \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... node server.js &

node tests/push-flow.mjs
```

## push-ui.mjs

The patient's side in a real browser: the switch appears, subscribes, survives
a reload, turns off again, and never appears on an unassigned card. It also
compares the schedule posted to the server against the doses the card itself
computes, so the two cannot drift.

It **stubs the browser's push service** — headless Chromium has no connection
to Apple or Google and always refuses to subscribe. That one piece is the
browser's plumbing, not ours, and it is covered by push-crypto.mjs against a
real key and push-flow.mjs against a real endpoint.

```bash
CARD_STORE=file STUDIO_PASSPHRASE=testpassphrase PORT=8094 \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... node server.js &
# create a card at rem.t and a blank at blank.q, then:
node tests/push-ui.mjs
```

## logging.mjs

The five ways a dose gets marked, in a real browser against a real server:
the syringe drawn to the mark, the draw-up instruction stated as a number
and nothing else, a button under every pen due today, that button spent by
a tapped vial without touching the other pen, and a circle in the schedule
filled in after the fact — asked first, written to the server on the right
day, and never offered for a dose she has not taken yet.

It mints its own card each run, so it can be run twice.

```bash
cd portal
CARD_STORE=file CARD_FILE=.data-test/cards.json DOSE_FILE=.data-test/doses.json \
  PORT=8099 node server.js &
node tests/logging.mjs
```

## protocol-change.mjs

A card left open, the way a home-screen card is: iOS hands the page back
exactly as it was left and nothing re-runs. The atelier adds a peptide,
then removes one, and the patient simply returns to the app — no reload.
Also checks that coming back with nothing changed redraws nothing.

## added-pens.mjs

The `+` on Today's Ritual. A peptide a patient adds reaches the record
without touching what was prescribed, comes back on a phone that has
never seen it, and can be taken off again by her. A prescribed pen can
be taken off too — recorded in `dropped` rather than deleted from
`pens` — stays off across a reload, and comes back when she asks.

Both need a service with a Studio session; see logging.mjs for the setup,
and mint a session cookie from STUDIO_PASSPHRASE.

## studio-pens.mjs

The atelier's side of a stopped prescription: Card Studio says she has
stopped it, offers to put it back, and saving puts it back on her card.

## atelier-alert.mjs

Being told when a patient stops a prescription: the device subscribes
(and only behind the passphrase), a newly stopped pen sends exactly one
push, her phone re-posting the same list sends none, adding one of her
own or putting a pen back sends none, and turning it off makes it quiet.
It also reads the notification body out of server.js and checks it names
no drug and no patient — the same rule push-crypto.mjs enforces for the
patient's reminders.

Needs the push sink and VAPID keys; see push-flow.mjs for both, plus a
Studio session cookie in /tmp/tok.txt.

## supply-flags.mjs

Who is out of something, read off the dashboard list. A pen is projected
from the prescription and the start day, so a patient who has not opened
her card in a fortnight is still flagged; a vial she sized herself —
tirzepatide, a NAD vial — comes from her card's own report instead,
because this end cannot know how big it is. Also checks that a start day
which only ever reached her phone still counts, which it did not before.

## overview.mjs

The read-only overview at /api/overview. What it refuses (no token, a
wrong token, the studio cookie alone, anything but GET), what it answers
with, and what it must never carry — the clinician note, dose history,
injection sites, times, push subscriptions, or any field beyond the
agreed list. It also pins the milligram-to-unit resolution: templates
state the dose in milligrams and the pen is dialled in units, and reading
the file raw makes every pen measure as lasting no days, which reports
that nobody is ever short of anything.

```bash
AGENT_TOKEN=test-agent-token-xyz CARD_STORE=file STUDIO_PASSPHRASE=tp \
  PORT=8095 node server.js &
node tests/overview.mjs
```

## pen-starts.mjs

Each pen keeps its own start day. The sheet asks per pen, moving one
leaves the others where they were, it survives a reload, a pen added
today starts today without disturbing anything, each pen's day reaches
the atelier, and every pen carries a remove control in the rhythm sheet
— due today or not.

## first-dose-start.mjs

The start day is the day of the first dose, not the day it was planned.
Before any dose a pen follows the atelier's date; the first logged dose
replaces it; a later dose does not move it; a dose back-filled to an
earlier day does; a date typed in the sheet pins it and the log stops
moving it; and saving the sheet without touching a date pins nothing, so
a pen not yet started still picks up its own first dose.

Every suite takes BASE, so the whole set can be run against one service.

## tirz-vial.mjs

Every tirzepatide vial is 1 mL — 100 units — whatever the patient doses
out of it. Her own dose at N units a week gives floor(100/N) doses; a
stored answer claiming a bigger vial cannot resize it; two vials are
2 mL and twice the doses and do not restart the schedule.

## no-reprompt.mjs

A card that is already anchored must never ask when she started again.
Safari clears script storage after seven quiet days, and the card used to
ask whenever THIS BROWSER had no answer — so a patient two months in was
asked the question and shown a two-month-old date, and one tap on "Today"
moved her phases, supply, refill date and calendar forward two months.
Each visit here uses a brand-new browser context, which is exactly what
that eviction leaves behind.

## services.mjs

Aesthetic treatments and their cadences, in Dr Kendall's own terms: PRX
weekly four times then monthly, toxin every three months, filler with no
cadence at all, polynucleotides every four weeks for a course of three,
liquid lipo at eight to ten weeks for a course of two. Also the colours,
and that a treatment not on the menu is dropped rather than stored.
