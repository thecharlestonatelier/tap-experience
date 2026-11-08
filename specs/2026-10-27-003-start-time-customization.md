# Protocol Start Date and Time Customization

**Spec ID:** SPEC-003
**Date:** 2026-10-27
**Slug:** start-time-customization
**Status:** Draft

## 1. Overview

This spec lets a patient change the start date and the dosing time-of-day of
each pen from the dose card. The two values render as pill chips in the card
header. The patient taps a chip to edit the value in place. The change locks
when she logs the pen's first dose. The atelier can still override the value
from Card Studio. The time-of-day drives the due instants, the reminders, and
the calendar times.

## 2. Goals and Non-Goals

### Goals

- Show each pen's start date and time-of-day as two chips on its dose card.
- Let the patient edit each value in place, per pen.
- Lock each pen's date and time after its first logged dose.
- Keep the atelier override above the lock.
- Keep the reminders and the calendar in step with the edited time.
- Keep the existing `?change=1` schedule sheet working.

### Non-Goals

- Changing the dose log to store a timestamp. Logging stays day-granular.
- Changing the supply or phase math. The time never enters day counting.
- Changing the reminder sweep, the grace window, or the dedupe.
- Adding floating times or timezone blocks to the calendar file.
- Changing the band-level times in the schedule sheet.

## 3. Current Behavior

The engine stores one start day per pen in `tca.penstart.<patientId>`
(`patients/jessica/assets/protocol.js`, `loadPenStarts`, `savePenStarts`).
The day is resolved in `applyPenStarts()` in this order: the atelier's
`pen.atelierStart`, the patient's saved day, then the first logged dose. The
fallback is the protocol's start day.

The dosing time-of-day is a band value today. Each template names a band such
as `Morning` or `Evening` (`patients/jessica/templates.json`). `timeFor(pen)`
returns the patient's band time, or `TIME_AT` for the band, or `09:00`
(`protocol.js`, `timeFor`). `TIME_AT` maps bands to default clock times
(`protocol.js`, `TIME_AT`). The patient edits band times in the schedule
sheet (`patients/jessica/ritual.html`, `openStartPicker`, `commitStart`). The
atelier sets the band times, the per-pen time, and the protocol start day
through `card.settings.times`, `card.settings.penTimes`, and
`card.settings.startDate` (`portal/store/index.js`, `sanitizeSettings`). Both
sides sanitize a time as a real clock time, hours 00 to 23 and minutes 00 to
59.

The dose card header shows the pen name, its band and time, and a remove
button (`ritual.html`, the `dose-top` block). A separate `#btnStart` button
above the cards opens the schedule sheet (`ritual.html`, `renderAll`).

## 4. Invariants and Scope Boundary

These must not change:

- Date fields stay `YYYY-MM-DD`. The new per-pen time field is `HH:MM`
  (hours 00-23, minutes 00-59).
- Dose logging stays day-granular. The dose id stays
  `slug.template.day` (`portal/store/doses.js`, `doseId`).
- The time never enters `dayIndex`, `supply`, `occurrences`, `dosesLeft`, or
  the streak math.
- The calendar keeps real UTC instants with the `Z` suffix. It adds no
  floating times and no `TZID` or `VTIMEZONE` blocks.
- The reminder sweep keeps the 15-minute schedule, the two-hour grace, and
  the `sentUpTo` dedupe (`portal/store/subs.js`, `dueNow`).
- The `?change=1` sheet entry keeps working after `#btnStart` is removed.
- Any new field travels only through `publicView()` (atelier to patient) or
  `stateReport()` (patient to atelier). The `/api/overview` endpoint keeps
  carrying no times or settings (`portal/tests/overview.mjs`).

These are excluded from this spec:

- Editing a dose's timestamp. A logged dose stays keyed by day.
- A twice-daily pen. No template is twice daily today.
- Changing the schedule sheet's band-time rows.

## 5. User Flows

### 5.1 Edit a date

