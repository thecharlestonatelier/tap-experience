# Protocol Start Date and Time Customization — Implementation Plan

**Spec files:** `specs/2026-10-27-003-start-time-customization.md` (SPEC-003),
`specs/000-system.md` (§3.3, §3.4, §3.5, §4.3 are the baseline rules this touches)
**Plan:** `plans/2026-10-27-003-start-time-customization.md`

## Context

- **What the spec requires.** Add a per-pen dosing time-of-day (`HH:MM`),
  separate from the `YYYY-MM-DD` start date. Each pen's dose card renders two
  pill chips — date and time — between the pen name and the remove button. A tap
  turns a chip into a native input; the value saves on blur. Both values lock at
  the pen's first logged dose (greyed chips, a lock glyph, and the message
  "Locked — your first logged dose."). The atelier can still override through
  `settings.penTimes`, above the lock. The time drives the due instants, the
  reminders, and the calendar, but never `dayIndex`, `supply`, `occurrences`,
  `dosesLeft`, or the streak. The `#btnStart` button is removed; the `?change=1`
  schedule sheet keeps working. Dose logging stays day-granular (`doseId` is still
  `slug.template.day`); the lock keys on `firstDoseDay(pen)`, never a timestamp.
  ICS keeps writing real UTC instants with the `Z` suffix (no floating times, no
  `TZID`/`VTIMEZONE`). The new field travels only through `settings`
  (atelier → patient, via `publicView`) and `stateReport()` (patient → atelier);
  `/api/overview` stays free of times and settings.
- **Graph status.** `NO_GRAPH` — no `graphify-out/graph.json` exists in the repo.
  Integration points were located by direct file reads of
  `patients/jessica/assets/protocol.js`, `patients/jessica/ritual.html`,
  `portal/store/index.js`, `portal/store/doses.js`, `portal/store/subs.js`, and
  `portal/server.js`.
- **Key constraints and patterns.** No build step (plain ES modules + classic
  scripts; native `<input type="date|time">`). The precedence chain mirrors the
  existing `applyPenStarts()` date chain: atelier → patient → first-dose
  observation → default. `timeFor(pen)` is the single choke point every consumer
  already reads (`upcomingDoses`, `buildICS`, `icsSignature`, `scheduledInstant`,
  the dose card) — folding the per-pen chain into it makes Phases 1–2 small.
  Sanitization everywhere uses the existing `/^\d{2}:\d{2}$/` pattern.
- **Design decisions pinned here** (see Risks for the one that stays open):
  - **Patient per-pen time** lives device-only in `tca.pentime.<patientId>`,
    via `loadPenTimes()` / `savePenTimes()` / `setPenTime(pen, hhmm)` — mirroring
    `penStartsKey`/`loadPenStarts`/`setPenStart` (`protocol.js:563–632`).
  - **Atelier per-pen time** lives on the record as `settings.penTimes`
    (`{ "tirz": "19:30" }`), sanitized in `sanitizeSettings()`, applied in
    `applySettings()` into a *separate* device map
    `tca.pentime.atelier.<patientId>` (`loadAtelierPenTimes()`), so the atelier
    value stays above the patient's own edit and above the lock (FR-4 step 1 vs
    step 2; FR-16). Rev-gating matches the existing `settings.times` behavior.
  - **First-dose time** comes from the earliest `at` per pen. `/api/logged`
    gains a `firstAt` map (pen-key → earliest `at` ISO) alongside the existing
    `days`; `firstDoseTime(pen)` renders that instant as the patient's local
    `HH:MM`. This closes spec open question 2 / R4.
  - **`timeFor(pen)` resolution order:** `loadAtelierPenTimes()[pen.id]` →
    `loadPenTimes()[pen.id]` → `firstDoseTime(pen)` → band default
    (`loadTimes()[pen.time] || TIME_AT[pen.time] || '09:00'`). The band default
    is inlined (not a recursive `timeFor` call).
  - **`stateReport()`:** the `today` rows' existing `at` field becomes the
    effective per-pen time (`timeFor(pen)`); `sanitizeState()` already accepts
    `HH:MM` there. `supply` rows stay day-only (`startDate`/`dosesLeft`/
    `lastDose`) — the dashboard's supply view renders no time and `/api/overview`
    must stay time-free.
  - **Chips** use new classes `.dose-chip` / `.date-chip` / `.time-chip` (the
    existing `.chip` is the colored pen-short square and must not change). Lock
    signal is `firstDoseDay(pen)`; a locked chip stays tappable so the message
    can fire, but never editable.

