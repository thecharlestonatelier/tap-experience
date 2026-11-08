# Security-audit sandbox for tap-experience.
#
# Build (trusted, network allowed):
#   docker build -f security/sandbox/Dockerfile -t tap-audit-sandbox .
#
# Run (untrusted, no network, read-only, resource-capped):
#   security/sandbox/run.sh all
#
# The base is pinned by digest so a rebuild cannot silently change Chromium,
# Node, or the browser dependencies. Java + the Firestore emulator are baked
# in at build time so the run never needs to download anything.

FROM mcr.microsoft.com/playwright:v1.65.0-jammy@sha256:5a8620d70618963ec6628dd77cc25ec6a4b232e26c4a41241a8c1def04e2dc04

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    FIREBASE_EMULATORS_PATH=/opt/firebase/emulators \
    NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# Pin the CLI; the emulator jar is downloaded once here, not at run time.
RUN npm install -g firebase-tools@13.29.1 --no-audit --no-fund \
 && mkdir -p /opt/firebase/emulators \
 && firebase setup:emulators:firestore

WORKDIR /app

# Production dependency set plus the browser test package. The browser
# binaries themselves come from the base image.
COPY portal/package.json portal/package-lock.json* /app/
RUN if [ -f package-lock.json ]; then npm ci --include=dev --no-audit --no-fund; \
    else npm install --include=dev --no-audit --no-fund; fi

COPY portal/server.js /app/server.js
COPY portal/services.json /app/services.json
COPY portal/lib /app/lib
COPY portal/store /app/store
COPY portal/studio /app/studio

# The container layout the production Dockerfile creates, including the
# legacy protocol.json that the static handler serves.
COPY patients/jessica /app/public

# The emulator config (ports and UI off); the Firestore suite runs against it.
COPY firebase.json /app/firebase.json

# Audit harness (probes + reproductions). Read-only at run time. It sits
# under /app so `import 'playwright'` resolves against /app/node_modules.
COPY security/sandbox /app/audit

USER pwuser
WORKDIR /app/audit

ENTRYPOINT ["/bin/bash", "/app/audit/entrypoint.sh"]
