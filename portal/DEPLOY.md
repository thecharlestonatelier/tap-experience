# Deploying the tap card service

What this gets you: a card address that never changes — `tap.thecharlestonatelier.com/phil.h` —
with the protocol behind it editable from Card Studio for as long as the card exists.
Write the tag once, edit forever.

## The short way

You do not need to install anything, and you do not need a terminal on your Mac.

1. Open <https://console.cloud.google.com> and create a project (call it
   `atelier-tap`). Attach a billing account — this service stays inside the
   free tier, but Google requires one.
2. Click the **terminal icon** in the top-right of the console. That is Cloud
   Shell: a Linux machine in the browser with `gcloud` and `git` already on it,
   already signed in as you.
3. Paste these three lines:

```bash
git clone -b claude/jessica-nfc-patient-portal-4nxcmj \
  https://github.com/thecharlestonatelier/tap-experience.git
cd tap-experience
bash portal/setup.sh
```

The branch matters. `main` does not have the service on it yet — a plain
clone gets the old static site and none of this.

It asks you to accept the BAA, asks for a Studio passphrase, then does the
rest — services, database, secrets, permissions, build, deploy — and prints
your two URLs at the end. Ten minutes, most of it waiting on the build.

It is safe to run twice. Everything it creates, it re-uses if it already
exists.

The rest of this document is what that script does, step by step, for when
something needs doing by hand.

---

Everything below is copy-paste. Budget about forty minutes the first time.

---

## Read this first

Once protocols live on a server, you are storing PHI at rest. That changes the
hosting question from "what's cheap" to "who will sign a BAA."

- **Google Cloud** — signs a BAA under standard terms. You accept it yourself in
  the console; no sales call, no Enterprise contract. Cloud Run, Firestore and
  Secret Manager are all covered services.
- **AWS** — same posture, self-serve BAA through Artifact.
- **Netlify** — does not offer a BAA at any tier. Upgrading your plan does not
  change this, which is why the new service does not live there.
- **Vercel** — BAA on Enterprise only.

These are my understanding of each vendor's current terms, not legal advice.
Confirm the BAA directly with whoever you pick before real patient data goes in.

The instructions below are for Google Cloud.

---

## 1. Accept the BAA

Do this before the first record exists.

1. <https://console.cloud.google.com> → create a project, e.g. `atelier-tap`.
2. Set up billing on it (Cloud Run and Firestore both have free tiers that this
   service will sit inside, but a billing account must be attached).
3. **Navigation menu → Compliance → HIPAA**, or search "HIPAA" in the console.
4. Review and accept the Business Associate Agreement.
5. Keep patient data only in the covered products this service uses:
   Cloud Run, Firestore, Secret Manager, Cloud Logging.

---

## 2. Set up the tools

```bash
# once, on your Mac
brew install --cask google-cloud-sdk

gcloud auth login
gcloud config set project atelier-tap

gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

---

## 3. Create the database

Firestore in Native mode, in a US region:

```bash
gcloud firestore databases create --location=nam5
```

That is the whole database step. The service creates the `cards` collection on
its first write; there is no schema to define.

---

## 4. Store the secrets

Nothing sensitive goes in the repository. Two secrets:

```bash
# The passphrase that opens Card Studio. Pick something long.
printf '%s' 'a long passphrase you choose' | \
  gcloud secrets create studio-passphrase --data-file=-

