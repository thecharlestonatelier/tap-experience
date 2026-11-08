# Per-Pen Start Day and Dosing Time: Implementation Plan

**Spec:** `specs/2026-11-01-003-dosage-tracking.md`
**Plan:** `plans/2026-11-01-003-dosage-tracking.md`

## Context

- **What the spec requires.** Split the protocol start day and the dosing time
  so each pen carries its own. Move the start-day and time controls from the
  top-level sheet into each pen's card. Add a per-pen calendar modal. Add
  `timeFor(pen)` reading a per-pen override first. Lock a pen's start day and
  time after its first logged dose, reversing `applyPenStarts()` so the first
  dose wins over a typed day. Remove `#btnStart` and `#startScrim`. Keep the
  read-only Schedule tab. Key the dose log by pen id so two same-template
  pens log independently, and migrate the existing template-keyed doses.
- **Graph status.** `GRAPH_USED`. `graphify-out/graph.json` (report dated
  2026-10-22) covers the surrounding structure. The change touches
  `timeFor`/`applySettings`/`effectiveTimes` (community "Time Bands & Revision
  Apply"), `applyPenStarts`/`penStart`/`firstDoseDay` (community "Protocol Day
  & Dose Scheduling"), `buildICS`/`icsChangeUrl` (community "ICS File
  Generation"), `loadLogged`/`watchLogged` (community "Logging & Ritual Boot"),
  and `stateReport` (god node, 12 edges). `ritual.html`'s inline script is not
  deeply graphed; its `boot()` and `renderToday()`/`renderRhythm()` are
  grounded from direct reads.
- **Key constraints.** No build step — plain classic scripts and ES modules.
  No new server endpoint — the lock still reads `LOGGED`, already served by
  `/api/logged/<slug>`. The dose-log key changes from template to pen id:
  `doseId` in `portal/store/doses.js` becomes `slug.pen.day`, and
  `/api/logged/<slug>` returns a pen id per day. Per-pen times and start days
  stay in `localStorage`.
- **Settled at the design gate (approved as drafted, decision (3) amended):**
  (1) the lock reverses the typed-day-wins rule in `applyPenStarts()`; (2)
  "schedule tab" means the editor sheet, not the calendar tab; (3) the dose
  log keys by pen id, so two same-template pens log independently (human chose
  Option A on 2026-11-02).

## Phases

### Phase 1 — Engine: per-pen time and the first-dose lock

**Goal:** `protocol.js` computes per-pen times, locks a dosed pen to its first
logged day, snapshots the locked time, and reports and exports per-pen time.

**Tasks:**
- [ ] Change `timeFor(pen)` to read `loadTimes()[pen.id]`, then
      `loadTimes()[pen.time]`, then `TIME_AT[pen.time]`, then `"09:00"`
      (FR-1).
- [ ] Add `setPenTime(pen, hhmm)`: `mine = loadTimes();
      mine[pen.id] = hhmm; saveTimes(mine)` (FR-2). `saveTimes()` already
      fires `scheduleChanged()`.
- [ ] Add `penLocked(pen)` returning `!!firstDoseDay(pen)` (FR-3).
- [ ] Change `applyPenStarts()` precedence to `atelierStart`, then
      `firstDoseDay`, then `mine[pen.id]` (FR-4). For a pen with no dose the
      order collapses to today's.
- [ ] In `applyPenStarts()`, for each locked pen with no per-pen override yet,
      write `mine[pen.id] = timeFor(pen)` without firing `scheduleChanged()`;
      keep the `_supplyCache.clear()` call (FR-5). The "no override yet" guard
      keeps a later atelier band change from overwriting a locked pen's
      snapshot.
- [ ] Change `stateReport()` so each `today[]` entry's `at` uses `timeFor(pen)`
      instead of `effectiveTimes()[pen.time]` (FR-6).
- [ ] Change `icsChangeUrl(pen)` to carry `?change=<pen.id>`; change
      `buildICS()` to build one change URL per event (FR-7, FR-8). Keep the
      `?change=1` fallback out — every event now names its pen.

**Acceptance criteria:**
- `timeFor(pen)` returns the per-pen override when one exists (AC-1).
- Two Evening pens can carry different times (AC-2).
- `stateReport()` carries each pen's own time (AC-3).
- After the first logged dose, `applyPenStarts()` pins the start day to that
  dose and a later typed day no longer applies (AC-4).
- A locked pen snapshots its effective time and a later band change no longer
  moves it (AC-5).
- The calendar event link carries `?change=<pen.id>` (AC-11).

**Tests:**
```bash
# terminal 1 — Auth emulator (the suites sign in through it)
firebase emulators:start --only auth

# terminal 2 — service on a file store with a Studio passphrase
cd portal
CARD_STORE=file STUDIO_PASSPHRASE=testpassphrase \
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=atelier-tap \
  PORT=8095 node server.js &

# mint a Studio session token for /tmp/tok.txt
TOK=$(curl -s -X POST http://localhost:8095/api/session \
  -H "Content-Type: application/json" -d '{"passphrase":"testpassphrase"}' -i \
  | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: ca_studio=//' | cut -d';' -f1)
echo "$TOK" > /tmp/tok.txt

# terminal 3 — the new per-pen-time suite
cd portal
node tests/pen-times.mjs
```
- `pen-times.mjs` (new, authored in Phase 4 but runnable here) asserts the
  engine behavior. Until Phase 4 adds it, this phase is verified by a manual
  smoke: two Evening pens carry different times, and `stateReport().today[].at`
  reflects each pen.
- Known-failing until Phase 4: `first-dose-start.mjs` line 101 (old rule) and
  the picker interaction — the reversal is intentional and the suite updates
  in Phase 4.

**Touch points:**
- `patients/jessica/assets/protocol.js` (`timeFor`, `setPenTime`, `penLocked`,
  `applyPenStarts`, `stateReport`, `icsChangeUrl`, `buildICS`).

**Spec refs:**
- `specs/2026-11-01-003-dosage-tracking.md` §6.1 (FR-1–FR-8), §9 (AC-1–AC-5,
  AC-11).

---

### Phase 2 — Ritual page: calendar modal and per-card controls

**Goal:** `ritual.html` drops the global schedule sheet, shows a per-pen
"started [date]" button and time field on each card, and opens a per-pen
calendar modal that sets only that pen's day.

**Tasks:**
- [ ] Remove the `#btnStart` button (markup and listener), the `#startScrim`
      sheet, and the listeners (FR-9).
- [ ] Remove `openStartPicker`, `commitStart`, `closeStartPicker`, and the
      `startInput`, `startPens`, `startQuick`, `startTimes` elements (FR-10).
- [ ] Add the calendar modal markup, reusing `.cal-grid` and `.cal-day`
      (FR-11). Add a `pendingPen` state and the functions `openStartCalendar`,
      `renderStartCalendar`, `commitStartDay`, `closeStartCalendar`.
- [ ] Make `commitStartDay(day)` call `setPenStart(pendingPen, iso(day))`,
      then `scheduleChanged()`, then `renderAll()` (FR-12).
- [ ] In `renderToday()`, add a "started [date]" button and a time field to
      each `.dose-top`, between the name block and `.pen-x` (FR-13). When
      `penLocked(pen)` holds, render both as plain text; tapping shows a toast
      (FR-15). When only `pen.atelierStart` holds, render the date as plain
      text and keep the time field (FR-16).
- [ ] In `renderRhythm()`, add the same start-day button and time field to
      each `.supply-head` (FR-14).
- [ ] Wire the time fields to `setPenTime(pen, value)` and the start-day
      buttons to `openStartCalendar(pen)` (FR-17).
- [ ] In `boot()`, replace the `wantsChange` / `anchored` logic: open a
      calendar when the address carries `?change=<pen.id>` (that pen's
      calendar) or when the card has no start day and no anchor (the first
      pen's calendar) (FR-18). For a new unanchored card, picking a day sets
      the protocol start day, which every pen falls back to.

**Acceptance criteria:**
- The start-day and time controls do not render for a locked pen (AC-6).
- An atelier-set day renders as plain text, and the time field stays editable
  until a dose locks the pen (AC-7).
- Tapping a locked pen's date or time shows a toast, not a write (AC-8).
- `#btnStart` and `#startScrim` are gone (AC-9).
- The calendar modal opens per pen, and picking a day sets only that pen's day
  (AC-10).
- The read-only Schedule tab stays as the month view (AC-12).

**Tests:**
```bash
# same emulator + service + /tmp/tok.txt as Phase 1, then:
cd portal
node tests/pen-starts.mjs    # updated in Phase 4 to use the calendar modal
node tests/start-lock.mjs    # new, authored in Phase 4
```
- This phase is complete when a manual smoke against the service shows: each
  card carries "started [date]" and a time field; tapping the date opens the
  per-pen modal; picking a day moves only that pen; a locked pen shows plain
  text and a toast; the Schedule tab still opens.
- The updated `pen-starts.mjs` and new `start-lock.mjs` land in Phase 4.

**Touch points:**
- `patients/jessica/ritual.html` (`renderToday`, `renderRhythm`, `boot`, the
  calendar modal markup, the element listeners).

**Spec refs:**
- `specs/2026-11-01-003-dosage-tracking.md` §6.2 (FR-9–FR-18), §9 (AC-6–AC-10,
  AC-12).

---

### Phase 3 — Print card copy

**Goal:** `schedule-card.html` describes the new per-card flow instead of the
removed "Started ... change" and "Set my schedule" steps.

**Tasks:**
- [ ] In `schedule-card.html`, replace the "Changing your schedule" steps (the
      "Started ... — change" and "Set my schedule" copy) with the new flow:
      tap the pen's "Started ..." date on the card, pick the day and the hour
      for that pen, and the reminder and calendar follow (FR-19).
- [ ] Keep the "Setting it up — once" subscribe step and the remove-calendar
      aside unchanged.

**Acceptance criteria:**
- The print card names the per-card flow and no longer names a top-level
  "Set my schedule" sheet.

**Tests:**
- No browser suite asserts this static page. Verify by opening
  `patients/jessica/schedule-card.html` and checking the copy. Print to PDF to
  confirm it still fits the 4 in × 6 in card.

**Touch points:**
- `patients/jessica/schedule-card.html`.

**Spec refs:**
- `specs/2026-11-01-003-dosage-tracking.md` §6.3 (FR-19).

---

### Phase 4 — Test suites and full regression

**Goal:** The four suites prove the feature, and every existing suite stays
green.

**Tasks:**
- [ ] Update `portal/tests/first-dose-start.mjs`: the "she types her own date"
      section now drives the calendar modal, and line 101 asserts the opposite
      — after the first dose, the first-dose day stays, and a date the patient
      types no longer applies. The back-fill-to-earlier-day and later-dose
      assertions stay.
- [ ] Update `portal/tests/pen-starts.mjs`: replace `openStartPicker` and the
      `#startPens` / `#startInput` / `#startSave` selectors with
      `openStartCalendar` and the new calendar modal. The per-pen assertions
      (move one, other untouched, survives reload, added pen starts today,
      state reaches the atelier, remove control per pen) stay.
- [ ] Add `portal/tests/pen-times.mjs`: two Evening pens, different times;
      assert `timeFor(pen)` returns each pen's own value and `stateReport()`
      carries each pen's time.
- [ ] Add `portal/tests/start-lock.mjs`: log one dose for a pen; assert the
      pen's start day equals the dose day, the start-day and time controls do
      not render, an atelier-set day still wins, and the locked time does not
      move on a later band change.
- [ ] Run the full regression (below) with the Google helper unchanged.

**Acceptance criteria:**
- All of AC-1 through AC-12 are proven by the four suites.

**Tests:**
```bash
# same emulator + service + /tmp/tok.txt as Phase 1, then:
cd portal
node tests/first-dose-start.mjs
node tests/pen-starts.mjs
node tests/pen-times.mjs
node tests/start-lock.mjs
```
- Full regression (each suite against its own service per `tests/README.md`):
  ```bash
  cd portal
  node tests/logging.mjs
  node tests/tirz-vial.mjs
  node tests/no-reprompt.mjs
  node tests/added-pens.mjs
  node tests/protocol-change.mjs
  node tests/push-ui.mjs
  node tests/studio-pens.mjs
  node tests/gate.mjs
  node tests/gate-edge.mjs
  node tests/doses.mjs
  ```
- No-new-endpoint guard (endpoints unchanged, internals re-keyed):
  ```bash
  git diff --stat -- portal/server.js portal/store/doses.js   # rows allowed now (doseId, /api/logged); no new route
  grep -n "p === '/api" portal/server.js                     # the route set is unchanged
  ```

**Touch points:**
- `portal/tests/first-dose-start.mjs`, `portal/tests/pen-starts.mjs`,
  `portal/tests/pen-times.mjs` (new), `portal/tests/start-lock.mjs` (new).

**Spec refs:**
- `specs/2026-11-01-003-dosage-tracking.md` §9 (AC-1–AC-12).

---

### Phase 5 — Dose-log key: pen id and the migration

**Goal:** Key the dose log by pen id so two same-template pens log
independently, and move the existing template-keyed doses to pen-id keys
without double-counting or dropping a record.

**Tasks:**
- [ ] Change `penKeyOf(pen)` in `patients/jessica/assets/protocol.js` to
      return `pen.id` (FR-20). This also fixes the ICS UID, `takenOn()`,
      `firstDoseDay()`, and the calendar `data-cell` for same-template pens.
- [ ] In `ritual.html`, the `/api/dose` POST sends `pen: pen.id` (the key)
      and `template: pen.template` (the template id, unchanged) (FR-21). In
      `dose.html`, post `pen: pen.id` in the same way.
- [ ] Change `doseId()` in `portal/store/doses.js` to return
      `${d.slug}.${d.pen || 'pen'}.${d.day}` (FR-22). `sanitizeDose()` keeps
      both `pen` (the id) and `template` (the template id).
- [ ] In `portal/server.js` `/api/logged/<slug>`, push `d.pen || 'pen'`
      instead of `d.template || 'pen'` (FR-23).
- [ ] Migrate existing template-keyed doses (FR-24):
      - Dual-read while the backfill runs: the duplicate check in `put()` and
        `/api/logged` recognize both the legacy template key and the new pen-id
        key for the same slug and day, so a dose logged just before deploy
        still lands on the right pen.
      - Backfill: for each surviving record, re-key it to its pen id and
        remove the legacy key. A card with one pen of a template keeps its key
        (`pen.id` equals the template id). A card with two same-template pens
        maps the single surviving record to the first pen's id (`template#0`);
        the dropped second dose is not recoverable.

**Acceptance criteria:**
- Two pens of one template log independently; the second pen's same-day dose
  is not dropped, and logging one pen does not mark or lock the other (AC-13).
- A single-pen card keeps its marks through the migration. On a two-pen card,
  the surviving record maps to the first pen, and the dropped dose is not
  recovered (AC-14).

**Tests:**
```bash
# same emulator + service + /tmp/tok.txt as Phase 1, then:
cd portal
node tests/test_explorer_findings.mjs   # QA's proving test: the 5 bug checks now pass
node tests/pen-key-migration.mjs        # new: re-key + dual-read + same-template independence
```
- Re-run the Phase 4 suites (`first-dose-start.mjs`, `pen-starts.mjs`,
  `pen-times.mjs`, `start-lock.mjs`) to confirm the key change does not
  regress the per-pen start-day and time behavior.
- The proving test `test_explorer_findings.mjs` was left uncommitted by QA as
  the reproduction; it asserts all five symptoms and now passes against the
  fixed code.

**Touch points:**
- `patients/jessica/assets/protocol.js` (`penKeyOf`), `patients/jessica/ritual.html`
  and `patients/jessica/dose.html` (the `/api/dose` POST), `portal/store/doses.js`
  (`doseId`, `sanitizeDose`), `portal/server.js` (`/api/logged`), and the
  migration script.

**Spec refs:**
- `specs/2026-11-01-003-dosage-tracking.md` §6.4 (FR-20–FR-24), §9 (AC-13,
  AC-14), §7.3.

---

## UX contract (UI features only)

- **User, goal, platform.** Jessica (the patient) edits each pen's start day
  and dosing hour from her own card on her phone. Platform: iOS Safari
  home-screen app, Android, and desktop; the controls are native `<input>`
  fields and `<button>` elements.
- **State matrix.**

  | View | Default | Focus | Disabled / locked | Empty |
  |---|---|---|---|---|
  | Start-day control (`.dose-top`, `.supply-head`) | `<button>` "Started [date]" | visible focus ring | plain text when locked or atelier-set | falls back to protocol day |
  | Time field | native `<input type="time">` | native focus | plain text when locked; editable when atelier-set | falls back to band, then default |
  | Calendar modal | `role="dialog"`, day grid | selected day marked | n/a | n/a |
  | Toast | hidden | n/a | `role="status"` live region | n/a |

- **Copy inventory** (restates the action and the object):
  - Start-day button: `Started <date>` (for example `Started Nov 1`).
  - Locked toast: "This pen is locked to your first logged dose."
  - Atelier note (plain text): "Set by the atelier".
  - Calendar modal title: "When did you start <pen>?"
  - Calendar modal primary: "Set start day". Secondary: "Cancel".
  - First-run modal (new unanchored card) title: "When did you start?"
- **Accessibility (WCAG 2.2 P0).**
  - The start-day control is a real `<button>` whose accessible name is the
    visible "Started [date]" text.
  - The time field is a native `<input type="time">` with an associated
    `<label>`.
  - The calendar modal is `role="dialog"` with `aria-modal="true"` and
    `aria-labelledby`; focus moves into the dialog on open and returns on
    close; Esc and backdrop close it.
  - Each day button carries an accessible name (its day number); the selected
    day exposes `aria-current="date"` (or `aria-selected`).
  - The toast keeps `role="status"` / `aria-live="polite"`.
  - Text and controls meet 4.5:1 contrast; the gold `--brass` labels and
    `--muted` secondary text are checked against the card background.
- **Verification.**
  - Playwright suites in Phase 4 assert the state matrix (editable, locked,
    atelier, empty) and the toast.
  - Run the `ada-auditor` scan (MCP `ada_scan`) against the deployed card
    after the feature lands.
  - Manual keyboard pass: Tab into the start-day button, open the modal with
    Enter, close with Esc, and confirm focus returns to the button.

## Risks and open questions

- **R1 — Lock override.** The reversal breaks `first-dose-start.mjs` line 101
  until Phase 4 flips it. Intentional, and approved at the design gate.
- **R2 — Dose-log migration.** Existing template-keyed doses must move to
  pen-id keys without double-counting or dropping a record. A single-pen card
  keeps its key; only same-template cards move. The backfill re-keys the one
  surviving record to the first pen and removes the legacy key. The dropped
  second dose is not recoverable. The ICS UID for a same-template pen changes
  (template to `template#N`), so old calendar events for those pens get new
  UIDs; single-template pens keep theirs.
- **R3 — Offline dose.** A dose that never reaches the server never locks the
  pen. Pre-existing, out of scope, no retry queue added.
- **No open questions.** The three design-gate decisions are settled as
  drafted.
