# Apple Wallet

A pass in the patient's Wallet is a second door to the same card: her name, the
atelier's mark, and a QR of her card address. The plastic tag stays what it is;
this is the copy she has when the card is in a drawer.

The pass builder is written and tested. What it needs before it can produce a
pass is a certificate that only your Apple Developer account can issue — Apple
requires every pass to be signed, and there is no way around that.

---

## What it will and won't do

**Will.** Sit in Wallet with the CA monogram, greet her by name, and open the
portal from a QR on the lock screen. Survive a new phone through iCloud.

**Won't, yet.** Show today's dose. A pass only refreshes when a push service
tells it to, and a stale number on a lock screen is worse than no number. The
QR opens the portal, which is always current. Adding live dose to the pass means
running the PassKit update web service — a real but separate piece of work, and
worth doing once the pass itself is in patients' hands.

**Won't, ever.** Tap-to-open by NFC from the pass itself. Passes can carry an
NFC payload, but Apple restricts that entitlement to access, transit and payment
partners. Not available to a medical practice, and not needed — the plastic card
is already the NFC surface.

---

## What you need

1. **Apple Developer Program membership** — $99/year, <https://developer.apple.com/programs/>.
   Enroll as The Charleston Atelier (an organization enrollment needs a D-U-N-S
   number; individual enrollment works too and is faster).
2. **A Pass Type ID.**
   Developer portal → Certificates, Identifiers & Profiles → Identifiers → **+** →
   Pass Type IDs. Name it `pass.com.thecharlestonatelier.card`.
3. **A signing certificate for that Pass Type ID**, and Apple's intermediate
   certificate.

---

## Making the certificates

On your Mac:

```bash
# 1. A private key and a signing request
openssl genrsa -out pass.key 2048
openssl req -new -key pass.key -out pass.csr \
  -subj "/emailAddress=you@thecharlestonatelier.com/CN=Charleston Atelier Pass/C=US"
```

Upload `pass.csr` in the developer portal under your Pass Type ID, download the
resulting `pass.cer`, then:

```bash
# 2. Convert Apple's certificate to PEM
openssl x509 -inform DER -outform PEM -in pass.cer -out pass.pem

# 3. Apple's intermediate — download "Worldwide Developer Relations" G4 from
#    https://www.apple.com/certificateauthority/
openssl x509 -inform DER -outform PEM -in AppleWWDRCAG4.cer -out wwdr.pem
```

You now have three files: `pass.key`, `pass.pem`, `wwdr.pem`.

---

## Putting them on the service

They are secrets. They go in Secret Manager, never in the repository.

```bash
for f in pass.key pass.pem wwdr.pem; do
  gcloud secrets create "wallet-${f//./-}" --data-file="$f"
  gcloud secrets add-iam-policy-binding "wallet-${f//./-}" \
    --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor"
done
```

Then redeploy, mounting them where the builder expects and setting the two
identifiers:

```bash
gcloud run deploy atelier-tap \
  --source . --region us-east1 --allow-unauthenticated \
  --set-env-vars CARD_STORE=firestore,NODE_ENV=production,\
PASS_TYPE_ID=pass.com.thecharlestonatelier.card,APPLE_TEAM_ID=YOURTEAMID \
  --set-secrets STUDIO_PASSPHRASE=studio-passphrase:latest,\
PRACTICE_BETTER_API_KEY=practice-better-key:latest,\
/secrets/wallet/pass.key=wallet-pass-key:latest,\
/secrets/wallet/pass.pem=wallet-pass-pem:latest,\
/secrets/wallet/wwdr.pem=wallet-wwdr-pem:latest
```

Your Team ID is in the developer portal under Membership.

---

## The artwork

Drop these into `portal/wallet-assets/`:

| File | Size | What it is |
|---|---|---|
| `icon.png` | 29 × 29 | Required. Shows in notifications and the share sheet. |
| `icon@2x.png` | 58 × 58 | Required in practice — every current iPhone is 2x or 3x. |
| `logo.png` | up to 160 × 50 | The mark across the top of the pass. |
| `logo@2x.png` | up to 320 × 100 | |

The CA monogram currently in the portal is a reconstruction. This is the right
moment to drop in the real one — it is the same file the portal should use.

---

## Checking it works

```bash
curl -s https://tap.thecharlestonatelier.com/api/wallet/status
# {"available":true}   once the certificates are mounted

curl -so phil.pkpass https://tap.thecharlestonatelier.com/api/wallet/phil.h
```

AirDrop `phil.pkpass` to an iPhone. It should open straight into Wallet with an
Add button. If iOS refuses it, the signature or the Pass Type ID is wrong — the
Console app on a connected Mac shows the reason.

Once `available` is true, the portal shows an **Add to Apple Wallet** button on
the patient's card.

---

## Cost

$99/year for the developer account. The passes themselves cost nothing to make
or serve.
