# Reminders

A quiet nudge on the patient's phone when a dose is due. No App Store, no
Apple Developer membership, no $99 — this is the open Web Push standard, which
iOS has supported since 16.4 and Android has supported for years.

---

## What a patient sees

On her card, under the menu, a small **Remind Me** button. She taps it, her
phone asks once whether it may send notifications, and that is the whole setup.

When a dose comes round:

> **The Charleston Atelier**
> Time for your injection.

Tapping it opens her card.

## What the notification does not say

No drug. No dial number. No name. Not "your tirzepatide", not "12 units",
not "Jessica".

Two reasons, and both matter.

**It travels through Apple and Google.** A push notification is handed to
Apple's APNs or Google's FCM to deliver. Neither is covered by the atelier's
BAA. Anything in that payload has left your control.

**It renders on a locked screen.** Whoever is standing next to her can read
it. A card in a handbag is private; a notification is not.

So the message says a dose is due, and everything specific is one tap away,
behind the card address. `portal/lib/push.js` is written to enforce this and
the test suite checks the payload for drug names, dose words and patient
names before it will pass.

---

## The iPhone caveat

**On iPhone, reminders only work once the card is added to the Home Screen.**
That is Apple's rule, not a limitation of this build — Safari grants push to
installed web apps only. A patient who taps her card and reads it in Safari
cannot be reminded.

The card handles this honestly. On an iPhone in Safari, instead of a switch
that would do nothing, she sees:

> Add this card to your Home Screen and reminders become available.

Which is the step she needed anyway. Android and desktop have no such rule.

---

## How it decides when to fire

**The card computes the schedule; the server only keeps time.**

The dosing arithmetic — weekly days, five-on-two-off, phase boundaries, the
day a pen runs dry — lives in `protocol.js`, which is what the patient reads.
When she turns reminders on, her phone works out every dose instant ahead of
her and posts the list. Every time she opens her card, it posts a fresh one.

This is deliberate. Recomputing the schedule on the server would be a second
copy of the same arithmetic, free to drift from the first, and a reminder
firing on a day the portal calls a rest day is worse than no reminder at all.

It also means the stored record is inert: a push endpoint and a list of
timestamps. Nothing clinical, even at rest.

A dose changed in Card Studio reaches her reminders the next time she opens
the card. If she never opens it, the schedule she last posted runs for up to
four months.

Cloud Run scales to zero and cannot keep time, so **Cloud Scheduler** knocks
every fifteen minutes and the service asks whose dose has just come round.
That quarter hour is the resolution: a dose set for 7:30 arrives somewhere in
7:30–7:45.

Two guards worth knowing:

- **Once only.** Each instant is marked sent, so a phone that was off does not
  collect six copies.
- **Never stale.** A reminder more than two hours old is dropped rather than
  delivered. If the scheduler is down from breakfast until four, nobody is
  told at four to take their morning dose.

Retiring a card in Card Studio stops its reminders on the next sweep and
forgets the phones.

---

## Turning it on

`portal/setup.sh` does all of this. It generates the key pair, stores both
halves plus a scheduler secret, and creates the Cloud Scheduler job.

By hand:

```bash
node portal/scripts/push-keys.js        # prints a VAPID pair

printf '%s' 'THE_PUBLIC_KEY'  | gcloud secrets create vapid-public-key  --data-file=-
printf '%s' 'THE_PRIVATE_KEY' | gcloud secrets create vapid-private-key --data-file=-
printf '%s' "$(openssl rand -hex 16)" | gcloud secrets create push-run-secret --data-file=-
```

Then redeploy so the service picks them up, and create the clock:

```bash
gcloud services enable cloudscheduler.googleapis.com

gcloud scheduler jobs create http atelier-reminders \
  --location us-east1 \
  --schedule "*/15 * * * *" \
  --uri "$SERVICE_URL/api/push/run" \
  --http-method POST \
  --headers "x-push-secret=$(gcloud secrets versions access latest --secret=push-run-secret)"
```

### Never regenerate the key pair

The VAPID pair is the service's identity to Apple and Google. Generating a new
one **silently turns off reminders for every patient who has them on** — their
phones keep a subscription tied to the old key, and nothing will ever arrive
again. There is no notice, on their end or yours. They would each have to open
their card and turn reminders back on.

`setup.sh` refuses to replace an existing pair for this reason.

---

## Checking it works

Card Studio has **Send test** on any card with reminders on. It delivers:

> Reminders are working. You will hear from us when a dose is due.

Or by hand:

```bash
curl -s $SERVICE_URL/api/push/key            # {"available":true,"key":"..."}
curl -s -X POST $SERVICE_URL/api/push/run \
  -H "x-push-secret: $(gcloud secrets versions access latest --secret=push-run-secret)"
# {"phones":3,"sent":1,"skipped":2,"dropped":0,"failed":0}
```

`gcloud scheduler jobs describe atelier-reminders --location us-east1` shows
when it last ran.

---

## Cost

Free. Cloud Scheduler allows three jobs at no charge; this uses one. The
sweeps are a few seconds of Cloud Run a day, well inside the free tier. Apple
and Google do not charge to deliver.

---

## Marketing is a different thing

This is treatment communication — a reminder to take a dose the patient is
already prescribed. That is ordinary treatment activity under HIPAA.

**Notifications about specials, new peptides or promotions are marketing**, and
marketing to patients using their health information requires prior written
authorization. Not a checkbox on a form she signed once; a specific
authorization for that use.

If you want to announce something to patients, that needs its own path — its
own consent, its own record of who agreed and when, and a way to withdraw. Ask
me and I will build it properly. Do not put it through this channel.

---

## What is not built

- **Reminders to take a dose she missed.** The service knows when a dose was
  due, not whether she took it — logging injections is deliberately off, since
  Netlify signs no BAA and that habit hasn't moved yet.
- **Per-patient quiet hours.** Every reminder fires at the time she chose for
  that band. There is no do-not-disturb window beyond her phone's own.
- **A message from Dr. Kendall.** The plumbing would carry it, but the payload
  rule means it would have to be generic — "a message from the atelier" — and
  she would tap through to read it. Worth building, needs somewhere for the
  message to live.
