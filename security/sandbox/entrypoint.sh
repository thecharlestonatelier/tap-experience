#!/usr/bin/env bash
# Runs inside the sandbox. Probes first; no reproduction runs unless every
# containment control passed. Writes only under /work.
#
# The container stays alive after the work so the parent can copy the
# tmpfs evidence out; the host kills it once /work/evidence/.done exists.
set -uo pipefail

MODE="${1:-all}"
mkdir -p /work/evidence

finish() {
  touch /work/evidence/.done
  sleep 900
}

node /app/audit/probes.mjs > /work/evidence/probe.json
if [ $? -ne 0 ]; then
  printf '%s\n' '{"ok":false,"reason":"control-probe-failed","evidence":"probe.json"}' \
    > /work/evidence/aborted.json
  finish
  exit 0
fi

run_repro() {
  local name="$1"
  node "/app/audit/repro/${name}.mjs" \
    > "/work/evidence/${name}.json" 2> "/work/evidence/${name}.err"
  local rc=$?
  if [ $rc -ne 0 ]; then
    printf '{"ok":false,"exit":%d,"error":"repro exited non-zero"}\n' "$rc" \
      > "/work/evidence/${name}.json"
  fi
}

FILE_REPROS=(xss-state xss-activation feed-delete slug-reuse protocol-json push-endpoint)

case "$MODE" in
  probe) ;;
  file) for r in "${FILE_REPROS[@]}"; do run_repro "$r"; done ;;
  verify-xss)
    export EXPECT=blocked
    run_repro xss-state
    run_repro xss-activation
    unset EXPECT
    ;;
  verify)
    export EXPECT=blocked
    run_repro feed-delete
    run_repro slug-reuse
    run_repro protocol-json
    run_repro push-endpoint
    cd /work && firebase emulators:exec --config /app/firebase.json --only firestore --project demo-atelier \
      "node /app/audit/repro/firestore-suite.mjs" \
      > /work/evidence/firestore-suite.log 2>&1
    unset EXPECT
    ;;
  firestore)
    cd /work && firebase emulators:exec --config /app/firebase.json --only firestore --project demo-atelier \
      "node /app/audit/repro/firestore-suite.mjs" \
      > /work/evidence/firestore-suite.log 2>&1
    ;;
  all)
    for r in "${FILE_REPROS[@]}"; do run_repro "$r"; done
    cd /work && firebase emulators:exec --config /app/firebase.json --only firestore --project demo-atelier \
      "node /app/audit/repro/firestore-suite.mjs" \
      > /work/evidence/firestore-suite.log 2>&1
    ;;
  *) echo "unknown mode: $MODE" >&2 ;;
esac

finish
