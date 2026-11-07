# Cleanup report — portal backend (2026-11-07)

Branch `cleanup/2026-11-07-portal-backend`, starting commit `27049e6`.
Scope: the `portal/` Node service. Two runs: the router first, then the
shaping/supply/serving layer.

## Pin first

A cleanup does not rewrite. Every refactor below rests on a
characterization pin written before the code moved:

- `route.test.mjs` — runs the real server in-process against a file store
  and pins ~75 routes.
- `store.test.mjs` — pins the card shaping (`sanitize`, `sanitizePen`,
  private settings/added shaping, `publicView`, `sanitizeState`).
- `supply.test.mjs`, `doses.test.mjs`, `subs.test.mjs`, `feeds.test.mjs`,
  `services.test.mjs`, `slug.test.mjs` — the pure modules.
- `wallet.test.mjs`, `push.test.mjs` — `crc32`, `buildPassJson`,
  `buildManifest`, and `sendPush`.
- `activate.emulator.test.mjs` — the first-tap token path, against the Auth
  emulator (skipped when it is not running).

The suite grew from 0 to **203 tests** (202 pass, 1 emulator-gated skip;
206 with the emulator running). Branch coverage over the whole tree rose
from 0% (no runner) to **73%**; the service files from 0%.

## Refactored (CRAP before → after)

| Function | file | before | after |
|---|---|---|---|
| `route` | server.js | CC 181, CRAP 32,942 | CC 6, CRAP 6.1 |
| `sanitize` | store/index.js | CC 33, CRAP 33.5 | CC 7, CRAP 7.0 |
| `sanitizeSettings` | store/index.js | CC 20, CRAP 294.8 | CC 10, CRAP 10.0 |
| `supplyFor` | lib/supply.js | CC 18, CRAP 88 | CC 1, CRAP 1.0 |
| `servePortal` | server.js | CC 19, CRAP 21 | CC 8, CRAP 8.0 |
| `serveStatic` | server.js | CC 16, CRAP 18.4 | CC 9, CRAP 9.1 |
| `sanitizeDose` | store/doses.js | CC 16, CRAP 16 | CC 3, CRAP 3.0 |
| `sanitizePen` | store/index.js | CC 13, CRAP 182 | CC 9, CRAP 9.0 |
| `penLife` | lib/supply.js | CC 13, CRAP 13.4 | CC 8, CRAP 8.2 |
| `handleCardItem` | server.js | CC 12, CRAP 23.3 | CC 8, CRAP 8.0 |
| `nextDue` | lib/services.js | CC 12, CRAP 12.4 | CC 6, CRAP 6.0 |
| `handleActivate` | server.js | CC 15, CRAP 59.7 | CC 6, CRAP 7.9 |
| `handleAdded` | server.js | CC 11, CRAP 13.6 | CC 5, CRAP 5.4 |
| `handlePushTest` | server.js | CC 7, CRAP 19 | CC 4, CRAP 4.6 |
| `dueNow` | store/subs.js | CC 11, CRAP 11.3 | CC 4, CRAP 4.0 |
| `sanitizeSub` | store/subs.js | CC 10, CRAP 10.2 | CC 9, CRAP 9.0 |

Each commit is one function (or one cohesive shared helper), one behaviour
change at a time, with the pin green throughout.

## Pinned but not rewritten

Low-complexity functions whose CRAP came only from missing coverage. Pinning
dropped them without touching production code:

| Function | CRAP before → after |
|---|---|
| `publicView` | 45 → 8 |
| `crc32` | 42 → 6 |
| `handleLogged` | 41 → 9 |
| `sendPush` | 35 → 8.1 |
| `sanitizeAdded` | 32 → 7 |
| `rank` | 30 → 5 |
| `buildPassJson` | 30 → 5 |
| `handleBlanks` | 22 → 8 |

## Baseline

The accepted-debt baseline fell from **60 entries to 23**. Fixed functions
were removed; the split handlers that still exceed 10 are recorded
individually.

The remaining entries are all gated on infrastructure the deterministic
unit run does not have:

- **Auth emulator only** — `verifyActivator`, `linkFromToken`,
  `activateResult`, and the file store's `activate`.
- **Firestore / network / binary** — `openStore`/`openDoses`/`openFeeds`/
  `openSubs`, `adminAuth`, `proxyAuthHelper`, `artwork`, `zip`,
  `seed.js::card`, `wallet.configured`.
- **Borderline (CC 9-10, coverage-capped)** — `notifyAtelier`, `runReminders`,
  `handleHealth`, `sanitizeVisit`, `sanitizeSettings`.

## Duplication

The four file stores shared their `readAll`/`writeAll`; they now call
`store/file-json.js`. The duplication finding is gone, the blocking
clean-code rules (`duplication`, `error-handling`) are clean, and the file
stores are thin adapters.

## Running the activate pin

The token path is pinned by `tests/unit/activate.emulator.test.mjs`, which
auto-skips when the emulator is unreachable (so `npm test` stays
deterministic). To run it:

```sh
firebase emulators:start --only auth --project atelier-tap
cd portal && node --test tests/unit/activate.emulator.test.mjs
```

It pins: missing token 400, nonsense token 400, unknown card 404, first link
`linked`, same account `verified`, different account 409.

## What is left (follow-up)

The deterministic unit suite has reached its floor; what remains needs
infrastructure or is borderline:

- **Firestore emulator** — `store/index.js`'s transaction callback and the
  store's `activate` on Firestore, plus the `open*` selectors' cloud branch.
- **A failing-store or stubbed-fetch seam** — `handleHealth`'s 503 and
  `notifyAtelier`/`runReminders`' gone/ok branches.
- **Image / certificate fixtures** — `wallet.artwork`, `zip`,
  `wallet.configured`.
- **Borderline CC 9-10** — `sanitizeVisit`, `sanitizeSettings`,
  `notifyAtelier`; at or within a point of the threshold.
- Machine-generated `scripts/seed.js::card` (a seed fixture, not service
  code).

## Clean-code notes

`tools/clean-code` runs the generic (heuristic) adapter for JavaScript, so
every finding is a warning; the blocking rules (`duplication`,
`error-handling`) are **clean**. What remains is heuristic:

- `nesting-depth` on thin adapters (`fileStore`, `firestoreStore`,
  `fileJson`, the `fire*` wrappers) — the brace-guesser miscounts these.
- `function-length` on `wallet.zip` (a cohesive binary format) and
  `firestoreStore` / `fileStore` (thin record adapters).
- `commented-code` at `server.js:226` is a false positive (prose, not code).
- `naming` at `push.js:170` — a one-letter loop index in a two-line loop,
  which the standard allows.

Mutation testing (Step 4) is still not run: the node adapter needs Stryker
installed. Recommended before the next refactor batch.

## Tooling

- `c8` (branch coverage) as a `portal/` devDependency; `test` script =
  `node --test tests/unit/`.
- `.standards.json` (adapter `node`, `test_command`, `include`/`exclude`,
  `mode: gate`, `new_function_max: 10`, `pin_floor: 70`).
- `.standards-crap-baseline.json` — 23 accepted entries.
- The harness CRAP engine was extended with JavaScript support during the
  first run so `tools/crap` ranks `.js` functions.