## Phases

### Phase 1 — Per-pen time field + sanitization + the `timeFor` resolution chain (server + engine, no UI)

**Goal:** A per-pen `HH:MM` value exists on both sides of the wire and
`timeFor(pen)` resolves it atelier → patient → first-dose → band default, with
every consumer untouched and no UI change.

**Tasks:**
- [ ] `patients/jessica/assets/protocol.js` — add the patient store next to the
      pen-start block: `penTimesKey()` (`tca.pentime.${CFG.patient.id}`),
      `loadPenTimes()`, `savePenTimes(map)`, `setPenTime(pen, hhmm)` (sanitize
      with `/^\d{2}:\d{2}$/`, write, `_supplyCache.clear()` is NOT needed — time
      never touches supply — but do call `scheduleChanged()`), and
      `atelierPenTimesKey()` (`tca.pentime.atelier.${CFG.patient.id}`) +
      `loadAtelierPenTimes()` + `saveAtelierPenTimes(map)`.
- [ ] `patients/jessica/assets/protocol.js` — extend `applySettings(settings)` to
      merge validated `settings.penTimes` entries into the atelier map, exactly
      as it merges `settings.times` into `loadTimes()` today (only values matching
      `/^\d{2}:\d{2}$/`, keyed by pen id, capped the same way `times` is capped).
- [ ] `patients/jessica/assets/protocol.js` — add `firstDoseTime(pen)`: read
      `LOGGED_FIRST_AT[penKeyOf(pen)]`, `new Date(at)`, return local
      `HH:MM`, or `null`.
- [ ] `patients/jessica/assets/protocol.js` — rewrite `timeFor(pen)` to fold the
      four-step chain (atelier map → patient map → `firstDoseTime` → band default).
      Add a module-level `LOGGED_FIRST_AT = {}` next to `LOGGED`; in
      `loadLogged()`, capture `payload.firstAt` (`LOGGED_FIRST_AT = payload.firstAt
      || {}`) and keep `applyPenStarts()` as-is.
- [ ] `portal/store/index.js` — in `sanitizeSettings()`, add `penTimes` (object,
      values only where `/^\d{2}:\d{2}$/`, keys sliced like `times`, capped);
      include `penTimes` in the `same` comparison so a change bumps `rev`, and
      `force` still raises `rev`. Do NOT export a new endpoint; `publicView`
      already returns `settings`.
- [ ] `portal/server.js` — extend the `/api/logged` route: alongside `days`, build
      `firstAt` by tracking the earliest `d.at` per `d.template` (values already
      validated as `YYYY-MM-DDTHH:…` by `sanitizeDose`); return
      `{ days, firstAt }`. Response stays day-and-instant only — no lot, no dose.
- [ ] `portal/tests/README.md` — document the new `firstAt` field and the
      per-pen-time storage keys.

**Acceptance criteria:**
- `sanitizeSettings()` keeps only `HH:MM` values in `settings.penTimes` and
  discards garbage (AC-12).
- `sanitizeState()` still accepts `HH:MM` `at` in `today` rows (unchanged;
  AC-12).
- `timeFor(pen)` returns, in order: atelier pen time, patient pen time, the
  first logged dose's local clock time, then the band default (FR-4, AC-9).
- The time never enters `dayIndex`, `supply`, `occurrences`, `dosesLeft`, or the
  streak — a before/after check shows identical day math (FR-3, AC-14).

