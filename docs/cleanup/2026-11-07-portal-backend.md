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

The suite grew from 0 to **261 tests** (all pass). The Auth and Firestore
pins run under `firebase emulators:exec`, which starts the emulators, runs
the suite and tears them down — the harness owns their lifecycle, so a human
never starts one by hand. Branch coverage over the whole tree rose from 0%
(no runner) to **77%**; the service files from 0%.

## Mutation audit (Step 4)

Stryker was added to prove the pins detect a change in meaning. Early runs:

| File | score | result |
|---|---|---|
| `lib/slug.js` | **97.6%** | 41 killed, 1 equivalent survivor waived |
| `lib/supply.js` | **86.0%** | 166 killed, 27 survived |

A broader audit over `slug`, `services`, `doses` and `subs` scored **67.4%**
(238 killed, 115 survived). Analysing the survivors showed two classes:

- **Offline artefact** — the store selectors and the file/firestore methods
  (`openDoses`, `openSubs`, `put`, `forSlug`, `markSent`…) score low because
  the audit ran without live emulators, so those branches skip. They are
  covered in the normal emulator run.
- **Real assertion gaps** — ordering (`rank`), date edges (`dueResult`,
  `doseDay`) and the due-list (`latestDue`, `cleanDue`).

Strengthening the ordering/date/due-list pins lifted it to **83.0%** (293
killed, 60 survived, 1 waived). Per file: `slug.js` 97.6%, `subs.js` 81.9%,
`services.js` 79.0%, `doses.js` 76.1%. The survivors are now dominated by the
Firestore adapters (`openDoses`/`openSubs` selectors, `put`, `forSlug`,
`firestoreSubs`) and the `servicesFor` sort comparator (`rank`, 14 — mostly
equivalent orderings). Scoring the Firestore paths needs live emulators, and
an emulator-live mutation run crashed Stryker's worker pool, so that is the
open follow-up. A small `.stryker-tmp/` sandbox is now gitignored.

The slug audit also found the length guard in `isValidSlug` was redundant
with the anchored `SHAPE` regex, so it was removed and the 2/40 boundaries
pinned. The one slug survivor (`randomSuffix`'s `||` fallback) is waived in
`.standards-mutation-waivers`: `globalThis.crypto` exists on every supported
Node, so the mutant is equivalent.

## Behaviour equivalence (empirical)

Before any clean-architecture work, equivalence was checked against the
starting commit `27049e6`:

- Materialized the original tree (`git archive 27049e6`), dropped this
  branch's `tests/unit` into it and ran it: **233 / 235 pass**. The only two
  failures are the `seed.card` tests — the original `seed.js` had no export
  (`seed.card is not a function`); adding one is testability, not behaviour.
- The same suite passes **235 / 235** on this branch.
- Differential fuzz — the same inputs through the original and current
  modules, comparing outputs:
  - pure modules (`isValidSlug`, `normalizeSlug`, `baseSlug`, `penLife`,
    `addDaysIso`): **17,000 comparisons, 0 mismatches**.
  - store shaping (`sanitize`, `sanitizePen`, `publicView`, `sanitizeState`):
    **12,000 comparisons, 0 mismatches**.

This bounds equivalence to the suite's coverage (77% branch) and the fuzz
input space. The five baseline functions (the auth proxy, `handleHealth`,
`wallet.artwork`) are untested in both versions and are therefore not
proven equivalent.

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

The accepted-debt baseline fell from **60 entries to 5**. Fixed functions
were removed; the last few that still exceed 10 are recorded individually.

Because the test command runs under `firebase emulators:exec`, the Auth and
Firestore paths are covered in the same run. Later passes pinned `zip`,
`configured`, the overview map, the no-name link, `sanitizeVisit`,
`sanitizeSettings`, the seed builder, and the push delivery loops
(`runReminders`, `notifyAtelier`) against a stubbed push service. The
remaining 5 are the network auth proxy (`proxyAuthHelper` and its two
callbacks), a failing store (`handleHealth`), and image files
(`wallet.artwork`).

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

The unit suite now covers the Auth, Firestore and push-delivery branches, so
what remains needs one of two things:

- **Network HTTPS stub** — `proxyAuthHelper` and its two callbacks proxy to
  the Firebase auth domain; the host is hardcoded.
- **Failing store** — `handleHealth`'s 503 needs `store.ping()` to reject.
- **Image files** — `wallet.artwork` (and the `buildPass` path) read
  icon/logo PNGs.

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
- `.standards-crap-baseline.json` — 5 accepted entries.
- `@stryker-mutator/core` (mutation) as a `portal/` devDependency;
  `mutation.test_command` in `.standards.json`; evidence-free equivalent
  mutants in `.standards-mutation-waivers`.
- The harness CRAP engine was extended with JavaScript support during the
  first run so `tools/crap` ranks `.js` functions.
