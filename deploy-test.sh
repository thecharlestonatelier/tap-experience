#!/usr/bin/env bash
#
# THE CHARLESTON ATELIER — deploy the test tap card service.
#
# Deploys `atelier-tap-test`, a public twin of the production service that
# writes to its own Firestore collections and opens with its own passphrase,
# so a tap or a Studio edit can be rehearsed without touching patient data.
# Run from the repository root:
#
#   bash deploy-test.sh
#
# It reuses the production VAPID key pair and push-run secret (portal/setup.sh
# creates those), because regenerating a VAPID pair silently turns every
# patient's reminders off. Only the Studio passphrase is separate. Safe to
# run again: everything it makes, it re-uses if it is already there.
#
set -euo pipefail

REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-atelier-tap-test}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- checks
if [ ! -f Dockerfile ] || [ ! -d portal ]; then
  die "Not at the repository root — no Dockerfile and no portal/ here.
   Run this from the top of tap-experience."
fi

command -v gcloud >/dev/null || die \
  "gcloud is not installed. Run this in Google Cloud Shell or after
   installing the Cloud SDK."

# Cloud Shell knows which project the console is on even when gcloud's own
# config has not been set, so take that rather than stopping for it.
PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  PROJECT="${DEVSHELL_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
  [ -n "$PROJECT" ] && gcloud config set project "$PROJECT" --quiet >/dev/null 2>&1 || true
fi
[ -n "$PROJECT" ] && [ "$PROJECT" != "(unset)" ] || die \
  "No project selected. Run: gcloud config set project atelier-tap"

bold "Project : $PROJECT"
bold "Service : $SERVICE ($REGION)"

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

step "The passphrase that opens the TEST Card Studio"
echo "Pick something long. It opens the test dashboard only — production has its own."
PASS=""
while [ ${#PASS} -lt 12 ]; do
  read -r -s -p "Test Studio passphrase (12+ characters, hidden): " PASS; echo
  [ ${#PASS} -lt 12 ] && warn "Too short — keep going."
done
put_secret studio-passphrase-test "$PASS"
unset PASS

step "Shared secrets (VAPID + push-run)"
# These two services sign reminders with the same VAPID pair, and Cloud
# Scheduler proves itself with the same push-run secret. They must already
# exist — portal/setup.sh creates them. A missing one here means the base
# setup has not been run, and the deploy would come up without reminders.
for s in vapid-public-key vapid-private-key push-run-secret; do
  gcloud secrets describe "$s" >/dev/null 2>&1 || \
    die "The shared secret '$s' is missing. Run 'bash portal/setup.sh' once
   to create it (it also deploys production), then run this again."
done
echo "  reusing vapid-public-key, vapid-private-key, push-run-secret."

step "Letting the service read those secrets"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for s in studio-passphrase-test vapid-public-key vapid-private-key push-run-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" --quiet >/dev/null
done
echo "done."

# Projects created from 2024 on no longer hand the default compute account
# Editor, so a source deploy cannot read its own uploaded zip, run the build,
# push the image, write logs, or reach Firestore until these are granted.
# portal/setup.sh grants them too; granting again is a no-op.
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
done

# IAM is eventually consistent; a deploy fired the instant after the grant can
# still see the old policy.
echo "Waiting a few seconds for those permissions to take effect."
sleep 15

# ---------------------------------------------------------------- deploy
# Every collection is overridden to a *-test twin, so nothing the test
# instance reads or writes is ever mixed with production records.
step "Building and deploying the test service"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars CARD_STORE=firestore,NODE_ENV=production,CARD_COLLECTION=cards-test,SUB_COLLECTION=reminders-test,FEED_COLLECTION=feeds-test,DOSE_COLLECTION=administrations-test \
  --set-secrets STUDIO_PASSPHRASE=studio-passphrase-test:latest,VAPID_PUBLIC_KEY=vapid-public-key:latest,VAPID_PRIVATE_KEY=vapid-private-key:latest,PUSH_RUN_SECRET=push-run-secret:latest

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

# ---------------------------------------------------------------- public
step "Letting patients reach it without signing in"
if gcloud run services add-iam-policy-binding "$SERVICE" \
     --region="$REGION" --member=allUsers --role=roles/run.invoker \
     --quiet >/dev/null 2>&1; then
  echo "done — the test service is publicly reachable."
else
  warn "Could not open the test service to the public. This is usually the
  organization's Domain restricted sharing policy. See portal/DEPLOY.md
  (step 5) for the project-scoped override, then run:

    gcloud run services add-iam-policy-binding $SERVICE \\
      --region=$REGION --member=allUsers --role=roles/run.invoker"
fi

# ---------------------------------------------------------------- reminders
# Test reminders get their own scheduler job so they fire against the test
# URL and never the production one.
step "The clock that fires test reminders"
gcloud services enable cloudscheduler.googleapis.com --quiet >/dev/null 2>&1 || true
RUN_SECRET="$(gcloud secrets versions access latest --secret=push-run-secret 2>/dev/null || true)"
if [ -n "$RUN_SECRET" ]; then
  if gcloud scheduler jobs describe atelier-reminders-test --location "$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http atelier-reminders-test \
      --location "$REGION" --schedule "*/15 * * * *" \
      --uri "$URL/api/push/run" --http-method POST \
      --update-headers "x-push-secret=$RUN_SECRET" --quiet >/dev/null && \
      echo "  Updated — every 15 minutes."
  else
    gcloud scheduler jobs create http atelier-reminders-test \
      --location "$REGION" --schedule "*/15 * * * *" \
      --uri "$URL/api/push/run" --http-method POST \
      --headers "x-push-secret=$RUN_SECRET" \
      --attempt-deadline 120s --quiet >/dev/null && \
      echo "  Created — every 15 minutes."
  fi
fi
unset RUN_SECRET

# ---------------------------------------------------------------- check
step "Checking it answered"
HEALTH="$(curl -fsS "$URL/health" || true)"
GATE="$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/cards" || true)"

echo "  /health     ${HEALTH:-(no answer)}"
echo "  /api/cards  $GATE  (401 means the test dashboard is locked, which is right)"

case "$HEALTH" in
  *'"reachable":true'*) echo "  store       reachable." ;;
  *'"reachable":false'*) warn "The test service is up but cannot reach Firestore.
   Usually: gcloud run services logs read $SERVICE --region $REGION" ;;
  *) warn "Health did not answer as expected.
   Check: gcloud run services logs read $SERVICE --region $REGION" ;;
esac
[ "$GATE" = "401" ] || warn "Expected 401 on /api/cards — if it is 200 the passphrase did not take."

step "Live"
cat <<EOF

  Test portal   $URL
  Test studio   $URL/studio

  Production is untouched. Everything above reads and writes the
  cards-test, reminders-test, feeds-test and administrations-test
  collections, and opens with the passphrase you just set.

EOF
