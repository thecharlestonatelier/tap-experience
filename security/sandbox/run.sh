#!/usr/bin/env bash
# Build and run the security-audit sandbox.
#
#   security/sandbox/run.sh probe      # controls only
#   security/sandbox/run.sh file       # file-store reproductions
#   security/sandbox/run.sh firestore  # emulator reproductions
#   security/sandbox/run.sh all        # everything (default)
#
# The run is: no network, read-only root, tmpfs scratch, one CPU, 1 GiB,
# 128 pids, dropped capabilities, no-new-privileges, non-root. The parent
# verifies those flags with docker inspect before trusting any result, then
# copies the tmpfs evidence out and promotes it with promote.mjs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-all}"
TIMEOUT="${SANDBOX_TIMEOUT:-900}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN="$ROOT/security/sandbox/out/$STAMP"
RAW="$RUN/raw"
OUT="$RUN/evidence"
HEAD="$(git -C "$ROOT" rev-parse HEAD)"
IMAGE="tap-audit-sandbox:${HEAD:0:12}"
CID="tap-audit-$STAMP"

mkdir -p "$RAW"

echo "==> building $IMAGE"
docker build -f "$ROOT/security/sandbox/Dockerfile" -t "$IMAGE" "$ROOT"

KEYS="$(node -e '
const c=require("node:crypto");
const {publicKey,privateKey}=c.generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const pub=publicKey.export({type:"spki",format:"der"}).subarray(-65);
process.stdout.write(pub.toString("base64url")+"\n"+privateKey.export({format:"jwk"}).d+"\n");
')"
PUB="$(printf '%s\n' "$KEYS" | sed -n '1p')"
PRIV="$(printf '%s\n' "$KEYS" | sed -n '2p')"
SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"

node -e '
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const out = {
  at: new Date().toISOString(),
  head: process.argv[1],
  image: process.argv[2],
  mode: process.argv[3],
  runtime_node: execSync("docker run --rm --entrypoint node " + process.argv[2] + " -v", { encoding: "utf8" }).trim(),
  dirty: execSync("git status --porcelain", { cwd: process.argv[4], encoding: "utf8" })
    .split("\n").filter(Boolean),
  run_flags: {
    network: "none",
    read_only: true,
    scratch: "tmpfs /work 512m,noexec,nosuid",
    cpus: 1,
    memory: "1g",
    pids: 128,
    cap_drop: "ALL",
    no_new_privileges: true,
    user: "1000:1000",
  },
};
fs.writeFileSync(process.argv[5], JSON.stringify(out, null, 2));
' "$HEAD" "$IMAGE" "$MODE" "$ROOT" "$RUN/provenance.json"

echo "==> starting $MODE"
docker run -d --name "$CID" \
  --network none --read-only \
  --tmpfs /work:rw,size=512m,noexec,nosuid,mode=1777 \
  --tmpfs /tmp:rw,size=64m,mode=1777 \
  --cpus=1 --memory=1g --memory-swap=1g --pids-limit=128 \
  --ulimit nofile=256 --ulimit fsize=5242880 \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --user 1000:1000 --shm-size=256m \
  -v "$ROOT:/repo:ro" \
  -e CARD_STORE=file \
  -e CARD_FILE=/work/cards.json \
  -e DOSE_FILE=/work/doses.json \
  -e SUB_FILE=/work/subs.json \
  -e FEED_FILE=/work/feeds.json \
  -e TOMBSTONE_FILE=/work/tombstones.json \
  -e WEB_ROOT=/app/public \
  -e STUDIO_PASSPHRASE=testpassphrase \
  -e VAPID_PUBLIC_KEY="$PUB" \
  -e VAPID_PRIVATE_KEY="$PRIV" \
  -e VAPID_SUBJECT=mailto:audit@example.com \
  -e PUSH_RUN_SECRET="$SECRET" \
  -e HOME=/work \
  -e PORT=8080 \
  "$IMAGE" "$MODE" >/dev/null

echo "==> verifying containment"
docker inspect "$CID" > "$RUN/docker-inspect.json"
if ! node "$ROOT/security/sandbox/containment.mjs" "$RUN/docker-inspect.json" "$RUN/containment.json"; then
  echo "!! containment verification failed; killing the run" >&2
  docker kill "$CID" >/dev/null 2>&1 || true
  docker rm -f "$CID" >/dev/null 2>&1 || true
  exit 1
fi

START=$SECONDS
READY=0
while [ $((SECONDS - START)) -lt "$TIMEOUT" ]; do
  if docker exec "$CID" sh -c 'test -f /work/evidence/.done' >/dev/null 2>&1; then
    READY=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null || echo false)" != "true" ]; then
    break
  fi
  sleep 2
done

if [ "$READY" != 1 ]; then
  echo "==> wall-clock limit or early exit; extracting what exists"
fi

# docker cp cannot see a tmpfs; stream the live directory instead.
if docker exec "$CID" sh -c 'test -d /work/evidence' >/dev/null 2>&1; then
  docker exec "$CID" tar -cf - -C /work/evidence . > "$RUN/evidence.tar" 2>/dev/null || true
  if [ -s "$RUN/evidence.tar" ]; then
    tar -xf "$RUN/evidence.tar" -C "$RAW"
  fi
fi
docker kill "$CID" >/dev/null 2>&1 || true
docker rm -f "$CID" >/dev/null 2>&1 || true

echo "==> promoting evidence"
mkdir -p "$OUT"
node "$ROOT/security/sandbox/promote.mjs" "$RAW" "$OUT"

echo "==> results ($OUT)"
node -e '
const fs=require("node:fs"), path=require("node:path");
const dir=process.argv[1];
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".json") && f!=="promotion.json").sort();
for (const f of files) {
  try {
    const j=JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"));
    const flag = j.ok === undefined ? "" : (j.ok ? "PASS" : "FAIL");
    console.log(flag.padEnd(4), f.padEnd(28), j.error ? "error: "+j.error : "");
  } catch { console.log("     ", f, "(unparseable)"); }
}
' "$OUT"

echo
echo "run=$RUN"
