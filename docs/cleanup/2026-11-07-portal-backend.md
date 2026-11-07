# Cleanup report — portal backend, `route` (2026-11-07)

Branch `cleanup/2026-11-07-portal-backend`, starting commit `27049e6`.
Scope: the `portal/` Node service. This run fixed one function — the
monolithic request router.

## What was pinned first

A cleanup does not rewrite. Before touching the router it was pinned at the
HTTP boundary: a `node:test` suite (`portal/tests/unit/route.test.mjs`) runs
the real server in-process against a file store and pins every deterministic
route's response — 70 tests covering health, the public card routes, the
dashboard/session side, wallet, push, and the static portal. Six more suites
pin the pure modules (`slug`, `services`, `supply`, `doses`, `subs`, `feeds`).

Coverage was lifted by these pins:

| File | before (unit) | after |
|---|---|---|
| `portal/server.js` | 0% line / 0% branch | 88% line / 70% branch |
| `portal/lib/slug.js` | 0% | 100% line / 90% branch |
| `portal/lib/services.js` | 0% | 82% / 86% |
| `portal/store/doses.js` | 0% | 55% / 96% |
| `portal/store/subs.js` | 0% | 60% / 83% |
| `portal/store/feeds.js` | 0% | 51% / 89% |
| `portal/lib/supply.js` | 0% | 49% / 67% |

## The fix

`async function route(req, res)` was one function chaining ~181 `if`
branches across every endpoint — CC 181, CRAP 32,942, 0% coverage. It was
split into ~35 named handlers (one per route) matched through an ordered
table; the dispatcher and the static/card-address fallback are now separate.

| Function | before | after |
|---|---|---|
| `route` | CC 181, CRAP 32,942, 0% | CC 6, CRAP 6.1, 88% branch |

The 70-route pin passed unchanged through the refactor (all 116 unit tests
green), so behaviour is preserved. The debt baseline shrank from 60 to 55
entries and `route`'s entry was removed.

## What was left (follow-up)

The split isolated the remaining complexity into named handlers, several of
which are still above CRAP 10 and are now individually testable:

- `servePortal` — CC 19 (static + card-address fallback)
- `handleActivate` — CC 15 (Firebase token verification)
- `handleCardItem` — CC 12 (card CRUD + unlink dispatch)
- `handleAdded` — CC 11
- `handleLogged` — CC 8, 20% branch (needs a pinned dose-log walk)
- plus the untouched 45 baselined functions elsewhere: `store::sanitize`
  (CC 33), `store::sanitizeSettings` (CC 20), `lib/supply.js::supplyFor`
  (CC 18), `server.js::serveStatic` (CC 16), and others.

**Not covered by the unit pin** (still the 47 manual HTTP/browser suites):
Firebase `verifyIdToken`, the auth-helper proxy, and Apple Wallet `buildPass`
— they need the emulator / network / certificates.

**Mutation testing** (Step 4) was not run: the harness's node adapter needs
Stryker installed. Recommended as a follow-up audit before refactoring the
remaining handlers, to prove the pin detects a change in meaning.

## Tooling added

- `c8` (branch coverage) as a `portal/` devDependency; `test` script =
  `node --test tests/unit/`.
- `.standards.json` (adapter `node`, `test_command`, `include`/`exclude`,
  `mode: gate`, `new_function_max: 10`, `pin_floor: 70`).
- `.standards-crap-baseline.json` — the accepted debt snapshot (55 entries).

Note: the harness CRAP engine originally had no JavaScript support; it was
extended during this run so `tools/crap` ranks `.js` functions.