# Practice Better. Paste the key when prompted, then press Ctrl-D.
gcloud secrets create practice-better-key --data-file=-
```

To change one later:

```bash
printf '%s' 'the new value' | gcloud secrets versions add studio-passphrase --data-file=-
```

Give the service account permission to read them:

```bash
PROJECT_NUMBER=$(gcloud projects describe atelier-tap --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for s in studio-passphrase practice-better-key; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 5. Deploy

From the **repository root** — that is where the `Dockerfile` lives, and
`--source .` only picks up a Dockerfile in the source root:

```bash
cd ~/path/to/tap-experience

gcloud run deploy atelier-tap \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars CARD_STORE=firestore,NODE_ENV=production \
  --set-secrets STUDIO_PASSPHRASE=studio-passphrase:latest,PRACTICE_BETTER_API_KEY=practice-better-key:latest
```

First run takes three or four minutes; later ones are under a minute.

`--allow-unauthenticated` is right here: patients tap a card, they do not sign
in to Google. Card Studio is protected separately by the passphrase.

The deploy prints a URL like `https://atelier-tap-xxxxx-ue.a.run.app`.
Open `/health` on it — you should see `{"ok":true,"store":"firestore"}`. Then
open `/studio`, sign in with the passphrase, and make one test card.

---

## 6. Check it before the domain moves

Do this on the `run.app` URL, while the printed cards still point at the old
site and nothing is at risk:

```bash
SVC=https://atelier-tap-xxxxx-ue.a.run.app

curl -s $SVC/health                 # {"ok":true,"store":"firestore"}
curl -s -o /dev/null -w '%{http_code}\n' $SVC/api/cards   # 401 — the gate is on
```

In a browser: open `/studio`, sign in, create a card, open the address it gives
you, and confirm the portal greets that name. Edit the card, reload the address,
and confirm the change is there without anything being rewritten. That is the
whole point of the service, so it is worth watching it happen once.

---

## 7. Point the domain at it

You already own `tap.thecharlestonatelier.com`. Move it off Netlify and onto
Cloud Run:

```bash
gcloud beta run domain-mappings create \
  --service atelier-tap \
  --domain tap.thecharlestonatelier.com \
  --region us-east1
```

It prints DNS records. Add them at your registrar, delete the old Netlify
record for that subdomain, and wait — usually minutes, sometimes an hour.
The certificate is issued automatically.

**Do not repoint `ca-tap.netlify.app`.** Jessica's, Dustin's and Christie's
cards resolve there, and their tags cannot be rewritten. That site keeps
running as it is, free, forever. So does the forwarding site holding
`atelier-portal-jessica.netlify.app`.

---

## 8. Lock down Card Studio

The passphrase keeps the dashboard off the open web. If you want a second lock,
put Identity-Aware Proxy in front of `/studio` so it also requires your Google
account — console → Security → Identity-Aware Proxy, enable it for the Cloud
Run service, and add yourself as an IAP-secured Web App User.

---

## Running it on your laptop

No cloud project needed. Records go to a JSON file.

```bash
cd portal
CARD_STORE=file STUDIO_PASSPHRASE=test node server.js
# portal   http://localhost:8080/
# studio   http://localhost:8080/studio
```

---

## What it costs

At the volume of a concierge practice — a few hundred cards, a few thousand taps
a month — this sits inside the free tiers of both Cloud Run and Firestore. Expect
$0 to $5 a month, most of it the domain mapping and logging. Cloud Run scales to
zero, so an idle month costs nothing.

---

## Day to day

**Writing a card.** Card Studio → first and last name → Create card. Copy the
address, write it to the tag in NFC Tools, hand it over. See `NFC-CARDS.md`.

**Writing a tray ahead of a clinic day.** Card Studio → Blank tags → Mint blanks.
Write each address to a tag, drop them in a tray. When a patient is ready, open
that card in Studio, give it a name and a protocol, and hand it over. The address
never changes.

**Changing a dose.** Open the card, edit, Save. It reaches the patient on her
next tap. Nothing is rewritten, and she is not told to do anything.

**A patient leaves.** Set the card to Retired. The address still resolves, and
the portal shows nothing.

---

## Still open

- **Practice Better.** The key is wired through to the service, but their API
  base URL, auth header and client-list route still need confirming against
  their developer documentation. Until then Card Studio takes typed names,
  which is what it does today.
- **Apple Wallet.** Requires an Apple Developer Program membership ($99/yr) and
  a Pass Type ID certificate before a pass can be signed. See `WALLET.md`.
- **Five titrations** — BPC-157, GHK-Cu, CJC/Ipamorelin, Tesamorelin, Semax —
  are flagged `needsDose` in `templates.json` and are placeholders until signed
  off. Their concentrations are verified; their dial numbers are not.
