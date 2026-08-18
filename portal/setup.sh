#!/usr/bin/env bash
#
# THE CHARLESTON ATELIER — put the tap card service live.
#
# Run this once. It enables what Google needs, creates the database, stores
# the passphrase, deploys the service, and checks it answered. Safe to run
# again: everything it makes, it re-uses if it is already there.
#
#   bash portal/setup.sh
#
set -euo pipefail

REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-atelier-tap}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- checks
if [ ! -f Dockerfile ] || [ ! -d portal ]; then
  die "This does not look like the right place — no Dockerfile and no portal/ here.

   Two usual reasons:
     - you are not at the top of the repository, or
     - you cloned the default branch, which does not carry the service yet.

   Try:
     git clone -b claude/jessica-nfc-patient-portal-4nxcmj \\
       https://github.com/thecharlestonatelier/tap-experience.git
     cd tap-experience && bash portal/setup.sh"
fi

command -v gcloud >/dev/null || die \
  "gcloud is not installed. Easiest fix: run this in Google Cloud Shell, where it already is.
   Open https://console.cloud.google.com and click the terminal icon, top right."

# Cloud Shell knows which project the console is on even when gcloud's own
# config has not been set, so take that rather than stopping for it.
PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  PROJECT="${DEVSHELL_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
  if [ -n "$PROJECT" ]; then
    gcloud config set project "$PROJECT" --quiet >/dev/null 2>&1 || true
    echo "Using the project this console is on: $PROJECT"
  fi
fi
[ -n "$PROJECT" ] && [ "$PROJECT" != "(unset)" ] || die \
  "No project selected. Run:

     gcloud config set project atelier-tap

   then run this again. (gcloud projects list shows what you have.)"

bold "Project : $PROJECT"
bold "Region  : $REGION"
bold "Service : $SERVICE"

# Billing has to be attached even though this sits inside the free tier.
if ! gcloud beta billing projects describe "$PROJECT" \
     --format='value(billingEnabled)' 2>/dev/null | grep -qi true; then
  die "Billing is not enabled on $PROJECT.
   Open https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT
   and attach a billing account, then run this again.
   (Cloud Run and Firestore both have free tiers this service stays inside.)"
fi

step "The BAA"
cat <<'NOTE'
Patient protocols are PHI. Google will sign a Business Associate Agreement,
but you have to accept it — this script cannot.

  Console -> search "HIPAA" -> review and accept.

Do that BEFORE the first real patient record goes in. A test card is fine now.
NOTE
read -r -p "Press return to continue. " _

# ---------------------------------------------------------------- services
step "Turning on the Google services"
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --quiet
echo "done."

# ---------------------------------------------------------------- database
step "Database"
if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  echo "Firestore already exists — leaving it alone."
else
  gcloud firestore databases create --location=nam5 --quiet
  echo "Firestore created."
fi

# ---------------------------------------------------------------- secrets
put_secret() {           # put_secret NAME VALUE
  local name="$1" value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --quiet >/dev/null
    echo "  $name updated."
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --quiet >/dev/null
    echo "  $name created."
  fi
}

