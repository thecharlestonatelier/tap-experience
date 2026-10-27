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

PROJECT="atelier-tap"
# Pin the project for this run: gcloud otherwise inherits whatever project
# the local config has active. Scoped to this script — config is untouched.
export CLOUDSDK_CORE_PROJECT="$PROJECT"

bold "Project : $PROJECT"
bold "Service : $SERVICE ($REGION)"

# ---------------------------------------------------------------- deploy
step "Deploying production"

# --set-secrets REPLACES the service's whole secret list, so every secret
# the service needs has to be named here, every time. Naming fewer is what
# switched reminders off in production twice.
SECRETS="STUDIO_PASSPHRASE=studio-passphrase:latest"
SECRETS="$SECRETS,VAPID_PUBLIC_KEY=vapid-public-key:latest"
SECRETS="$SECRETS,VAPID_PRIVATE_KEY=vapid-private-key:latest"
SECRETS="$SECRETS,PUSH_RUN_SECRET=push-run-secret:latest"

# The read-only overview is off until a token exists, and naming a secret
# that does not exist fails the whole deploy — so this is added only when
# it is really there. To turn it on:
#
#   openssl rand -base64 32 | tr -d '\n' \
#     | gcloud secrets create agent-token --data-file=- \
#     && bash deploy-prod.sh
#
# and to revoke it, delete the secret and deploy again.
if gcloud secrets describe agent-token >/dev/null 2>&1; then
  SECRETS="$SECRETS,AGENT_TOKEN=agent-token:latest"
  bold "Overview : on (agent-token exists)"
else
  bold "Overview : off (no agent-token secret)"
fi

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars CARD_STORE=firestore,NODE_ENV=production \
  --set-secrets "$SECRETS",AGENT_TOKEN=agent-token:latest

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
# Reminders fail silently. Nothing errors, no patient complains, and the
# first sign is a dose nobody was nudged about — so the deploy asks.
PUSHK="$(curl -fsS "$URL/api/push/key" || true)"

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

case "$PUSHK" in
  *'"available":true'*) echo "  reminders   on — the signing keys are attached." ;;
  *) warn "REMINDERS ARE OFF. The service has no VAPID keys, so no patient
   will be nudged for a dose and the atelier will not be told when one
   changes her protocol. Nothing else will report this — it fails quietly.

   Almost always this: a 'gcloud run deploy --set-secrets' naming fewer
   than all four secrets. --set-secrets REPLACES the list; it does not add
   to it. This script names all four, so re-running it is the fix:

     bash deploy-prod.sh" ;;
esac

step "Live"
cat <<EOF

  Portal   $URL
  Studio   $URL/studio

EOF