The patient opens Today's Ritual. A pen is due. Its card header shows the
name, a date chip, a time chip, and the remove button. The patient taps the
date chip. The chip becomes a native date input. The patient picks a day. The
change saves when the field changes or loses focus. The card, the calendar,
and the reminders follow the new day.

### 5.2 Edit a time

The patient taps the time chip. The chip becomes a native time input. The
patient picks a time. The change saves when the field changes or loses focus.
The next due instant, the calendar event, and the reminder move to the new
clock time.

### 5.3 First dose locks the pen

The patient logs the pen's first dose. Both chips grey out. Each chip carries
a small lock. Tapping a chip shows the toast "Locked — your first logged
dose." The patient can no longer change the date or the time.

### 5.4 The atelier overrides

The atelier sets a date or time for the pen in Card Studio. The card adopts
the new value on the next open, even though the pen is locked. The patient's
own later edit still loses to the atelier's value.

### 5.5 Change from the calendar

The patient taps a calendar event. The event's link opens
`ritual.html?change=1`. The schedule sheet opens, the same as before. The
sheet still edits per-pen dates and band times.

## 6. Functional Requirements

### 6.1 The per-pen time field

- **FR-1.** Add one time-of-day per pen, in `HH:MM`, separate from the start
  date. Store the patient's value on the device only.
- **FR-2.** Sanitize the value as a real clock time — hours 00 to 23, minutes
  00 to 59 — before it is saved or used, the same as the band times.
- **FR-3.** Keep the time-of-day out of `dayIndex`, `supply`, `occurrences`,
  `dosesLeft`, and the streak math. It changes only the instants.
- **FR-4.** Resolve the effective time-of-day per pen in this order, most
  trusted first:
  1. the atelier's per-pen value;
  2. the patient's per-pen value;
  3. the first logged dose's local clock time;
  4. the band default (`loadTimes()[pen.time]`, then `TIME_AT[pen.time]`, else
     `09:00`).

### 6.2 Instant construction

- **FR-5.** Fold the per-pen time into `timeFor(pen)` so that every consumer
  reads one value.
- **FR-6.** Read the per-pen time only through instant construction:
  `upcomingDoses()` for reminders, `buildICS()` for the calendar, and
  `scheduledInstant()` for a back-filled dose.
- **FR-7.** Build every instant from the patient's local clock time in her
  device timezone. Write the calendar instant as UTC with the `Z` suffix.
- **FR-8.** Never write a floating time or a `TZID`/`VTIMEZONE` block to the
  calendar file.

### 6.3 The chips

- **FR-9.** Render two pill chips in the dose-card header, on one row,
  between the pen name and the remove button. Order them: name, date chip,
  time chip, remove button.
- **FR-10.** Show the date chip as a short date. Show the time chip with
  `prettyTime()`, for example `7:30 pm`.
- **FR-11.** Turn an editable chip into a native input on tap: a date input
  for the date chip, a time input for the time chip. A locked or
  atelier-pinned chip stays a real button (no `aria-disabled`) and never opens
  an input.
- **FR-12.** Save the change on `change` and on `blur` — the iOS picker fires
  `change`, and keyboard entry ends in `blur`. Do not add a save button on the
  card.

### 6.4 Lock at first dose

- **FR-13.** Lock a pen's date and time once `firstDoseDay(pen)` exists.
- **FR-14.** Grey out both chips after the lock. Put a small lock (🔒) inside
  each. A chip whose value the atelier set shows a ★ instead, with a dashed
  border, while the pen is not yet locked.
- **FR-15.** Tapping a locked chip shows the toast "Locked — your first logged
  dose." Tapping an atelier-pinned chip shows the toast "Set by the atelier."
  Neither opens an input.
- **FR-16.** Keep the atelier override above the lock through
  `settings.rev` and `settings.force`.

  Note. The lock keys on `firstDoseDay(pen)` and the first-dose clock time on
  `firstDoseTime(pen)`; both read the log by `penKeyOf(pen)`
  (`pen.template`). Two same-template pens (ids `ghk#0`/`ghk#1`) therefore
  share one template-keyed dose log and one first-dose time: the first dose of
  either locks both.

