# Mission: dosage-tracking (TAP-EXPERIENCE-1)

## Goal
Issue: When a patient had multiple peptide protocols, setting a start date applied that same date across all treatments. If a patient started a treatment days or weeks later, updating the start date altered it for every protocol, disrupting supply schedules and dose tracking. Patients were also unable to adjust dosing times or remove finished vials from their daily rhythm.

Placement on the Protocol Card: The start date will be placed directly at the top of the individual protocol card, located between the treatment name (e.g., "BPC-157") and the close/delete "X" icon on the right.

Calendar Modal Trigger: The text will display as started [Date], where the date is a clickable element that opens a calendar modal allowing the user to select a new date.

Individual Time Adjustments: Alongside the start date, the protocol's scheduled time (such as 8:00 PM) will be editable on an individual basis rather than setting a single universal time across all protocols.

Timestamp Locking via "Log Dose": Users can freely modify the start date and dosing time until they click the "Log this dose" button. Once clicked, the entry locks in based on the exact timestamp when the button was pressed to preserve dosage tracking integrity.

Removal of the Global Scheduling Tab: To avoid conflicting updates, the redundant top-level schedule tab that applied changes universally across all protocols is being removed. All schedule adjustments will be handled contextually within each specific protocol card.

## Human Decisions
- [x] APPROVE design as drafted
- [x] DECIDE dose-log-key — Should each pen keep its own dose log when two pens share a template? — brief: /Users/ryandenotter/Nextcloud/git/Realist/thecharlestonalilier/tap-experience/docs/decisions/dosage-tracking/dose-log-key.md

## Decision Log

- [2026-11-02T08:38:22] design: DECIDE dose-log-key v1: raised
- [2026-11-02T08:46:29] human: DECIDE dose-log-key v1: chose A

## Design

### Terms

A pen is one dispensed medication on the card. This card has two: Glow Blend and 2x Blend. Each pen carries a band label, such as Evening, that names when it goes in the day. The atelier is the clinic that runs Card Studio and dispenses the pens. The patient edits her own copy on her phone.

`LOGGED` is the server's dose log, loaded by `loadLogged()`. `LOGS` is the device-only list that `ritual.html` keeps. `TIME_AT` maps a band to a default clock time. `BASE` is the URL of the test service.

### The goal

The patient sets one start day and one clock time per pen. Today one start day covers the whole protocol, and pens in the same band share one clock time. This design splits both. The patient edits them from each pen's own card. The first logged dose locks them.

### What changes

1. Start day on the card. Each pen card shows "started [date]" at the top, between the pen name and the remove control. The date is a button.

2. Calendar modal. Tapping the date opens a month calendar for that pen. Picking a day sets that pen's start day and nothing else.

3. Time per pen. Each pen gets its own clock time. Two pens in the Evening band no longer share one.

4. Lock after logging. After the patient logs the first dose for a pen, the pen's start day and time freeze. She cannot edit them. The atelier can still correct the start day.

5. Remove the global schedule editor. The top-level start-day control and its "Set my schedule" sheet go away. The read-only Schedule tab stays as the month view.

### Start day

The engine already stores a start day per pen. `penStart(pen)` in `patients/jessica/assets/protocol.js` reads `pen.startDate`, then falls back to the protocol `START`. `setPenStart(pen, iso)` writes the patient's day to the `tca.penstart.<patient>` storage key. `applyPenStarts()` picks the day. This design keeps all of that and changes only where the patient sees and edits it.

Today the patient edits the start day from one sheet at the top of `ritual.html`. The `#btnStart` button opens `openStartPicker()`, which shows a native `<input type="date">` per pen. This design removes that sheet and moves the control into each pen's card.

### Time per pen

Today `timeFor(pen)` returns `loadTimes()[pen.time]`. The key is the band, so every pen in the Evening band reads the same value. This design lets a pen carry its own value in the same `tca.times.<patient>` map, keyed by `pen.id`. A pen id never equals a band label, so the two kinds of key do not collide.

`timeFor(pen)` reads the pen's own value first, then the band value, then the band default in `TIME_AT`. The band value stays as the atelier's coarse default. The patient's per-pen value sits on top.

### Locking

A pen locks when `firstDoseDay(pen)` returns a day. That function already reads `LOGGED`, the server's dose log, and returns the earliest logged day for the pen. A locked pen is one that has at least one logged dose.

The lock does four things. It pins the start day to the first logged dose. It stops the patient from editing the day. It stops the patient from editing the time. It also snapshots the pen's effective time into the per-pen override, so a later band change by the atelier no longer moves a locked pen's time.

This reverses one rule in `applyPenStarts()`. Today the order is: atelier day, then the patient's typed day, then the first logged dose. The new order is: atelier day, then the first logged dose, then the patient's typed day, then the protocol day. For a pen with no dose the order collapses to the same as today. Only the locked case changes.