**Tests:**
```bash
# terminal 1 — Auth emulator (browser suites below sign in against it)
firebase emulators:start --only auth

# terminal 2 — service for the settings (Node) suite
cd portal
SEED_FILE=.data-test/pen-time-cards.json npm run seed
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/pen-time-cards.json \
  STUDIO_PASSPHRASE=testpassphrase PORT=8091 node server.js &

# mint a Studio session for the Node suite
TOK=$(curl -s -X POST http://localhost:8091/api/session \
  -H "Content-Type: application/json" -d '{"passphrase":"testpassphrase"}' -i \
  | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: ca_studio=//' | cut -d';' -f1)
echo "$TOK" > /tmp/tok.txt

# terminal 3 — run
source /tmp/qa-env.sh && BASE=http://localhost:8091 node tests/pen-time-settings.mjs
```
- **New: `portal/tests/pen-time-settings.mjs`** (Node, HTTP + store read, in the
  style of `overview.mjs` / `public-view-shape.mjs`). Arrange: POST `/api/cards`
  with `settings: { startDate, times, penTimes }` where `penTimes` mixes good
  (`"ghk":"19:30"`) and bad (`"bpc":"25:99"`, `"nad":"7:30"`, `"x":"nope"`)
  values. Act: read the record back via `/api/cards`. Assert: only
  `"19:30"` survives in `settings.penTimes`; `publicView` (GET `/api/card/<slug>`)
  returns `settings` including `penTimes` but no `state`/`activatedBy`; a
  `force`-less re-POST with unchanged settings does not bump `rev`, a `force`
  POST does; POST `/api/state/<slug>` with a `today` row `at:"24:00"` drops it
  while `at:"19:30"` survives (sanitizeState).
- **New: `portal/tests/pen-time-resolve.mjs`** (Playwright, stored card). Arrange:
  mint a named two-pen card (`ghk` Evening, `nad` Morning) with
  `settings.penTimes` blank; `signInGoogle`; open `ritual.html?c=<slug>`.
  Assert the four-step chain by driving each source in turn: (1) default — both
  pens report `timeFor(pen)` equal to `TIME_AT[pen.time]` (AC-9); (2) write a
  patient pen time via `setPenTime(pen,'19:45')` and assert `timeFor` follows;
  (3) POST `/api/dose` for `ghk` with an `at` at a known clock hour and assert
  the *other* pen (no patient/atelier time) picks up `firstDoseTime`; (4) seed a
  card with `settings.penTimes` and assert the atelier value wins over both a
  patient value and the first-dose time. Also assert day math is untouched: the
  values of `dayIndex`, `dosesLeft`, `occurrences().length`, and `supply().lastDose`
  are identical before and after every time change (AC-14).
- **Existing suites that must stay green** (the chain and `/api/logged` change
  touch their code paths): `first-dose-start.mjs`, `pen-starts.mjs`,
  `no-reprompt.mjs`, `tirz-vial.mjs`.

**Touch points:**
- `patients/jessica/assets/protocol.js` (`timeFor`, `loadLogged`, `applySettings`),
  `portal/store/index.js` (`sanitizeSettings`), `portal/server.js` (`/api/logged`),
  `portal/tests/pen-time-settings.mjs` (new), `portal/tests/pen-time-resolve.mjs`
  (new), `portal/tests/README.md`.

**Risks:** the `/api/logged` shape change is additive (`firstAt`) — an old client
ignores it, so no deployment ordering hazard; but any consumer that parses the
response strictly must now tolerate the extra key (verified by the green suites).

---

### Phase 2 — Engine consumers: `upcomingDoses`, `buildICS`, `scheduledInstant`, `stateReport`

**Goal:** Every instant the engine emits — reminder due list, calendar events,
back-fill timestamp, and the reported state — reflects the resolved per-pen time,
and the calendar still writes only UTC `Z` instants with no floating times.

**Tasks:**
- [ ] Confirm (no code change) that `upcomingDoses()`, `buildICS()`,
      `icsSignature()`, and `scheduledInstant()` already read `timeFor(pen)` and
      therefore follow the Phase 1 chain automatically. Add a clarifying comment
      at each call site that the value is now the resolved per-pen time.
- [ ] `patients/jessica/assets/protocol.js` — in `stateReport()`, change the
      `today` row `at:` from `effectiveTimes()[pen.time] || ''` to `timeFor(pen)`.
      Leave `times: effectiveTimes()` (band times) untouched, and leave `supply`
      rows day-only.