### 6.5 The `#btnStart` removal

- **FR-17.** Remove the `#btnStart` button and its wiring in `renderAll()`.
- **FR-18.** Keep the schedule sheet and `openStartPicker()` working. The
  `?change=1` link in `icsChangeUrl()` still opens it. The sheet shows the
  note `#chipNote`: a per-pen chip wins over the band times set there.

### 6.6 Data flow and privacy

- **FR-19.** Extend `card.settings` with a per-pen time map for the atelier.
  Sanitize each value as a real clock time (hours 00 to 23, minutes 00 to 59)
  in `sanitizeSettings()`. Apply it in `applySettings()`.
- **FR-20.** Report the effective per-pen time through `stateReport()`. Keep
  the reported value as `HH:MM` in the `today` rows, where `sanitizeState()`
  already accepts it.
- **FR-21.** Do not add times or settings to the `/api/overview` response.
- **FR-22.** Keep `publicView()` returning `settings` as it does today. Add no
  state report to the patient-facing card read.

### 6.7 Tests

- **FR-23.** Extend the portal test suite with a spec for the chips, the
  inline edit, the lock, and the precedence. Keep the existing
  "no times or settings travel" assertion in `portal/tests/overview.mjs`.

## 7. Data Model

### 7.1 Patient per-pen time (device only)

The value lives in `localStorage`, mirroring the per-pen start day. The map
is keyed by pen id and holds an `HH:MM` string.

```text
Pinned: `tca.penstart.` prefix in `patients/jessica/assets/protocol.js`
```

Field rules:

- One entry per pen, keyed by pen id.
- The value matches the real-clock-time pattern `/^([01]\d|2[0-3]):[0-5]\d$/`.
- Clearing the time chip (an empty value) removes the entry, so the pen falls
  back to the chain.
- The value never enters `dayIndex`, `supply`, `occurrences`, or `dosesLeft`.
- The value is reported to the atelier, the same as the per-pen start day.

### 7.2 Atelier per-pen time (in `settings`)

The value lives on the card record, inside `settings`, next to `times`.

```json
{
  "settings": {
    "startDate": "2026-08-13",
    "times": { "Evening": "19:30" },
    "penTimes": { "tirz": "19:30" },
    "rev": 3
  }
}
```

Field rules:

- `penTimes` is keyed by pen id and holds a clock-time string.
- `sanitizeSettings()` keeps only values matching the real-clock-time pattern
  `/^([01]\d|2[0-3]):[0-5]\d$/`.
- Studio renders one row per pen, keyed by the phone's own pen id — twins get
  `#0`/`#1`, matching `hydrateRecord()` — so a Studio value lands on the same
  key `timeFor(pen)` reads.
- An empty per-pen row clears the key, so the pen falls back to the chain.
  Removing a pen from the card clears its key the same way.
- `applySettings()` adopts the value only when `settings.rev` increases.
- `force` raises `rev` even when nothing changed, the same as `startDate`.
- The field travels through `publicView()`, which already returns `settings`.

## 8. Non-Functional Requirements

- **NFR-1 (No build).** The portal stays plain scripts. The chips use native
  date and time inputs. No bundler enters the project.
- **NFR-2 (Privacy).** No new clinical field transits a host without a BAA.
  The per-pen time is a clock time, not PHI. It travels the same two paths as
  the start day.
- **NFR-3 (Compatibility).** The chips work on iOS Safari, Android, and
  desktop. The native inputs must work in the iOS home-screen case.
- **NFR-4 (Failure tolerance).** A card that cannot reach the service still
  shows and edits the chips. The save is local first.
- **NFR-5 (Determinism).** The time never changes the day, the phase, the
  supply, or the streak. Two runs with the same day give the same day math.

## 9. Acceptance Criteria

- **AC-1.** A due pen's card shows a date chip and a time chip between the pen
  name and the remove button.
