# Reminder tests

Three suites, because reminders fail quietly. A dose that is never nudged
looks exactly like a dose that was nudged and ignored, and neither the
patient nor the atelier finds out.

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