- [ ] `patients/jessica/ritual.html` — no functional change; verify
      `scheduledInstant(pen, d)` (line ~1715) still uses `timeFor(pen)` for the
      back-fill `at`. (It already does; this is a verify-and-annotate step.)
- [ ] `patients/jessica/assets/protocol.js` — in `icsSignature()`, no code change
      (it already uses `timeFor(pen)`); confirm the signature changes when only
      the time changes, so the stale-calendar notice fires.

**Acceptance criteria:**
- `upcomingDoses()` instants are built from the patient's local clock time at the
  resolved per-pen time (FR-6, FR-7).
- `buildICS()` events carry the per-pen time as a UTC instant with the `Z`
  suffix; the file contains no `TZID`, no `VTIMEZONE`, and no un-suffixed
  `DTSTART` time (FR-8, AC-11).
- `scheduledInstant()` returns the per-pen time for a back-filled dose (FR-6).
- `stateReport()` reports the effective per-pen time in the `today` rows (FR-20).

**Tests:**
```bash
# terminal 1 — Auth emulator
firebase emulators:start --only auth

# terminal 2 — service
cd portal
SEED_FILE=.data-test/pen-time-instants-cards.json npm run seed
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/pen-time-instants-cards.json \
  STUDIO_PASSPHRASE=testpassphrase PORT=8093 node server.js &
echo "$(curl -s -X POST http://localhost:8093/api/session -H 'Content-Type: application/json' \
  -d '{"passphrase":"testpassphrase"}' -i | grep -i '^set-cookie' \
  | sed 's/^[Ss]et-[Cc]ookie: ca_studio=//' | cut -d';' -f1)" > /tmp/tok.txt

# terminal 3 — run
source /tmp/qa-env.sh && BASE=http://localhost:8093 node tests/pen-time-instants.mjs
```
- **New: `portal/tests/pen-time-instants.mjs`** (Playwright, stored card). Arrange:
  named card with one `ghk` pen and a known start day; `signInGoogle`; open the
  card; set a patient pen time (`setPenTime(pen,'21:15')`). Act/Assert: (1)
  `upcomingDoses()` returns instants whose local hour/minute equals 21:15 on each
  dosing day and are sorted + future (mirrors the `push-ui.mjs` shape checks);
  (2) `buildICS().text` contains a `DTSTART:…T…Z` line whose UTC value equals
  `new Date(localDay at 21:15).toISOString()`, and the whole text has no
  `TZID`, no `VTIMEZONE`, and no `DTSTART:…T[0-9]{6}\r?\n` without a `Z`;
  (3) `scheduledInstant(pen, backfillDay)` returns the 21:15 instant; (4)
  `reportState(true)` then read the dashboard `/api/cards` — the `today` row for
  `ghk` reports `at:"21:15"`, and the `supply` row carries no time field.