- **AC-2.** Tapping the date chip shows a native date input with the pen's
  current start date.
- **AC-3.** Tapping the time chip shows a native time input with the pen's
  current effective time.
- **AC-4.** Leaving either field saves the change. The card, the calendar
  signature, and the reminder list reflect the new value.
- **AC-5.** Editing one pen's date or time does not change another pen's
  date or time.
- **AC-6.** After the pen's first logged dose, both chips grey out and each
  shows a lock. Tapping a locked chip shows "Locked — your first logged dose."
- **AC-7.** A locked pen still adopts an atelier override when
  `settings.rev` increases.
- **AC-8.** A time the patient set before the first dose stays in effect
  after the lock.
- **AC-9.** With no patient or atelier time, the effective time falls back to
  the band default from `timeFor(pen)`.
- **AC-10.** The `#btnStart` button is gone. The `?change=1` link still opens
  the schedule sheet.
- **AC-11.** The calendar file contains only UTC instants with the `Z`
  suffix. It contains no `TZID` and no `VTIMEZONE`.
- **AC-12.** `sanitizeSettings()` and `sanitizeState()` keep only real clock
  times — hours 00 to 23, minutes 00 to 59 — for the per-pen time.
- **AC-13.** `/api/overview` still returns no times or settings. The
  `overview.mjs` assertion passes.
- **AC-14.** The new time never changes the day, the phase, the supply, the
  doses left, or the streak.

## 10. Research and Best Practices

The engine computes the schedule, the reminders, and the calendar from one
source, `patients/jessica/assets/protocol.js`. The per-pen start day already
has its own precedence chain in `applyPenStarts()`. The time-of-day extends
that chain.

- **ICS keeps real UTC instants.** `icsUtc()` writes the `Z` suffix and
  `icsInstant()` builds a local-clock `Date`. Floating times and
  `TZID`/`VTIMEZONE` blocks must not return (`protocol.js`, `buildICS`,
  `icsUtc`, `icsInstant`).
  - Verdict: Adopt. Rationale: the file already states the floating-time bug
    in its own comment.

- **Time-of-day is the patient's clock time.** Instants rebuild from the
  local clock on reopen, so a changed timezone or travel follows the phone
  (`protocol.js`, `upcomingDoses`, `scheduledInstant`).
  - Verdict: Adopt. Rationale: this is the current behavior for band times.

- **Push delivery is best-effort.** Keep the 15-minute sweep, the two-hour
  grace, and `sentUpTo` dedupe. The per-pen time only changes which instants
  `upcomingDoses()` emits (`portal/store/subs.js`, `dueNow`; `protocol.js`,
  `upcomingDoses`).
  - Verdict: Adopt. Rationale: the reminder sweep is already correct.

- **Precedence chain.** Extend the start-day chain to the time-of-day:
  atelier value, patient value, first logged dose, band default. The band
  default reads `loadTimes()`, then `TIME_AT`, else `09:00`
  (`protocol.js`, `applyPenStarts`, `timeFor`).
  - Verdict: Adopt. Rationale: the date chain is the working model.

- **Lock at first dose.** Use `firstDoseDay(pen)` as the lock signal. The
  atelier override through `settings.rev`/`force` stays above the lock
  (`protocol.js`, `firstDoseDay`, `applyPenStarts`, `applySettings`).
  - Verdict: Adopt. Rationale: the lock and the override reuse existing
    signals.

- **Dose logging stays day-granular.** The dose id stays
  `slug.template.day`. The lock keys on `firstDoseDay`, not a timestamp
  (`portal/store/doses.js`, `doseId`).
  - Verdict: Adopt. Rationale: changing the key would break dedupe.

- **Supply and phase math keeps whole days.** The time is a separate `HH:MM`
  field, sanitized like the band times. It never enters `dayIndex`, `supply`,
  `occurrences`, `dosesLeft`, or streaks.
  - Verdict: Adopt. Rationale: the day math must stay deterministic.

## 11. Baseline Impact

