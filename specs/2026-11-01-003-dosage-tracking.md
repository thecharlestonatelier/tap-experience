# Per-Pen Start Day and Dosing Time

**Spec ID:** SPEC-003
**Date:** 2026-11-01
**Slug:** dosage-tracking
**Status:** Approved (design gate v2, decision (3) amended)

## 1. Overview

This spec splits the protocol start day and the dosing time so each pen
carries its own. Today one start day covers the whole protocol, and pens
in the same band share one clock time. This spec moves the start-day and
time controls from the top-level schedule sheet into each pen's own card.
The first logged dose locks a pen's start day and time.

The dose log keys by pen id, not template, so two pens of the same
template log independently. Design gate v1 keyed the log by template,
which silently dropped the second same-template pen's same-day dose and
corrupted its start day. The human amended decision (3) on 2026-11-02 to
key the log by pen id, which reopens §4 and NFR-2.

## 2. Goals and Non-Goals

### Goals

- Show "started [date]" at the top of each pen card, between the pen name
  and the remove control.
- Open a per-pen calendar modal when the patient taps that date.
- Let each pen carry its own clock time, independent of its band.
- Lock a pen's start day and time after its first logged dose.
- Remove the top-level start-day control and its "Set my schedule" sheet.
- Keep the read-only Schedule tab as the month view.
- Key the dose log by pen id so two same-template pens log independently.

### Non-Goals

- A retry queue for an offline dose. A dose that never reaches the server
  never locks the pen. This gap is pre-existing and out of scope.
- A custom time picker. The native `<input type="time">` already works.
- Removing the Schedule tab. It is a read-only month view with a back-fill
  "Log it" path, not the universal editor the issue names.
- Recovering the dropped second same-template dose. The old template key
  never wrote it, so it cannot be recovered. The migration preserves what
  was written and stops the drop from now on.

## 3. Current Behavior

The engine stores a start day per pen already. `penStart(pen)` in
`patients/jessica/assets/protocol.js` reads `pen.startDate`, then falls
back to the protocol `START`. `setPenStart(pen, iso)` writes the day to
the `tca.penstart.<patient>` storage key. `applyPenStarts()` applies the
day. This spec keeps all of that and changes only where the patient sees
and edits it.

Today the patient edits the start day from one sheet at the top of
`ritual.html`. The `#btnStart` button opens `openStartPicker()`, which
shows a native `<input type="date">` per pen. This spec removes that sheet
and moves the control into each pen's card.

Today `timeFor(pen)` returns `loadTimes()[pen.time]`. The key is the band,
so every pen in the Evening band reads the same value. This spec lets a
pen carry its own value in the same `tca.times.<patient>` map, keyed by
`pen.id`. A pen id never equals a band label, so the two kinds of key do
not collide.

Today `applyPenStarts()` applies this order: atelier day, then the typed
day, then the first logged dose. The typed day wins over the first dose.
This spec reverses that order for a locked pen.

Today the dose log keys by template. `penKeyOf(pen)` in
`patients/jessica/assets/protocol.js` returns `pen.template` (falling back
to `pen.templateId`, then `pen.id`), `doseId()` in
`portal/store/doses.js` returns `slug.template.day`, and `/api/logged/<slug>`
returns a template id per day. Two pens of the same template therefore
share one key. This spec keys the log by pen id instead.

## 4. Invariants and Scope Boundary

These must not change:

- The no-build constraint. The portal stays plain ES modules.
- The slug as the credential. The card address keeps working.
- The dose log and its identity. One record per patient, pen, and day
  (`doseId` in `portal/store/doses.js` keys on the pen id).
- The rule that a card that cannot reach the service still shows its dose.
- `penStart(pen)`, `setPenStart(pen, iso)`, and the storage keys.

This spec changes:

- The dose-log key. `doseId` moves from `slug.template.day` to
  `slug.pen.day`. This spec adds no new endpoint; `/api/logged/<slug>`
  returns a pen id per day instead of a template id.
