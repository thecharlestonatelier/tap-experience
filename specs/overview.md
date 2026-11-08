# Specification Overview

One map of the specification set. Each file owns one subsystem or one change.

## The map

| File | Subsystem |
|---|---|
| `000-system.md` | System baseline. The whole Charleston Atelier tap card portal. |
| `2026-10-22-001-first-tap-auth.md` | First-tap authentication. The Google sign-in gate and card linking. |
| `2026-10-23-002-email-password-auth.md` | Email and password authentication, next to the Google sign-in. |
| `2026-10-27-003-start-time-customization.md` | Protocol start date and time customization. The per-pen chips and the lock. |

## How to read the set

`000-system.md` is the living baseline. It states the system as it is now.
The dated files record one change each. They state the goals, the
requirements, and the acceptance criteria for that change. When a dated
change lands, its baseline impact is folded into `000-system.md`. The dated
text is not edited afterwards.

Each dated file follows one shape:

- Overview
- Goals and Non-Goals
- Current Behavior
- Invariants and Scope Boundary
- User Flows
- Functional Requirements
- Data Model
- Non-Functional Requirements
- Acceptance Criteria
- Research and Best Practices
- Baseline Impact
- Risks
- Settled Decisions and Open Questions
- Glossary

Write in ASD-STE100 simplified technical English. Number requirements with
`FR-` and acceptance criteria with `AC-`. Make every acceptance criterion
testable.