When this feature lands, update these sections of `specs/000-system.md`:

- `§3.3` (Dose logging): add the lock at first dose.
- `§3.4` (Reminders): note that the per-pen time changes only which instants
  `upcomingDoses()` emits.
- `§3.5` (Calendar export): note that the calendar times come from the
  per-pen time-of-day through instant construction.
- `§4.3` (Card record shape): extend `settings` with the per-pen time map.

## 12. Risks

- **R1 — Native input on iOS home screen.** A native date or time input can
  behave differently in a standalone web app. Mitigate: test the
  `isHomeScreenApp()` case.
- **R2 — Lock message confusion.** A pen locked by a back-filled dose shows
  "first logged dose" even though the patient typed the dose later.
  Mitigate: the message names the first dose, which is still the anchor.
- **R3 — Sheet and chip disagreement.** The schedule sheet edits band times;
  the chip edits the per-pen time. The per-pen value wins, which can read as
  the sheet being ignored. Mitigate: document the precedence in the sheet
  copy.
- **R4 — First-dose time source.** `/api/logged` now returns `days` and
  `firstAt`; `firstAt` keeps the chronologically earliest instant per template
  (compared as epochs, not strings). The card reads the first dose's clock
  time from it. Mitigated in code; the old days-only endpoint no longer
  exists.
- **R5 — Overview leak.** A new field that reaches `/api/overview` breaks the
  privacy contract. Mitigate: keep the overview shape fixed in AC-13.

## 13. Settled Decisions and Open Questions

### Settled decisions

- The time is a per-pen dosing time-of-day. It drives due instants, reminders,
  and calendar times.
- Each pen keeps its own start date and its own time-of-day.
- The date and time lock at the pen's first logged dose. The atelier can still
  override.
- The chips render on one row between the pen name and the remove button,
  ordered name, date chip, time chip, remove button. A tap opens an inline
  native input. The save happens on `change` and on `blur`.
- Locked chips grey out with a lock. The message is "Locked — your first
  logged dose." An atelier-pinned chip shows a ★ and says "Set by the
  atelier." Both stay real buttons that explain themselves on tap.
- The `#btnStart` button is removed. The `?change=1` sheet stays, and shows
  the `#chipNote` that a chip wins over its band times.
- The atelier field is `settings.penTimes`, keyed by the phone's pen ids
  (`ghk#0`/`ghk#1` for twins). `sanitizeSettings()` keeps only real clock
  times. `/api/logged` returns `{ days, firstAt }`; the card derives the first
  dose's clock time from `firstAt`.
- Two same-template pens share one template-keyed dose log and one first-dose
  time.

### Open questions

1. Does the atelier need to see the patient's per-pen time for pens not due
   today? The state report carries the resolved time only in `today` rows
   (active pens), not in `supply` rows. Add it to `supply` if the dashboard
   needs it.

## 14. Glossary

- **pen.** One dispensed treatment on a card.
- **band.** The template's named time slot, for example `Morning` or
  `Evening`.
- **time-of-day.** The clock time a pen is dosed, in `HH:MM`.
- **chip.** The small pill in the dose-card header that shows a date or a
  time.
- **first dose.** The earliest logged dose for a pen, found by
  `firstDoseDay()`. Keyed by `penKeyOf()` (`pen.template`), so two
  same-template pens share one first dose.
- **`firstDoseTime(pen)`.** The clock time of a pen's first logged dose, read
  from the `firstAt` map.
- **lock.** The state after a pen's first dose, where the patient cannot edit
  the date or time.
- **instant.** A UTC timestamp built from the local clock time.
- **floating time.** An iCalendar time with no timezone, which readers
  interpret differently.
- **`timeFor(pen)`.** The function that resolves a pen's band time.
- **`upcomingDoses()`.** The function that lists future dose instants for
  reminders.
- **`buildICS()`.** The function that builds the calendar file.
- **`publicView()`.** The store function that returns the card's public
  fields.
- **`stateReport()`.** The function that reports what the card shows.
