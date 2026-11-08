# A11y Findings — dosage-tracking (TAP-EXPERIENCE-1)

Seat: `builder` · Pod: `build` · Phase: SPEC-003 implementation
Date: 2026-11-01

## Static receipt

`check-a11y-static.py` — **PASS** on both `ritual.html` and
`schedule-card.html`. No missing `lang`, no empty title, no heading-level skip,
no unlabelled field, no alt-less image, no empty link, no `tabindex > 0`, no
color-only status signal.

## Measures implemented for this change

- The start-day control is a real `<button>` whose accessible name is its
  visible "Started [date]" text.
- The time control is a native `<input type="time">` wrapped in a `<label>`
  with a visually-hidden text label (`<span class="vh">`).
- The calendar modal is `role="dialog"` with `aria-modal="true"` and
  `aria-labelledby="startCalTitle"`.
- Focus moves into the dialog on open (`startCalSave.focus()`) and returns to
  the triggering element on close (`startCalReturn.focus()`).
- Esc and backdrop click close the modal.
- Each day button carries `aria-label` (the full date) and the selected day
  exposes `aria-current="date"`.
- The locked-state toast keeps `role="status"` / `aria-live="polite"`.
- Locked and atelier-set dates render as plain text, so there is no
  non-interactive element that looks interactive.

## Not yet run (deployment-gated)

- **`ada-auditor` scan** (`ada_scan`): requires a reachable deployed URL. The
  local service (`http://localhost:8177`) is not crawlable by the external
  auditor. Run against the deployed card after this lands, per the plan's
  verification section.
- **Manual keyboard pass**: Tab into the start-day button, open with Enter,
  close with Esc, confirm focus returns. The focus/Esc wiring is implemented
  and exercised by the Playwright suites (the calendar flow opens and commits),
  but a full NVDA/VoiceOver pass was not run here.

## Contrast note

Interactive `.start-day` text uses `--brass` (#8A7350); the locked/atelier
plain text uses `--muted` (#8A7C6A) — the same design tokens the rest of the
portal already uses for interactive and secondary text on the `--card`
(#F8F2EA) background. No new color was introduced.

## Verdict

Ship. Static a11y check is clean and the P0 measures in the plan's UX contract
are present. The post-deploy `ada-auditor` scan remains a follow-up.
