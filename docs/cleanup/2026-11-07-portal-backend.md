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

The suite grew from 0 to **188 tests** (191 with the emulator test). Branch
coverage over the whole tree rose from 0% (no runner) to **72%**; the
service files from 0%.

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

The accepted-debt baseline fell from **60 entries to 33**. Fixed functions
were removed; the split handlers that still exceed 10 are recorded
individually.

The three helpers split out of `handleActivate` (`verifyActivator`,
`linkFromToken`, `activateResult`) are only reached through a verified
token, so in the *deterministic* unit run — no emulator — they sit at 0%
and are baselined. With the Auth emulator up they are covered and score
well under 10. The baseline is snapshotted at the emulator-down floor on
purpose: the CRAP gate only compares worse, so a later emulator run is
never a false regression.

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

- `handleAdded` (CC 11, 67% branch) — needs its dropped-pen path pinned
  above 70% before splitting; no emulator needed.
- `readBody`, `validSession`, `handleHealth`, `handlePushTest`,
  `sanitizeState` — low CC, partially covered; pinning only.
- The store selectors and I/O wrappers (`openStore`, `openDoses`, `openFeeds`,
  `openSubs`, `adminAuth`, `proxyAuthHelper`, `artwork`) — 4-5 CC each; their
  uncovered branches need Firestore / network / image fixtures.

## Clean-code notes

`tools/clean-code` runs the generic (heuristic) adapter for JavaScript, so
its findings are warnings. Remaining after this run:

- `duplication` — the file-store `readAll`/`writeAll` block repeats across
  `store/doses.js`, `feeds.js`, `subs.js`, `index.js`. Extract one
  `fileJson(path)` helper next.
- `function-length` / `nesting-depth` — `firestoreStore` (72 lines),
  `fileStore` (69), `proxyAuthHelper`, `runReminders`, `handleOverview`,
  `handlePushAtelier`, `sanitizeState`.
- `commented-code` at `server.js:226` is a false positive (prose, not code).

Mutation testing (Step 4) is still not run: the node adapter needs Stryker
installed. Recommended before the next refactor batch.

## Tooling

- `c8` (branch coverage) as a `portal/` devDependency; `test` script =
  `node --test tests/unit/`.
- `.standards.json` (adapter `node`, `test_command`, `include`/`exclude`,
  `mode: gate`, `new_function_max: 10`, `pin_floor: 70`).
- `.standards-crap-baseline.json` — 31 accepted entries.
- The harness CRAP engine was extended with JavaScript support during the
  first run so `tools/crap` ranks `.js` functions.