The lock keys by pen id, not by template. `firstDoseDay()` uses `penKeyOf(pen)`, which returns the pen id, and `doseId` in `portal/store/doses.js` records one dose per patient, pen id, and day. Two pens of the same template therefore keep independent locks and first-dose days. (Amended by decision (3) on 2026-11-02 — the dose log previously keyed by template, which silently dropped the second same-template pen's dose.)

### Behavior at the boundaries

A pen with no dose. The card shows "started [date]" with the current day, and a time field. Both are editable. Saving writes `setPenStart` or the per-pen time, then calls `scheduleChanged()` and redraws.

A pen with a typed day but no dose. The typed day applies. Nothing changes from today.

A pen with a dose. The card shows the first logged dose as the start day. The day and time controls do not open. Tapping them shows a toast that the first logged dose pinned the day.

A pen with an atelier day. The card shows the atelier day. The patient cannot edit the day, but can still edit the time until a dose locks the pen. This matches today's picker, which shows "set by the atelier" and disables the day field only.

A pen with a per-pen time. The card shows that time. A pen without one shows the band time, then the band default.

Logging a dose. The "Log this dose" button posts to `/api/dose` with the exact timestamp in `at`. `loadLogged()` calls `applyPenStarts()` after it loads, so the next draw locks the pen and snapshots its time.

A back-filled dose. Logging a past day counts the same. If that day is earlier than the pen's current start day, the lock moves to it. This matches `firstDoseDay()`, which already picks the earliest day.

A vial tap. `dose.html` posts to `/api/dose` the same way. The lock derives from `LOGGED`, so a tap locks the pen too. The issue names the button, but the integrity concern covers both.

Removing and restoring a pen. `removePen()` keeps the pen's logged doses. The lock survives a remove and a restore, because the log still holds the dose.

A future start day. The card allows it. The dose page already shows "Begins [date]" when today falls before the start day. No extra handling.

An offline dose. A dose that never reaches the server never locks the pen. The device has no retry queue today, and this design adds none. This gap is pre-existing and out of scope.

### Trade-offs

Rejected: keep band-keyed times. That fails the "individual" requirement directly.

Rejected: a lock that only hides the control but keeps a pre-typed day. That contradicts "locks in based on the exact timestamp". The first dose must win.

Rejected: a custom time picker. The native `<input type="time">` already works on the phone and matches the current sheet.

Rejected: remove the Schedule tab as well. The issue names a schedule editor that applied changes universally. The Schedule tab is a read-only month view with a back-fill "Log it" path. It is not that editor. Removing it would delete the month-level back-fill for no gain.

### Open decisions

The lock reverses a deliberate, tested rule. The comment in `applyPenStarts()` says a patient who typed the 12th but logged from the 14th is telling us about two unlogged doses, and she is right. The new lock says the first logged dose wins, which overrides that memory. `portal/tests/first-dose-start.mjs` asserts the old rule on line 101. This is a clinical judgment. The issue asks for the lock to protect dose tracking, so this design follows it and flags the reversal here for the human to confirm.

The issue says "schedule tab". This design reads that as the top-level editor sheet, not the read-only calendar tab. Confirm this reading.

Decision (3) is RESOLVED — the human chose Option A: key the dose log by pen id. The dose log now keys by pen id, not template, so two pens of the same template log independently and no dose drops as a duplicate. This reopens SPEC-003 §4 (the dose-log key invariant) and NFR-2 (no new server endpoint); the architect amends both, and the builder implements a migration of existing template-keyed doses. For single-template pens the key is unchanged.

## Detailed Implementation Plan

### Files and functions

`patients/jessica/assets/protocol.js`

- Change `timeFor(pen)` to read `loadTimes()[pen.id]`, then `loadTimes()[pen.time]`, then `TIME_AT[pen.time]`, then `"09:00"`.
- Add `setPenTime(pen, hhmm)` that writes `mine[pen.id] = hhmm` into `loadTimes()` and calls `scheduleChanged()`.
- Add `penLocked(pen)` returning `!!firstDoseDay(pen)`.
- Change `applyPenStarts()` so the order is: `atelierStart`, then `firstDoseDay`, then `mine[pen.id]`. For each newly locked pen, snapshot `timeFor(pen)` into `loadTimes()[pen.id]` without firing `scheduleChanged()`. Keep the `_supplyCache.clear()` call.
- Change `stateReport()` so each `today[]` entry's `at` uses `timeFor(pen)`.
- Change `icsChangeUrl()` to take a pen and carry `?change=<pen.id>` in the URL it returns. Change `buildICS()` to build one URL per event.

`patients/jessica/ritual.html`

- Remove the `#btnStart` button, the `#startScrim` sheet, and their listeners.
- Remove `openStartPicker`, `commitStart`, `closeStartPicker`, and the `startInput`, `startPens`, `startQuick`, `startTimes` elements.
- Add a calendar modal. Reuse the `.cal-grid` and `.cal-day` markup. Add `openStartCalendar(pen)`, `renderStartCalendar()`, `commitStartDay(day)`, and `closeStartCalendar()`. `commitStartDay` calls `setPenStart(pendingPen, iso(day))`, then `scheduleChanged()`, then `renderAll()`.
- In `renderToday()`, add a "started [date]" button and a time field to each `.dose-top`, between the name block and the `.pen-x` control. When `penLocked(pen)` holds, render both as plain text. When only `pen.atelierStart` holds, render the date as plain text and keep the time field.
- In `renderRhythm()`, add the same start-day button and time field to each `.supply-head`.
- Wire the time fields to `setPenTime(pen, value)`. Wire the start-day buttons to `openStartCalendar(pen)`. For a locked pen, show the toast instead.
- In `boot()`, open a calendar when the card has no start day and no anchor, and when the address carries `?change=<pen.id>`. For `?change`, open that pen's calendar. For a new unanchored card, open the first pen's calendar; picking a day sets the protocol start day, which every pen falls back to.

`patients/jessica/dose.html`

- No code change. The lock derives from `LOGGED` on the next card load.

`patients/jessica/schedule-card.html`

- Update the print card copy. Replace the "Started ... change" and "Set my schedule" steps with the new per-card flow.

### Error paths

Calendar modal with a locked pen. The start-day button does not open the modal. It shows a toast. No write happens.

Time field on a locked pen. The field does not render. No write happens.

A dose that fails to reach `/api/dose`. The local `LOGS` still record it. The lock depends on `LOGGED`, not `LOGS`, so the pen stays unlocked until the dose reaches the server. The device has no retry queue today.

### Test cases

Update `portal/tests/first-dose-start.mjs`. Line 101 now asserts the opposite: after the first dose, the first-dose day stays, and a date the patient types no longer applies.

Update `portal/tests/pen-starts.mjs`. Replace the `openStartPicker` and `#startPens` selectors with `openStartCalendar` and the new calendar modal. The per-pen assertions stay.

Add `portal/tests/pen-times.mjs`. Give two Evening pens different times. Assert `timeFor(pen)` returns each pen's own value, and that `stateReport()` carries each pen's time.

Add `portal/tests/start-lock.mjs`. Log one dose for a pen. Assert the pen's start day equals the dose day, the start-day and time controls do not render, and an atelier-set day still wins.

### Verification

Run the suites with `node tests/<name>.mjs` in `portal/tests/`, pointing `BASE` at a local service. Confirm the card still boots with one pen, with two pens, and with a locked pen.

## Pod Activity
- [2026-11-01 19:12:08] lead: routed to pod:design (design needed — per-protocol scheduling semantics, no trivial-fix hint)
- [2026-11-01 19:22:36] design: drafted
- [2026-11-01 19:39:21] design: review passed
- [2026-11-01 20:06:28] human: gate dosage-tracking v1: approve
- [2026-11-01 21:28:46] lead: lead: builder escalation accepted — QA HIGH defect (same-template pens collapse in template-keyed dose log) surfaces a design-gate gap in decision (3). Routed back to pod:design to reopen decision (3): key dose log by pen.id, or block same-template prescriptions. Branch feature/dosage-tracking at 1bc71ee, never merged.
- [2026-11-01 21:32:51] design: decision (3) reopened — parked fork on human: A key dose log by pen.id, or B block same-template pens
- [2026-11-02 08:44:55] design: decision brief dose-log-key written and published — A: key the dose log by pen.id (reopens SPEC-003 §4 + NFR-2, needs a migration); B: block same-template prescriptions (no migration, clinical limitation). A human decides.
- [2026-11-02 08:47:27] lead: lead: decision brief dose-log-key published — pipeline parked on human DECIDE (A key the dose log by pen.id, or B block same-template prescriptions). No seat chooses; a human decides.
- [2026-11-02 08:51:18] lead: lead: human chose A — key the dose log by pen.id (per-pen logging). Routing to pod:design to republish gate v2 with the recorded choice, then pod:arch to amend SPEC-003 §4 + NFR-2 and the plan.
- [2026-11-02 09:10:55] design: decision dose-log-key resolved: human chose A (key the dose log by pen.id). Design gate republished as v2 recording decision (3) amended.
- [2026-11-02 14:50:38] architect: [2026-11-02] architect: amended SPEC-003 §4 + NFR-2 and the plan per decision (3) Option A (dose log keys by pen.id). Spec: §2 goals/non-goals, §3 current behavior, §4 invariant (one record per patient, pen, day) + scope, §6.4 FR-20–FR-24, §7.3 dose-log key, §8 NFR-2, §9 AC-13/AC-14, §10 decision (3) verdict, §11 baseline, §12 R2, §13 settled, §14 glossary. Plan: Context constraints + settled decisions updated; Phase 4 guard reworded; Phase 5 'Dose-log key: pen id and the migration' added (penKeyOf→pen.id, /api/dose POST pen.id, doseId→slug.pen.day, /api/logged→pen id, dual-read + backfill). Handing to pod:build.
- [2026-11-02 17:02:40] lead: lead: review approved — SPEC-003 dose-log key (decision 3A) complete at f2f40ef; task closed done. Branch feature/dosage-tracking at f2f40ef (local-only; origin at 1bc71ee) — never merged here; a human merges.
