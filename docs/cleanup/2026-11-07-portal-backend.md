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

The suite grew from 0 to **227 tests** (all pass). The Auth and Firestore
pins run under `firebase emulators:exec`, which starts the emulators, runs
the suite and tears them down — the harness owns their lifecycle, so a human
never starts one by hand. Branch coverage over the whole tree rose from 0%
(no runner) to **76%**; the service files from 0%.

## Mutation audit (Step 4)

Stryker was added and run over two files to prove the pins detect a change
in meaning:

| File | score | result |
|---|---|---|
| `lib/slug.js` | **97.6%** | 41 killed, 1 equivalent survivor waived |
| `lib/supply.js` | **86.0%** | 166 killed, 27 survived |

The slug audit found the length guard in `isValidSlug` was redundant with
the anchored `SHAPE` regex (proved by equivalent mutants), so it was
removed and the 2/40 boundaries pinned. The supply audit found the "order
one" (`low`) bucket was untested; it is now pinned. The remaining supply
survivors are concentrated in the unexported `perMlOf`, `resolveDoses` and
`templates` helpers, reached only through the real template catalogue —
closing them needs synthetic-template fixtures or an exported seam, and is
the next mutation follow-up. The one slug survivor (`randomSuffix`'s
`||` fallback) is waived in `.standards-mutation-waivers`: `globalThis.crypto`
exists on every supported Node, so the mutant is equivalent.

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

The accepted-debt baseline fell from **60 entries to 10**. Fixed functions
were removed; the split handlers that still exceed 10 are recorded
individually.

Because the test command runs under `firebase emulators:exec`, the Auth and
Firestore paths are covered in the same run: the four store selectors, the
four Firestore backings and the activate transaction all fell under 10 and
left the baseline. A later pass then pinned `zip`, `configured`, the
overview map and `linkFromToken`'s no-name token. The remaining 10 need
other fixtures: image files (`wallet.artwork`), the network auth proxy
(`proxyAuthHelper` and its two callbacks), a failing store or stubbed fetch
(`handleHealth` 503, `notifyAtelier`/`runReminders` gone/ok), an export for
`scripts/seed.js::card`, and two borderline CC-10 functions (`sanitizeVisit`,
`sanitizeSettings`).

## Duplication

The four file stores shared their `readAll`/`writeAll`; they now call
`store/file-json.js`. The duplication finding is gone, the blocking
clean-code rules (`duplication`, `error-handling`) are clean, and the file
stores are thin adapters.

## Running the emulator pins

The Auth and Firestore pins are part of the normal suite. The harness and
`npm test` run:

```sh
firebase emulators:exec --only auth,firestore --project atelier-tap \
  --config ../firebase.json "node --test tests/unit/"
```

`emulators:exec` starts both emulators, runs the suite, and shuts them down
whether it passes or fails — so no one starts one by hand. Running
`node --test tests/unit/` directly still works: those suites read their
emulator host env and skip cleanly when it is absent.

## What is left (follow-up)

The unit suite now covers the Auth and Firestore branches, so what remains
needs other fixtures:

- **Image fixtures** — `wallet.artwork` (and the `buildPass` path) read
  icon/logo PNGs.
- **Network / failure seams** — `proxyAuthHelper` and its callbacks,
  `handleHealth`'s 503, `notifyAtelier`/`runReminders` gone/ok.
- **An export** — `scripts/seed.js::card` is private in a script that runs
  on import.
- **Borderline CC 9-10** — `sanitizeVisit`, `sanitizeSettings`; shape, not
  coverage.

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

Mutation testing is wired (see the audit above). The next mutation pass is
the unexported `supply.js` helpers; after that, run the same audit over the
store shaping and the router handlers.

## Tooling

- `c8` (branch coverage) as a `portal/` devDependency; `test` script runs
  the suite under `firebase emulators:exec` so the emulators start and stop
  with the tests.
- `.standards.json` (adapter `node`, `test_command`, `include`/`exclude`,
  `mode: gate`, `new_function_max: 10`, `pin_floor: 70`).
- `.standards-crap-baseline.json` — 10 accepted entries.
- `@stryker-mutator/core` (mutation) as a `portal/` devDependency;
  `mutation.test_command` in `.standards.json`; evidence-free equivalent
  mutants in `.standards-mutation-waivers`.
- The harness CRAP engine was extended with JavaScript support during the
  first run so `tools/crap` ranks `.js` functions.
