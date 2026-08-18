#!/usr/bin/env bash
#
# THE CHARLESTON ATELIER — let patients reach the card service.
#
# A Cloud Run service deployed inside an organization comes up private,
# because organizations turn on Domain restricted sharing by default and
# that policy forbids granting anything to allUsers. Patients tap a card;
# they do not sign in to Google. So the service has to be public.
#
# This tries the simple grant, and if the policy blocks it, excepts this
# one project and tries again.
#
#   bash portal/open-to-public.sh
#
set -euo pipefail

REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-atelier-tap}"
CONSTRAINT="constraints/iam.allowedPolicyMemberDomains"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

command -v gcloud >/dev/null || die \
  "gcloud is not installed. Run this in Google Cloud Shell."

PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  PROJECT="${DEVSHELL_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
  [ -n "$PROJECT" ] && gcloud config set project "$PROJECT" --quiet >/dev/null 2>&1 || true
fi
[ -n "$PROJECT" ] && [ "$PROJECT" != "(unset)" ] || die \
  "No project selected. Run: gcloud config set project atelier-tap"

bold "Project : $PROJECT"
bold "Service : $SERVICE ($REGION)"

grant() {
  gcloud run services add-iam-policy-binding "$SERVICE" \
    --region="$REGION" --member=allUsers --role=roles/run.invoker \
    --quiet >/dev/null 2>&1
}

step "Trying the grant"
if grant; then
  echo "Granted on the first try — the policy was not in the way."
else
  echo "Refused, as expected. Excepting this project from the sharing policy."

  step "Excepting $PROJECT from Domain restricted sharing"
  gcloud services enable orgpolicy.googleapis.com --quiet >/dev/null 2>&1 || true

  POLICY="$(mktemp)"
  cat > "$POLICY" <<YAML
name: projects/${PROJECT}/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
  - allowAll: true
YAML

  # Scoped to this project by that name line. The organization's own policy
  # is untouched, so nothing else you own becomes reachable.
  #
  # Show whatever Google says. Guessing at the reason and hiding the real
  # message sends you fixing the wrong thing.
  ERRLOG="$(mktemp)"
  if ! gcloud org-policies set-policy "$POLICY" --quiet >/dev/null 2>"$ERRLOG"; then
    rm -f "$POLICY"
    printf '\033[31m%s\033[0m\n' "Could not change the policy. Google said:" >&2
    sed 's/^/   /' "$ERRLOG" >&2
    rm -f "$ERRLOG"
    die "
   If that mentions permission or orgpolicy.policy.set, you need
   Organization Policy Administrator at the organization — the project
   IAM page is a different resource, so switch the picker at the top of
   Console -> IAM & Admin -> IAM to thecharlestonatelier.com before
   looking for your own row.

   Anything else, send me the message above.

   Nothing here is half-done — the service is deployed and running, it
   is only unreachable."
  fi
  rm -f "$POLICY" "$ERRLOG"
  echo "Policy set for $PROJECT only."

  # Org policy changes are eventually consistent.
  echo "Waiting for it to take effect."
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 10
    if grant; then break; fi
    [ "$i" = 10 ] && die "Policy is set but the grant still fails. Wait a minute and run this again."
    printf '.'
  done
  echo
  echo "Granted."
fi

# ---------------------------------------------------------------- check
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

step "Checking it answers now"
HEALTH="$(curl -fsS "$URL/health" || true)"
GATE="$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/cards" || true)"

echo "  /health     ${HEALTH:-(no answer)}"
echo "  /api/cards  $GATE"

OK=yes
case "$HEALTH" in
  *'"reachable":true'*) echo "  store       reachable — records will persist." ;;
  *'"reachable":false'*)
    OK=no
    PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
    warn "  The service is up but cannot reach its database. Grant it access:

     gcloud projects add-iam-policy-binding $PROJECT \\
       --member=serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com \\
       --role=roles/datastore.user

   Then run this script again." ;;
  *) OK=no; warn "  Health did not answer as expected.
     Check: gcloud run services logs read $SERVICE --region $REGION --limit 50" ;;
esac
if [ "$GATE" = "401" ]; then
  echo "  gate        locked — the dashboard needs the passphrase."
else
  OK=no
  warn "  Expected 401 on /api/cards, got $GATE.
     200 would mean the dashboard is open to anyone. Tell me before going further."
fi

step "Live"
cat <<EOF

  Portal   $URL
  Studio   $URL/studio

EOF
[ "$OK" = yes ] || warn "Something above is not right yet — read the warnings before making a card."