step "The passphrase that opens Card Studio"
echo "Pick something long. It is the only thing between the dashboard and the open web."
PASS=""
while [ ${#PASS} -lt 12 ]; do
  read -r -s -p "Studio passphrase (12+ characters, hidden): " PASS; echo
  [ ${#PASS} -lt 12 ] && warn "Too short — keep going."
done
put_secret studio-passphrase "$PASS"
unset PASS

step "Reminder keys"
# VAPID identifies this service to Apple and Google. The pair must survive
# every redeploy: generating a new one turns off reminders for every
# patient who has them on, silently, until each turns them back on.
if gcloud secrets describe vapid-private-key >/dev/null 2>&1; then
  echo "  Already have a key pair — keeping it."
  echo "  (Replacing it would turn every patient's reminders off.)"
else
  KEYS="$(node portal/scripts/push-keys.js 2>/dev/null | awk '/VAPID_PUBLIC_KEY/{p=$2} /VAPID_PRIVATE_KEY/{v=$2} END{print p" "v}')"
  VP="$(echo "$KEYS" | cut -d' ' -f1)"
  VK="$(echo "$KEYS" | cut -d' ' -f2)"
  if [ -n "$VP" ] && [ -n "$VK" ]; then
    put_secret vapid-public-key "$VP"
    put_secret vapid-private-key "$VK"
    echo "  Generated. Reminders are available."
  else
    warn "  Could not generate the pair (is node here?). Reminders stay off;
     the rest of the service is unaffected. Fix later with:
       node portal/scripts/push-keys.js"
  fi
  unset KEYS VP VK
fi

# The shared secret Cloud Scheduler proves itself with when it asks the
# service to sweep for due reminders.
if ! gcloud secrets describe push-run-secret >/dev/null 2>&1; then
  put_secret push-run-secret "$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | cut -c1-32)"
fi

step "Practice Better key"
echo "Optional. Press return to skip — Card Studio takes typed names either way."
read -r -s -p "Practice Better API key (hidden, or return to skip): " PB; echo
if [ -n "$PB" ]; then put_secret practice-better-key "$PB"; else
  # The service expects the secret to exist; a placeholder keeps the deploy simple.
  gcloud secrets describe practice-better-key >/dev/null 2>&1 || put_secret practice-better-key "unset"
  echo "  skipped."
fi
unset PB

# ---------------------------------------------------------------- iam
step "Letting the service read those secrets"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for s in studio-passphrase practice-better-key vapid-public-key vapid-private-key push-run-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" --quiet >/dev/null
done
echo "done."

# Projects created from 2024 on no longer hand the default compute account
# Editor, so a source deploy cannot read its own uploaded zip, run the build,
# push the image, or write build logs until these are granted by hand.
step "Letting the builder do its job, and the service reach its database"
for role in \
  roles/cloudbuild.builds.builder \
  roles/storage.objectViewer \
  roles/artifactregistry.writer \
  roles/logging.logWriter \
  roles/datastore.user
do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="$role" --condition=None --quiet >/dev/null
  echo "  $role"
done

# IAM is eventually consistent; a deploy fired the instant after the grant can
# still see the old policy.
echo "Waiting a few seconds for those permissions to take effect."
sleep 15

# ---------------------------------------------------------------- deploy
step "Building and deploying — three or four minutes the first time"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars CARD_STORE=firestore,NODE_ENV=production \
  --set-secrets STUDIO_PASSPHRASE=studio-passphrase:latest,PRACTICE_BETTER_API_KEY=practice-better-key:latest,VAPID_PUBLIC_KEY=vapid-public-key:latest,VAPID_PRIVATE_KEY=vapid-private-key:latest,PUSH_RUN_SECRET=push-run-secret:latest \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

# ---------------------------------------------------------------- reminders
# Cloud Run scales to zero, so nothing inside it can keep time. Cloud
# Scheduler knocks every quarter hour and the service works out whose dose
# has just come round.
#
# A quarter hour is the resolution of a reminder: a dose set for 7:30
# arrives somewhere in 7:30–7:45. Finer means more wake-ups for no real
# gain — nobody injects to the minute.
if gcloud secrets describe push-run-secret >/dev/null 2>&1; then
  step "The clock that fires reminders"
  gcloud services enable cloudscheduler.googleapis.com --quiet >/dev/null 2>&1 || true
  RUN_SECRET="$(gcloud secrets versions access latest --secret=push-run-secret 2>/dev/null || true)"
  if [ -n "$RUN_SECRET" ]; then
    if gcloud scheduler jobs describe atelier-reminders --location "$REGION" >/dev/null 2>&1; then
      gcloud scheduler jobs update http atelier-reminders \
        --location "$REGION" --schedule "*/15 * * * *" \
        --uri "$URL/api/push/run" --http-method POST \
        --update-headers "x-push-secret=$RUN_SECRET" --quiet >/dev/null && \
        echo "  Updated — every 15 minutes."
    else
      gcloud scheduler jobs create http atelier-reminders \
        --location "$REGION" --schedule "*/15 * * * *" \
        --uri "$URL/api/push/run" --http-method POST \
        --headers "x-push-secret=$RUN_SECRET" \
        --attempt-deadline 120s --quiet >/dev/null && \
        echo "  Created — every 15 minutes."
    fi
  fi
  unset RUN_SECRET
fi

# ---------------------------------------------------------------- public
# Patients tap a card; they do not sign in to Google. But an organization
# turns on Domain restricted sharing by default, and that forbids allUsers,
# so --allow-unauthenticated above may have been quietly refused. Ask again
# on its own so the failure is legible instead of buried in deploy output.
step "Letting patients reach it without signing in"
if gcloud run services add-iam-policy-binding "$SERVICE" \
     --region="$REGION" --member=allUsers --role=roles/run.invoker \
     --quiet >/dev/null 2>&1; then
  echo "done — the service is publicly reachable."
  PUBLIC=yes
else
  PUBLIC=no
  warn "Could not open the service to the public.

  Almost always this is your organization's Domain restricted sharing policy,
  which forbids granting anything to allUsers. Except this one project:

    Console -> IAM & Admin -> Organization policies
    -> search \"Domain restricted sharing\"
    -> project picker set to $PROJECT
    -> Manage policy -> Override parent's policy
    -> Add a rule -> Allow all -> Save

  Scope that override to the $PROJECT project only, never the organization.
  Then run this one command — you do not need the whole script again:

    gcloud run services add-iam-policy-binding $SERVICE \\
      --region=$REGION --member=allUsers --role=roles/run.invoker

  Until then the service is up but private, and the checks below will all
  read 403. That is the lock, not a fault in the service."
fi

# ---------------------------------------------------------------- check
step "Checking it answered"
HEALTH="$(curl -fsS "$URL/health" || true)"
GATE="$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/cards" || true)"

echo "  /health     ${HEALTH:-(no answer)}"
echo "  /api/cards  $GATE  (401 means the dashboard is locked, which is right)"

if [ "$PUBLIC" = "no" ] && [ "$GATE" = "403" ]; then
  warn "Both 403s are the access policy above, not the service. Fix that first."
else
  case "$HEALTH" in
    *'"reachable":true'*) ;;
    *'"reachable":false'*) warn "The service is up but cannot reach Firestore. The message above says why.
     Usually: gcloud projects add-iam-policy-binding $PROJECT \\
       --member=serviceAccount:${SA} --role=roles/datastore.user" ;;
    *) warn "Health did not answer as expected. Check: gcloud run services logs read $SERVICE --region $REGION" ;;
  esac
  [ "$GATE" = "401" ] || warn "Expected 401 on /api/cards. If it is 200 the passphrase did not take."
fi

# ---------------------------------------------------------------- done
step "Live"
cat <<EOF

  Portal   $URL
  Studio   $URL/studio

Next, in a browser:
  1. Open the Studio link and sign in with the passphrase you just set.
  2. Make a test card, open its address, confirm it greets that name.
  3. Edit the card, reload the address, watch it change without rewriting a tag.

Only once that works, point the domain at it:

  gcloud beta run domain-mappings create \\
    --service $SERVICE --domain tap.thecharlestonatelier.com --region $REGION

Leave ca-tap.netlify.app alone — the cards already in patients' wallets
resolve there and cannot be rewritten.

To deploy again after any change, this is the whole command:

  gcloud run deploy $SERVICE --source . --region $REGION

EOF
