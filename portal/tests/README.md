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
