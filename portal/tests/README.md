# Portal test suites

The suites fall into two groups: Node suites that talk HTTP only, and
Playwright suites that open the patient pages in a real browser.

## Stored cards and the sign-in gate

An assigned stored card (a slug with a name) now gates its first tap
behind a Google sign-in. Every suite that opens one must therefore run
against the **Auth emulator** and sign in like a patient:

```bash
firebase emulators:start --only auth          # 127.0.0.1:9099
```

The service for those suites additionally needs the emulator wired in so
`/api/activate` verifies tokens locally:

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/<file>.json PORT=<port> node server.js
```

Suites import the shared helper:

```js
import { signInGoogle, clearSession } from './auth-session.mjs';

await page.goto(`${BASE}/`);
await signInGoogle(page);                 // a real Firebase session, persisted
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
entirely when the card is retired.

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
never seen it, and can be taken off again by her. A prescribed pen
carries no remove control and `removePen()` refuses it.

Both need a service with a Studio session; see logging.mjs for the setup,
and mint a session cookie from STUDIO_PASSPHRASE.

## studio-pens.mjs

The atelier's side of a stopped prescription: Card Studio says she has
stopped it, offers to put it back, and saving puts it back on her card.
