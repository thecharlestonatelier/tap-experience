# The Charleston Atelier — tap card service.
#
# The portal's pages are copied in from patients/jessica so the container
# and the static site serve byte-identical HTML, CSS and dosing engine.
# This lives at the repository root on purpose. `gcloud run deploy --source .`
# only picks up a Dockerfile in the source root; without one it falls back to
# buildpacks, finds the static site's package.json, and builds the wrong thing.
#
#   docker build -t atelier-tap .

FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a change to the portal doesn't reinstall them.
COPY portal/package.json portal/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY portal/server.js ./server.js
COPY portal/lib ./lib
COPY portal/store ./store
COPY portal/studio ./studio

# The patient-facing portal, verbatim from the static site.
COPY patients/jessica ./public

# Card Studio is the clinician's side; it is served from /studio, not from
# the portal root, so a tapped card can never wander into it.
RUN rm -f ./public/studio.html

# Cloud Run sets PORT; 8080 is its default and what we listen on locally.
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "server.js"]