- `dose.html` and `ritual.html`. The `/api/dose` POST carries the pen id
  (the key) and the template id (for the atelier's log). The lock still
  derives from `LOGGED`, already served by `/api/logged/<slug>`.

## 5. User Flows

### 5.1 A pen with no dose

The card shows "started [date]" and a time field. Both are editable.
Saving writes `setPenStart` or the per-pen time, then calls
`scheduleChanged()` and redraws.

### 5.2 A pen with a typed day but no dose

The typed day applies. Nothing changes from today.

### 5.3 A pen with a dose

The card shows the first logged dose as the start day. The day and time
controls do not open. Tapping them shows a toast that the first logged
dose pinned the day.

### 5.4 A pen with an atelier day

The card shows the atelier day. The patient cannot edit the day, but can
still edit the time until a dose locks the pen. This matches today's
picker, which disables the day field only.

### 5.5 Logging a dose

The "Log this dose" button posts to `/api/dose` with the exact timestamp
in `at`. `loadLogged()` calls `applyPenStarts()` after it loads, so the
next draw locks the pen and snapshots its time.

### 5.6 A back-filled dose

Logging a past day counts the same. If that day is earlier than the pen's
current start day, the lock moves to it. `firstDoseDay()` already picks
the earliest day.

### 5.7 A vial tap

`dose.html` posts to `/api/dose` the same way. The lock derives from
`LOGGED`, so a tap locks the pen too.

### 5.8 Removing and restoring a pen

`removePen()` keeps the pen's logged doses. The lock survives a remove and
a restore, because the log still holds the dose.

## 6. Functional Requirements

### 6.1 The shared engine

- **FR-1.** Change `timeFor(pen)` to read `loadTimes()[pen.id]`, then
  `loadTimes()[pen.time]`, then `TIME_AT[pen.time]`, then `"09:00"`.
- **FR-2.** Add `setPenTime(pen, hhmm)`. It writes `mine[pen.id] = hhmm`
  into `loadTimes()` and calls `scheduleChanged()`.
- **FR-3.** Add `penLocked(pen)`. It returns `!!firstDoseDay(pen)`.
- **FR-4.** Change `applyPenStarts()` so the order is `atelierStart`, then
  `firstDoseDay`, then `mine[pen.id]`. For a pen with no dose the order
  collapses to the same as today.
- **FR-5.** In `applyPenStarts()`, for each locked pen with no per-pen
  override yet, snapshot `timeFor(pen)` into `loadTimes()[pen.id]` without
  firing `scheduleChanged()`. Keep the `_supplyCache.clear()` call.
- **FR-6.** Change `stateReport()` so each `today[]` entry's `at` uses
  `timeFor(pen)`.
- **FR-7.** Change `icsChangeUrl()` to take a pen and carry
  `?change=<pen.id>` in the URL it returns.
- **FR-8.** Change `buildICS()` to build one URL per event.

### 6.2 The ritual page

- **FR-9.** Remove the `#btnStart` button, the `#startScrim` sheet, and
  their listeners from `ritual.html`.
- **FR-10.** Remove `openStartPicker`, `commitStart`, `closeStartPicker`,
  and the `startInput`, `startPens`, `startQuick`, `startTimes` elements.
- **FR-11.** Add a calendar modal. Reuse the `.cal-grid` and `.cal-day`
  markup. Add `openStartCalendar(pen)`, `renderStartCalendar()`,
  `commitStartDay(day)`, and `closeStartCalendar()`.
- **FR-12.** Make `commitStartDay` call `setPenStart(pendingPen, iso(day))`,
  then `scheduleChanged()`, then `renderAll()`.
- **FR-13.** In `renderToday()`, add a "started [date]" button and a time
  field to each `.dose-top`, between the name block and the `.pen-x`
  control.
- **FR-14.** In `renderRhythm()`, add the same start-day button and time
  field to each `.supply-head`.
- **FR-15.** When `penLocked(pen)` holds, render the start day and time as
  plain text. Tapping them shows a toast.
- **FR-16.** When only `pen.atelierStart` holds, render the date as plain
  text and keep the time field.
- **FR-17.** Wire the time fields to `setPenTime(pen, value)`. Wire the
  start-day buttons to `openStartCalendar(pen)`.
- **FR-18.** In `boot()`, open a calendar when the card has no start day
  and no anchor, and when the address carries `?change=<pen.id>`. For
  `?change`, open that pen's calendar. For a new unanchored card, open the
  first pen's calendar; picking a day sets the protocol start day.

### 6.3 The print card

- **FR-19.** In `schedule-card.html`, replace the "Started ... change" and
  "Set my schedule" steps with the new per-card flow.

### 6.4 The dose-log key

- **FR-20.** Change `penKeyOf(pen)` in
  `patients/jessica/assets/protocol.js` to return `pen.id`.
- **FR-21.** In `ritual.html` and `dose.html`, post the pen id as the key
  and keep the template id in the `template` field. The `pen` field now
  carries the pen id, not the pen name.
- **FR-22.** Change `doseId()` in `portal/store/doses.js` to return
  `slug.pen.day`. `sanitizeDose()` keeps both `pen` (the id) and
  `template` (the template id).
- **FR-23.** In `/api/logged/<slug>` (`portal/server.js`), return the pen
  id per day instead of the template id.
- **FR-24.** Migrate the existing template-keyed doses: dual-read both keys
  while the backfill runs, then re-key each surviving record to its pen id
  and remove the legacy key.

## 7. Data Model

### 7.1 `tca.times.<patient>`

One JSON map in `localStorage`, already written by `saveTimes()`. Today the
keys are band labels. This spec adds per-pen keys.

| Key kind | Example | Meaning |
|---|---|---|
| Band | `"Evening"` | The atelier's coarse default for a band |
| Pen | `"ghk"` | The patient's per-pen override |

A pen id never equals a band label, so the two kinds of key do not
collide. `timeFor(pen)` reads the pen key first, then the band key.

### 7.2 `tca.penstart.<patient>`

Unchanged. One JSON map keyed by pen id, written by `setPenStart()`.

### 7.3 The dose log

One record per patient, pen, and day. `doseId()` in
`portal/store/doses.js` builds the record id as `slug.pen.day`. The `pen`
field carries the pen id, and the `template` field carries the template id
for the atelier's log. `/api/logged/<slug>` returns the pen id per day,
which `firstDoseDay()` and `takenOn()` match against `penKeyOf(pen)`.

For a card with one pen of a template, `pen.id` equals the template id, so
the key stays the same. For a card with two pens of one template,
`hydrateRecord()` mints `template#0` and `template#1`, and each logs its
own record.

## 8. Non-Functional Requirements

- **NFR-1 (No build).** The change is plain classic scripts. No bundler
  enters the project.
- **NFR-2 (No new server endpoint; key by pen id).** No new route is
  added. `doseId` in `portal/store/doses.js` keys on the pen id, and
  `/api/logged/<slug>` returns pen ids. The lock still reads `LOGGED`.
- **NFR-3 (Device-only).** Per-pen times and start days stay in
  `localStorage`. Store no new PHI field on the server.
- **NFR-4 (Failure tolerance).** A card that cannot reach the service still
  draws. A dose that never reaches the server never locks the pen.
- **NFR-5 (Compatibility).** The native date and time inputs work on iOS
  Safari, Android, and desktop.

## 9. Acceptance Criteria

- **AC-1.** `timeFor(pen)` returns the per-pen override when one exists.
- **AC-2.** Two Evening pens can carry different times.
- **AC-3.** `stateReport()` carries each pen's own time.
- **AC-4.** After the first logged dose, `applyPenStarts()` pins the pen's
  start day to that dose, and a later typed day no longer applies.
- **AC-5.** A locked pen snapshots its effective time, and a later band
  change no longer moves it.
- **AC-6.** The start-day and time controls do not render for a locked pen.
- **AC-7.** An atelier-set day renders as plain text, and the time field
  stays editable until a dose locks the pen.
- **AC-8.** Tapping a locked pen's date or time shows a toast, not a write.
- **AC-9.** The top-level `#btnStart` and `#startScrim` are gone.
- **AC-10.** The calendar modal opens per pen, and picking a day sets only
  that pen's day.
- **AC-11.** The calendar event link carries `?change=<pen.id>`.
- **AC-12.** The read-only Schedule tab stays as the month view.
- **AC-13.** Two pens of one template log independently; the second pen's
  same-day dose is not dropped, and logging one pen does not mark or lock
  the other.
- **AC-14.** A card with one pen of a template keeps its existing marks
  through the migration. On a card with two same-template pens, the single
  surviving record maps to the first pen, and the dropped second dose is
  not recovered.

## 10. Research and Best Practices

The current code grounds this design. The design gate settled the three
decisions below. The human approved them as drafted.

- **The lock reverses a tested rule.** The comment in `applyPenStarts()`
  says a patient who typed the 12th but logged from the 14th is telling us
  about two unlogged doses, and she is right. The new lock says the first
  logged dose wins. `portal/tests/first-dose-start.mjs` asserts the old
  rule on line 101. This is a clinical judgment, and the design follows the
  lock, so the test flips.
  - Verdict: Approved. Flip line 101.

- **"Schedule tab" means the editor sheet.** The issue names a schedule
  editor that applied changes universally. The read-only Schedule tab is a
  month view with a back-fill path, not that editor. It stays.
  - Verdict: Approved. Keep the read-only Schedule tab.

- **Two same-template pens log independently.** The dose log keys by pen
  id, not template, because `firstDoseDay()` uses `penKeyOf(pen)` and
  `doseId` keys by pen id. Two pens of one template keep independent locks
  and first-dose days.
  - Verdict: Amended 2026-11-02. The human chose Option A. Key the dose
    log by pen id. Gate v1 had accepted the template key, which silently
    dropped the second same-template pen's dose.

## 11. Baseline Impact

When this feature lands, update these sections of `specs/000-system.md`:

- `§3.3` (Dose logging): note that the first logged dose locks a pen's
  start day and time, and that the dose log keys by pen id.
- `§4.3` (Card record shape): note that `settings` times and the
  device-side per-pen overrides coexist.
- `§5` (Constraints): no new server endpoint; the dose log keys by pen id;
  the lock reads `LOGGED`.

## 12. Risks

- **R1: Lock override.** The lock reverses a deliberate, tested rule. A
  patient who typed a day but logged later loses her typed day. Mitigate:
  the flip is a clinical judgment approved at the design gate, and
  `first-dose-start.mjs` asserts the new behavior.
- **R2: Dose-log migration.** Existing template-keyed doses must move to
  pen-id keys without double-counting or dropping a record. Mitigate: the
  backfill re-keys each surviving record and dual-reads both keys while it
  runs. A single-pen card keeps its key, so only same-template cards move.
  The second same-template dose was already dropped and cannot be
  recovered.
- **R3: Offline dose.** A dose that never reaches the server never locks
  the pen. Mitigate: pre-existing and out of scope. Add no retry queue.

## 13. Settled Decisions and Open Questions

### Settled decisions

- The lock reverses the typed-day-wins rule in `applyPenStarts()`. The
  first dose wins.
- "Schedule tab" means the editor sheet, not the calendar tab. The
  read-only Schedule tab stays.
- Two same-template pens log independently because the dose log keys by
  pen id (amended by human decision A, 2026-11-02).

### Open questions

None. The design gate approved the draft as written, and decision (3) is
resolved.

## 14. Glossary

- **pen.** One dispensed medication on a card.
- **pen id.** The stable per-pen key minted by `hydrateRecord()`: the
  template id for a card with one pen of that template, or `template#N`
  for two pens of one template.
- **band.** The label that names when a pen goes in the day, for example
  Evening.
- **LOGGED.** The server's dose log, loaded by `loadLogged()`, keyed by
  pen id.
- **LOGS.** The device-only list that `ritual.html` keeps.
- **TIME_AT.** The map from a band to a default clock time.
- **per-pen override.** A time stored under a pen id in `tca.times.<patient>`.
- **lock.** The state of a pen that has at least one logged dose.
