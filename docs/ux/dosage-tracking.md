# UX Findings — dosage-tracking (TAP-EXPERIENCE-1)

Seat: `builder` · Pod: `build` · Phase: SPEC-003 implementation
Date: 2026-11-01

## Scope

This phase changes the patient-facing ritual page (`ritual.html`) and the
print card (`schedule-card.html`). Static UX checkers were run against both
files; the browser gates and the runtime suites ran against a local service
(`PORT=8177`, auth emulator on `127.0.0.1:9099`).

## Static checker receipts

| Checker | File | Result |
|---|---|---|
| `check-ui-slop.py` | `ritual.html` | 2 findings (both pre-existing) |
| `check-ui-slop.py` | `schedule-card.html` | PASS |
| `check-states.py` | `ritual.html` | 1 finding (pre-existing) |
| `check-states.py` | `schedule-card.html` | PASS (no interactive elements) |
| `check-microcopy.py` | `ritual.html` | 1 finding (pre-existing) |
| `check-microcopy.py` | `schedule-card.html` | PASS |

## Findings

All findings are **pre-existing** and are not introduced by this change. None
is Critical or Major; none blocks the handoff.

1. **`outline: none` without a `:focus-visible` replacement** —
   `ritual.html:582` (`.date-field:focus`). This is the setup-wizard number
   field's focus style, untouched by this change. The new controls use a
   visible focus ring (`.time-field:focus { outline: 2px solid var(--brass) }`
   and native focus on the `.start-day` button).
2. **Middle-dot metadata chain** — `ritual.html:1242` (the dose-meta `comp ·
   volumeMl` line). Pre-existing. This change actually reduced the adjacent
   line from three middle-dot items (`time · prettyTime · route`) to one
   (`time · route`).
3. **No `:hover` rule for interactive elements** — the portal is a touch-first
   iOS home-screen app; hover is intentionally absent across the whole
   portal, not just here.
4. **`Continue` names no outcome** — `ritual.html:720`, the setup wizard's
   advance button. Pre-existing and out of scope for this spec.

## What this change verified in the browser

- No page error on boot (fragment card path, both single and two-pen).
- The per-pen start control renders in the today stack and the rhythm sheet.
- The start-day button opens the per-pen calendar; the modal title names the
  pen ("When did you start GHK-Cu?").
- Picking a day moves only that pen's start day.
- The time field writes the per-pen time and the card redraws in step.
- A locked pen renders the start day and time as plain text (no editable
  control), matching the state matrix.

## State matrix (implementation vs. contract)

| State | Contract | Implemented |
|---|---|---|
| Default (no dose, no atelier day) | "Started [date]" button + time field | yes |
| Locked (first dose) | plain text, tap → toast | yes |
| Atelier-set (no dose) | date plain text, time editable | yes |
| Empty (no start day) | falls back to protocol day; calendar auto-opens | yes |

## Verdict

Ship. No Critical or Major findings. The three pre-existing Minor findings are
recorded for a future polish pass and are unrelated to the per-pen start/time
work.
