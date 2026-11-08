# Decision: when two pens share a template, should each pen keep its own dose log?

## Question

Should each pen keep its own dose log when two pens share a template?

## Why now

- 2026-11-01 20:06 human: approved gate v1, including decision (3), which recorded "two same-template pens share a lock" as benign.
- 2026-11-01 21:19 qa: reproduced five symptoms against a real service. The second pen's dose returns `{duplicate:true}` and is never written; logging one pen marks the other as taken and locks its start day.
- 2026-11-01 21:27 builder: confirmed the same five symptoms, and reported that SPEC-003 §4 freezes the dose-log key and NFR-2 forbids a new endpoint, so it escalated instead of editing the spec.
- 2026-11-01 21:28 lead: accepted the escalation and routed it back to design to reopen decision (3).
- 2026-11-01 21:32 design: reopened decision (3) and parked TAP-EXPERIENCE-1 on the human.

## Impact

| Dimension | A · key the log by pen.id | B · block same-template pens |
|---|---|---|
| The patient | Two identical pens log doses independently, and each keeps its own start day. The feature works as asked. | Clinics cannot prescribe two identical pens. They must create two templates instead. |
| Existing data | Needs a migration of template-keyed doses. A migration that fails halfway can double-count a dose or drop history. | No migration. Records that already hold two same-template pens keep losing the second dose. |
| Code and files touched | `/api/dose`, `/api/logged`, `store/doses.js`, `protocol.js`, the ICS UID. | Card Studio, `hydrateRecord`, and one note in the spec. |
| Effort | A spec amendment, a migration plan, and about three phases. The migration size is unknown until one count query runs. | One phase. |
| Undo | Yes, through a dual-read window. Once the backfill deletes the old keys, the reversal stops being possible. | Yes, remove the guard. |
| Rules reopened | SPEC-003 §4 and NFR-2. | Nothing. |

## Options

### A — key the dose log by pen.id

- Effect: the second identical pen records its own dose, and its start day no longer moves to the first pen's.
- Cost: three phases, plus a migration whose size nobody knows until a count query runs. A failed migration can double-count or drop doses.
- Undo: yes, through a dual-read window; the backfill that removes the old keys closes that window.
- Reopens: SPEC-003 §4 and NFR-2.

### B — block same-template prescriptions

- Effect: a clinic cannot create two identical pens, so a new patient cannot hit the silent drop.
- Cost: one phase, at the price of removing a configuration the app supports today, and existing two-pen records keep the bug.
- Undo: yes, remove the guard.
- Reopens: Nothing.

## Recommendation

QA recommends A, because a dropped dose in a medication log is not a limitation that can be documented away. Builder agrees on the root cause and cannot amend the spec from its seat. Design reopened the decision with no preference. The recommendation is QA's, not the team's.

## If nothing changes

The branch stays at `1bc71ee`, unmerged. The per-pen start date stays incomplete for exactly the patients who have two identical pens, and every one of them keeps losing the second dose of the day.

## Evidence

- `portal/tests/test_explorer_findings.mjs` reproduces all five symptoms and fails as expected. It is still uncommitted in the worktree.
- Branch `feature/dosage-tracking` at `1bc71ee`, never merged.
- Seven QA defensive tests at `0c7be72` and four builder suites pass.
- Gate v1, approved 2026-11-01 20:06, holds the decision (3) text this replaces.

## After the decision

Design republishes the gate as v2 with the recorded choice. Architect amends SPEC-003 and the plan. Builder implements the chosen option. QA re-runs the proving test. The parked design task resumes as soon as the choice is recorded, and hands to the architect.