- **Existing suites that must stay green:** `push-ui.mjs` (the posted schedule
  matches the card's own computation), `logging.mjs` (back-fill `at` path),
  `tirz-vial.mjs` (supply/phase math unchanged).

**Touch points:**
- `patients/jessica/assets/protocol.js` (`stateReport`, `upcomingDoses`,
  `buildICS`, `icsSignature`), `patients/jessica/ritual.html`
  (`scheduledInstant`, verify only), `portal/tests/pen-time-instants.mjs` (new).

**Risks:** a consumer outside the listed set that read `effectiveTimes()` for a
pen time would now diverge — the code search in this phase (grep
`effectiveTimes` and `timeFor`) must come back with no stragglers.

---

### Phase 3 — Dose-card chips, inline editing, lock states, and `#btnStart` removal

**Goal:** Each due pen's card shows date + time chips with blur-to-save native
inputs, locks them at first dose, and the `#btnStart` button disappears while the
`?change=1` sheet still opens.

**Tasks:**
- [ ] `patients/jessica/ritual.html` — add CSS for `.dose-chip` (pill),
      `.dose-chip.locked` (greyed), a `.dose-chip .lock` glyph, and the inline
      `.dose-chip input[type=date|time]` treatment. Keep the existing `.chip`
      (colored pen-short square) untouched.
- [ ] `patients/jessica/ritual.html` — in `renderToday()` (the `dose-top` block,
      lines ~1220–1232), insert a one-row chip group between the pen name block
      and the `.pen-x` remove button: date chip (`fmtShort(penStart(pen))`) then
      time chip (`prettyTime(timeFor(pen))`). Drop the now-redundant
      `${pen.time} · ${prettyTime(timeFor(pen))}` meta line (keep the `route`
      line). Order: name, date chip, time chip, remove button (FR-9, FR-10).
- [ ] `patients/jessica/ritual.html` — add `wireChips(stack)` (call at the end of
      `renderToday`, alongside `wireDrops`): tap a date chip swaps it for a native
      `<input type="date">` pre-filled with `penStartIso(pen)`; tap a time chip
      swaps for `<input type="time">` pre-filled with `timeFor(pen)`. On `blur`
      (and `change`, for the iOS picker case) call `setPenStart(pen, value)` /
      `setPenTime(pen, value)`, then `renderAll()` — no save button (FR-11, FR-12).
- [ ] `patients/jessica/ritual.html` — lock behavior: render both chips locked
      (greyed, `.lock` glyph, `aria-disabled`) when `firstDoseDay(pen)` exists.
      A tap on a locked chip fires `showToast('Locked — your first logged dose.')`
      and does not open an input (FR-13, FR-14, FR-15). An atelier-pinned value
      without a first dose (`pen.atelierStart` / `pen.atelierTime`) mirrors the
      sheet: show the value but mark it non-editable with a "set by the atelier"
      hint (see Risks).
- [ ] `patients/jessica/ritual.html` — remove `#btnStart` (the `<button>` at
      line ~599), its wiring in `renderAll()` (lines ~852–861), and its
      `addEventListener('click', openStartPicker)` (line ~1911). Update the rest
      copy that pointed at it ("change your start day above", line ~1175) to
      reference the chips or the schedule sheet (FR-17). Keep `openStartPicker()`,
      `commitStart()`, and the `?change=1` boot branch (lines ~1871–1874) intact
      (FR-18).
- [ ] `patients/jessica/ritual.html` — in the schedule sheet copy
      (`openStartPicker`), add one line noting that a chip's per-pen time
      overrides the band time (R3 mitigation).

**Acceptance criteria:**
- A due pen's card shows a date chip and a time chip between the name and the
  remove button (AC-1).
- Tapping the date chip shows a native date input with the pen's current start
  date; tapping the time chip shows a native time input with the effective time
  (AC-2, AC-3).
- Leaving either field saves the change and the card, calendar, and reminder
  list follow (AC-4).
- Editing one pen does not change another pen's date or time (AC-5).
- After the first logged dose, both chips grey out and show a lock; tapping one
  shows "Locked — your first logged dose." (AC-6).
- A time set before the first dose stays in effect after the lock (AC-8).
- `#btnStart` is gone; the `?change=1` link still opens the sheet (AC-10).

**Tests:**
```bash
# terminal 1 — Auth emulator
firebase emulators:start --only auth

# terminal 2 — service
cd portal
SEED_FILE=.data-test/pen-time-chips-cards.json npm run seed
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/pen-time-chips-cards.json \
  DOSE_FILE=.data-test/pen-time-chips-doses.json \
  STUDIO_PASSPHRASE=testpassphrase PORT=8094 node server.js &
echo "$(curl -s -X POST http://localhost:8094/api/session -H 'Content-Type: application/json' \
  -d '{"passphrase":"testpassphrase"}' -i | grep -i '^set-cookie' \
  | sed 's/^[Ss]et-[Cc]ookie: ca_studio=//' | cut -d';' -f1)" > /tmp/tok.txt

# terminal 3 — run
source /tmp/qa-env.sh && BASE=http://localhost:8094 node tests/pen-time-chips.mjs
```
- **New: `portal/tests/pen-time-chips.mjs`** (Playwright, stored card, Arrange/
  Act/Assert). Arrange: a named two-pen card (`ghk`, `nad`) with a start day in
  `settings`, opened via `signInGoogle`. Assert: (1) each due card renders
  `.date-chip` and `.time-chip` between `.dose-name` and `.pen-x` (AC-1); (2)
  clicking the date chip yields `input[type=date]` with the pen's start date, and
  the time chip yields `input[type=time]` with the effective time (AC-2, AC-3);
  (3) change one pen's date and time and blur — `penStartIso` / `timeFor` update
  for that pen only, the other pen unchanged (AC-4, AC-5); (4) POST `/api/dose`
  for `ghk`, re-render via `loadLogged(); renderAll()`, and assert both of `ghk`'s
  chips carry `.locked` and a tap fires the "Locked — your first logged dose."
  toast, and a pre-lock time is still in effect (AC-6, AC-8); (5)
  `document.getElementById('btnStart')` is `null` and no `renderAll` reference
  to it throws (AC-10); (6) `goto ritual.html?c=<slug>&change=1` still opens
  `#startScrim` (AC-10).
- **Existing suites that must stay green:** `logging.mjs` (card render + log
  button), `pen-starts.mjs` and `first-dose-start.mjs` (the sheet still edits
  per-pen dates and shows the "first logged dose" note), `no-reprompt.mjs`
  (anchoring + the `?change=1` path).

**Touch points:**
- `patients/jessica/ritual.html` (`renderToday`, new `wireChips`, `openStartPicker`
  copy, `renderAll`, boot), `portal/tests/pen-time-chips.mjs` (new).

**Risks:** native date/time inputs on the iOS home-screen app can behave
differently — the test drives the `blur`/`change` path in Chromium and the plan
flags a manual `isHomeScreenApp()` smoke (NFR-3, R1). The atelier-pinned-value
editable-vs-disabled question (not first-dose-locked) is a small UX decision; the
recommended behavior above mirrors the sheet.

---

### Phase 4 — Atelier side: `settings.penTimes` flow, `stateReport` rows, and the overview contract

**Goal:** The atelier can set a per-pen time in Card Studio, it reaches a locked
pen on the next open through `settings.rev`/`force`, the reported state carries
the effective time, and `/api/overview` stays free of times and settings.

**Tasks:**
- [ ] `portal/store/index.js` — confirm `publicView()` returns `settings` as-is
      (it does); no code change. Verify `sanitize()` carries `settings` forward on
      every save (already via `sanitizeSettings`), so a Studio save cannot drop
      `penTimes`.
- [ ] `patients/jessica/assets/protocol.js` — confirm `applySettings()` (Phase 1)
      adopts `penTimes` even for a locked pen (the atelier map is independent of
      the chip lock), and `cardSignature()` already folds `settings.rev` so a
      `penTimes` change is re-fetched by `recheckCard()`.
- [ ] `portal/studio/index.html` (if the editor renders `settings.times`) — add a
      per-pen time input row to the Card Studio editor so the atelier can set
      `settings.penTimes`; if the editor is generic over `settings`, confirm the
      new field passes through `sanitizeSettings()` unchanged. (Scope note: if the
      Studio editor does not currently expose band `times`, this phase is limited
      to the store/engine plumbing and the atelier can set `penTimes` via the API.)
- [ ] `patients/jessica/assets/protocol.js` — finalize `stateReport()`: `today`
      rows report `at: timeFor(pen)`; `supply` rows stay day-only (no time field).

**Acceptance criteria:**
- `settings.penTimes` survives `sanitizeSettings()` and `publicView()` (FR-19,
  FR-22).
- A locked pen adopts an atelier `penTimes` override when `settings.rev` increases
  (AC-7); `force` raises `rev` even when the value is unchanged (FR-16).
- `stateReport()` reports the effective per-pen time as `HH:MM` in the `today`
  rows (FR-20).
- `/api/overview` returns no times or settings (FR-21, AC-13); the
  `overview.mjs` assertion stays green unchanged.

**Tests:**
```bash
# terminal 1 — Auth emulator
firebase emulators:start --only auth

# terminal 2 — service
cd portal
SEED_FILE=.data-test/pen-time-atelier-cards.json npm run seed
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  CARD_STORE=file CARD_FILE=.data-test/pen-time-atelier-cards.json \
  DOSE_FILE=.data-test/pen-time-atelier-doses.json \
  STUDIO_PASSPHRASE=testpassphrase PORT=8095 node server.js &
echo "$(curl -s -X POST http://localhost:8095/api/session -H 'Content-Type: application/json' \
  -d '{"passphrase":"testpassphrase"}' -i | grep -i '^set-cookie' \
  | sed 's/^[Ss]et-[Cc]ookie: ca_studio=//' | cut -d';' -f1)" > /tmp/tok.txt

# terminal 3 — run (the overview contract is re-checked with an AGENT_TOKEN too)
AGENT_TOKEN=test-agent-token-xyz source /tmp/qa-env.sh \
  BASE=http://localhost:8095 node tests/pen-time-atelier.mjs
node tests/overview.mjs
```
- **New: `portal/tests/pen-time-atelier.mjs`** (Playwright + HTTP). Arrange: mint
  a named `ghk` card; `signInGoogle`; open the card; POST `/api/dose` so `ghk` is
  locked. Act: PUT `/api/cards/<slug>` with `settings: { penTimes: { ghk:'21:30' },
  rev: <higher> }` (behind the Studio cookie); re-open / `recheckCard()`. Assert:
  `timeFor(pen) === '21:30'` despite the lock, and the chip is still locked (AC-7);
  a `force` PUT with an unchanged value still bumps `rev` and re-applies (FR-16);
  `reportState(true)` → dashboard `/api/cards` shows the `today` row `at:'21:30'`
  and the `supply` row has no time key (FR-20); `GET /api/overview` (with
  `AGENT_TOKEN`) contains no `times`, `settings`, `penTimes`, or `at` fields
  (FR-21, AC-13).
- **Existing suites that must stay green:** `overview.mjs` (the no-times/
  no-settings contract — run unchanged), `pen-starts.mjs` (state report `supply`
  still reaches the atelier), `supply-flags.mjs` (dashboard supply unaffected).

**Touch points:**
- `portal/store/index.js` (verify `publicView`/`sanitizeSettings`),
  `patients/jessica/assets/protocol.js` (`applySettings`, `cardSignature`,
  `stateReport`), `portal/studio/index.html` (optional editor row),
  `portal/tests/pen-time-atelier.mjs` (new).

**Risks:** if the Studio editor is generic and re-POSTs the whole `settings`
object, an unsupported field could be dropped — the "verify the editor passes
`penTimes` through" task and the `pen-time-settings.mjs` sanitization guard cover
this. Do not add the field to `/api/overview`; that is the one leak that breaks
the privacy contract (R5).

---

### Phase 5 — Regression hardening, baseline doc updates, and full-suite verification

**Goal:** The baseline spec reflects the new behavior, stray references are
cleaned up, and the complete suite (old + new) passes against the harness.

**Tasks:**
- [ ] `specs/000-system.md` — update §3.3 (dose logging: lock at first dose),
      §3.4 (reminders: per-pen time changes only which instants `upcomingDoses()`
      emits), §3.5 (calendar export: event times come from the per-pen time through
      instant construction), and §4.3 (card record shape: `settings.penTimes`).
- [ ] `portal/tests/README.md` — add the four new suites to the index and note the
      `firstAt` field on `/api/logged`.
- [ ] `patients/jessica/ritual.html` — sweep for any remaining `#btnStart` /
      "start day above" copy, dead CSS, or a chip/meta double-render; confirm
      `?change=1`, the wizard, add/remove pens, and the log sheet all still work.
- [ ] Final verification pass (below) — every suite in this plan plus the
      pre-existing pinning suites, each against its own per-suite file store.

**Acceptance criteria:**
- `specs/000-system.md` reflects the four touched sections.
- The four new suites and every pre-existing suite listed in this plan pass
  (FR-23).

**Tests — full-suite verification:**
```bash
# terminal 1 — emulators (Auth required; Firestore optional for the full path)
firebase emulators:start --only auth

# terminal 2 — push sink (for the push/atelier suites; records to /tmp/hits.json)
openssl req -x509 -newkey rsa:2048 -keyout /tmp/sink-key.pem \
  -out /tmp/sink-cert.pem -days 2 -nodes -subj "/CN=localhost"
node -e "const https=require('node:https'),fs=require('node:fs');
  https.createServer({key:fs.readFileSync('/tmp/sink-key.pem'),
  cert:fs.readFileSync('/tmp/sink-cert.pem')},(q,s)=>{s.writeHead(201);s.end()}).listen(9443)" &

# terminal 3 — per-suite services + runs (source /tmp/qa-env.sh sets shared env;
# /tmp/qa-vapid.env holds the VAPID keys; /tmp/tok.txt holds the Studio cookie)
cd portal
source /tmp/qa-env.sh /tmp/qa-vapid.env

# new suites (each on its own file store / port, as listed in Phases 1–4)
BASE=http://localhost:8091 node tests/pen-time-settings.mjs
BASE=http://localhost:8092 node tests/pen-time-resolve.mjs
BASE=http://localhost:8093 node tests/pen-time-instants.mjs
BASE=http://localhost:8094 node tests/pen-time-chips.mjs
BASE=http://localhost:8095 node tests/pen-time-atelier.mjs

# pre-existing pinning suites (each against its documented service)
node tests/first-dose-start.mjs
node tests/pen-starts.mjs
node tests/no-reprompt.mjs
node tests/logging.mjs
node tests/overview.mjs
node tests/push-ui.mjs
node tests/tirz-vial.mjs
```
- **New tests that must pass:** `pen-time-settings.mjs`, `pen-time-resolve.mjs`,
  `pen-time-instants.mjs`, `pen-time-chips.mjs`, `pen-time-atelier.mjs`.
- **Existing tests that must pass (the pinning set):** `first-dose-start.mjs`,
  `pen-starts.mjs`, `no-reprompt.mjs`, `logging.mjs`, `overview.mjs`,
  `push-ui.mjs`, `tirz-vial.mjs`.

**Touch points:**
- `specs/000-system.md`, `portal/tests/README.md`, `patients/jessica/ritual.html`
  (cleanup only).

**Risks:** the pinning suites use fixed ports (8094/8095/8099) and per-suite file
stores; a stray shared file store would leak a previous run's doses and fail a
"mint its own card" suite. Run each against its own `CARD_FILE`/`DOSE_FILE`.

---

## Risks and open questions

- **R1 — iOS home-screen native inputs (NFR-3).** A native date/time input can
  behave differently in a standalone web app. The Chromium suite drives
  `blur`/`change`; a manual `isHomeScreenApp()` smoke remains for release.
- **R2 — Lock message wording (spec R2).** A back-filled first dose also reads
  "first logged dose." Accepted: the message names the first dose, which is the
  anchor.
- **R3 — Sheet vs chip disagreement (spec R3).** The chip edits the per-pen time,
  the sheet edits the band time, and the per-pen value wins. Mitigated by the one
  line added to the sheet copy in Phase 3.
- **R4 — First-dose time source (spec R4 / open question 2, settled).** `/api/logged`
  returns `firstAt` (earliest `at` per pen); the client renders it as local
  `HH:MM`. This is the earliest *recorded* instant, not necessarily the moment she
  injected for a back-fill — accepted as the best available observation.
- **R5 — Overview leak (spec R5).** A time field must never reach `/api/overview`.
  Enforced by keeping `overview.mjs` unchanged and by the explicit assertion in
  `pen-time-atelier.mjs`.
- **Open question (recommended resolution pinned).** Field name `settings.penTimes`
  (spec open question 1) is adopted. Whether the Studio editor needs a bespoke
  per-pen time row depends on whether it already renders `settings.times`; if not,
  the atelier sets `penTimes` via the API and the editor row is a follow-up, not a
  blocker (Phase 4 scope note).
- **Open question (recommended resolution pinned).** `stateReport()` reports the
  effective time only in the `today` rows (active pens), not `supply` rows — the
  dashboard's supply view renders no time and widening the report would increase
  the surface for no consumer (spec open question 3).
- **Open question (minor, surfaced for the gate).** Atelier-pinned values
  (`pen.atelierStart` / `pen.atelierTime`) on a pen *without* a first dose: the
  spec only specifies the first-dose lock, but an editable chip over an
  atelier-pinned value would be a confusing no-op. The plan mirrors the sheet
  (show the value, mark it "set by the atelier", non-editable) — confirm this is
  the desired behavior.
