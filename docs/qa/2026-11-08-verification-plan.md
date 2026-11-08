# Verification plan — fixes landed 2026-11-08

## Scope

- **#11** — per-protocol start date and time: one combined chip, compact modal, first-dose lock enforced on the server, twin-pen keys.
- **#12** — archive completed vials and expired protocols: the patient `⋯` menu, the archive/restore endpoint, the filters, the Studio inline badge and Restore.
- **Security regressions** fixed in PRs #5, #6, #8, #9, #10: the Studio XSS class, feed deletion and slug tombstones, the push allowlist, the fail-closed Studio, the auth-proxy header strip, test-deploy secrets, the services catalogue, `firstAt`, and the dose-log index.

Out of scope: #17 (`patients/jessica` folder) and #18 (stable per-pen ids) are logged, not fixed.

## Environment

| Item | Value |
|---|---|
| Test service | `https://atelier-tap-test-474889355527.us-east1.run.app` |
| Revision | `atelier-tap-test-00012-z2g` |
| Studio passphrase | `mytest-passphrase-2026` |
| Collections | `cards-test`, `administrations-test`, `feeds-test`, `reminders-test`, `tombstones-test` |
| Auth | The stored-card patient page gates the first tap behind Google sign-in. The fragment card and Card Studio do not. |

## A. Automated suite

The regular suite is the unit and integration oracle. Run from `portal/`:

- `npm test` — 321 tests, under the Firebase emulators.
- `npm run test:browser` — 32 tests, file-store portal plus Chromium; the Auth emulator for the stored-card pages.

| Area | Test files | What is pinned |
|---|---|---|
| #11 server lock | `tests/unit/route.test.mjs`, `tests/unit/lock-edges.test.mjs`, `tests/unit/lock-twins.test.mjs` | 409 `pen_start_locked`/`pen_time_locked`, PUT/PATCH, force-time, no-dose negative, twins, stale body, id-on-card |
| #11 client | `tests/unit/protocol-engine.test.mjs`, `tests/browser/pen-time.test.mjs`, `tests/browser/pen-time-*.test.mjs` | combined chip, compact modal, Cancel/empty/invalid/boundaries, per-pen isolation, first-dose lock, Studio chip, twin key |
| #12 endpoint | `tests/unit/route.test.mjs`, `tests/unit/archive-routes.test.mjs` | POST/DELETE, added `+` ids, twins, well-formed-but-not-on-card 400, `archived:{}` clear vs `[]`/`null` preserve, clinician-only restore, dose history kept |
| #12 client | `tests/unit/protocol-engine.test.mjs`, `tests/browser/archive.test.mjs`, `tests/browser/archive-*.test.mjs` | `applyArchived`, `adoptArchived`, `cardSignature`, `upcomingDoses`, the spent-only menu, the rhythm/supply/feed filter, the Studio badge/restore/save |
| Security | `tests/browser/security.test.mjs`, `tests/browser/lifecycle.test.mjs`, `tests/unit/auth-proxy.test.mjs`, `tests/unit/studio-fail-closed.test.mjs`, `tests/unit/push-endpoint.test.mjs`, `tests/unit/tombstones.test.mjs`, `tests/unit/deploy-test-secrets.test.mjs`, `tests/unit/services.test.mjs`, `tests/unit/docker-services.test.mjs`, `tests/unit/logged-firstat.test.mjs` | XSS escaped at the sink, feed cascade, slug tombstone, push allowlist, fail-closed Studio, proxy cookie strip, test-only secrets, services catalogue, `firstAt` |

## B. GUI cases (deployed test service)

| ID | Case | Steps | Expected |
|---|---|---|---|
| G-01 | Health | `GET /health` | 200, revision `00012`, Firestore reachable |
| G-02 | Services | `GET /api/services` | 9 treatments |
| G-03 | Session locked | `GET /api/session`; `GET /api/cards`; POST the old default | `configured:true, signedIn:false, open:false`; 401; 401 |
| G-04 | Protocol config | `GET /protocol.json` | 200, regimen present, no phone/prescriber |
| G-05 | Studio login | Open `/studio/`, enter the passphrase | Dashboard, card list, services |
| G-06 | Per-pen edit | Open a two-pen card; click the combined chip; set a date and time; Save; Save card | Only that pen’s `startDate`/`penTimes` change |
| G-07 | First-dose lock | POST a dose for pen A; reopen; change A’s chip; Save | 409 toast with “Use Force to override”; Force save → 200 |
| G-08 | Dose log | POST a dose; POST a state report; open the card | “Logged … Last: …” in the Studio |
| G-09 | Archive badge | POST `/api/archive` for a pen; open the Studio card | Inline `Archived` badge + Restore |
| G-10 | Restore | Click Restore | `archived` clears; the badge disappears |
| G-11 | Restore + stopped | Archive and drop the same pen; Restore | “Restored from archive — she has still stopped it.” |
| G-12 | Studio XSS | POST a state marker; open the card | Marker as text; `window.__xss` undefined |
| G-13 | Fragment card | Open `/ritual.html?card=legacy`; the pages | Render, no page errors |
| G-14 | Fragment archive menu | Open the rhythm sheet on a spent pen; open `⋯` | `Archive this vial`; archive hides the pen locally |
| G-15 | Stored-card patient | Sign in with Google; chip/menu/feed | Auth gate shown; the chip/menu/feed flows are covered by `npm run test:browser`; the live click-through needs a test Google account |

## C. Execution log

**Date:** 2026-11-08 · **Service:** revision `00012-z2g`

### Automated suite

- `cd portal && npm test` → **321/321**
- `npm run test:browser` → **32/32**

### GUI results

| ID | Result | Evidence |
|---|---|---|
| G-01 | PASS | `atelier-tap-test-00012-z2g`, Firestore reachable |
| G-02 | PASS | 9 treatments |
| G-03 | PASS | `configured:true, signedIn:false, open:false`; card list 401; old default 401 |
| G-04 | PASS | protocol present; no phone/prescriber |
| G-05 | PASS | Studio login; dashboard loaded |
| G-06 | PASS | `startDate` 2026-11-06; `penTimes.glow` 21:15; `b12` untouched |
| G-07a | PASS | toast “Locked — Glow Blend's first dose is logged. Use Force to override.” |
| G-07b | PASS | Force save: start 2026-11-08, time 22:00 |
| G-08 | PASS | “1 in the last 7 days · 1 in all — Last: Glow Blend, 4 units, Sun, Nov 8” |
| G-09 | PASS | inline Archived badge |
| G-10 | PASS | `archived` empty after Restore |
| G-11 | PASS | “Restored from archive — she has still stopped it.” |
| G-12 | PASS | `window.__xss` undefined; marker rendered as text |
| G-13 | PASS | fragment card: 2 pens, 1052 chars, no page errors |
| G-14 | PASS | fragment menu `glow`/`blend2x`; Archive offered; glow removed from `PENS` |
| G-15 | PASS | auth gate shown; stored-card flows verified by the local browser suite |

**19/19 GUI checks pass.**

### Notes from the run

- The Studio dose log lives in the “seen” panel, which only exists once the card has reported state. G-08 needs that state report; with it, the log renders.
- The fragment card opens its start picker on first load. The run closes the scrim before opening the `⋯` menu.
- G-15 confirms the gate. A live stored-card click-through (Google sign-in, chip edit, archive, feed) needs a test Google account; the same flows run in the local browser suite (`npm run test:browser`, 32/32).

