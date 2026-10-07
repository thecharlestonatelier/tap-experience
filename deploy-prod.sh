#!/usr/bin/env bash
#
# THE CHARLESTON ATELIER — deploy the production tap card service.
#
# Rebuilds and deploys `atelier-tap`, the service the printed cards and
# tap.thecharlestonatelier.com point at, with the production settings.
# Run from the repository root:
#
#   bash deploy-prod.sh
#
# This is the "deploy again after a change" step from portal/DEPLOY.md,
# written out so the settings are never mistyped. It does not create the
# service or its secrets — run `bash portal/setup.sh` once first.
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

# ---------------------------------------------------------------- deploy
step "Deploying production"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars CARD_STORE=firestore,NODE_ENV=production \
  --set-secrets STUDIO_PASSPHRASE=studio-passphrase:latest,VAPID_PUBLIC_KEY=vapid-public-key:latest,VAPID_PRIVATE_KEY=vapid-private-key:latest,PUSH_RUN_SECRET=push-run-secret:latest

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

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
else
  warn "Could not open the service to the public. This is usually the
  organization's Domain restricted sharing policy. See portal/DEPLOY.md
  (step 5) for the project-scoped override, then run:

    gcloud run services add-iam-policy-binding $SERVICE \\
      --region=$REGION --member=allUsers --role=roles/run.invoker"
fi

# ---------------------------------------------------------------- check
step "Checking it answered"
HEALTH="$(curl -fsS "$URL/health" || true)"
GATE="$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/cards" || true)"

echo "  /health     ${HEALTH:-(no answer)}"
echo "  /api/cards  $GATE  (401 means the dashboard is locked, which is right)"

case "$HEALTH" in
  *'"reachable":true'*) echo "  store       reachable." ;;
  *'"reachable":false'*) warn "The service is up but cannot reach Firestore.
   Usually: gcloud run services logs read $SERVICE --region $REGION" ;;
  *) warn "Health did not answer as expected.
   Check: gcloud run services logs read $SERVICE --region $REGION" ;;
esac
[ "$GATE" = "401" ] || warn "Expected 401 on /api/cards — if it is 200 the passphrase did not take."

step "Live"
cat <<EOF

  Portal   $URL
  Studio   $URL/studio

EOF
