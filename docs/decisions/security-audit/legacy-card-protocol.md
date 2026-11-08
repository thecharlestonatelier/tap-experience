# Decision: should the legacy fragment card keep a public protocol.json, or be retired for slug-scoped cards?

## Question

Should the legacy fragment card be retired in favour of slug-scoped cards, or kept with a scrubbed public protocol?

## Why now

- 2026-11-07 19:20 audit: the full audit recorded `acl.protocol-json-static` as high — the deployed web root serves `patients/jessica/protocol.json` to anyone with no credential.
- 2026-11-08 03:48 builder: the hardened sandbox reproduced `GET /protocol.json` returning 200 `application/json`, 3581 bytes, with the patient object, a phone pattern, and the regimen.
- 2026-11-08 03:55 builder: removed the prescriber phone and the hardcoded SMS fallbacks from `protocol.json` and `templates.json`; the patient name and the regimen remain because the legacy page needs them.
- 2026-11-08 04:00 lead: full closure needs a product decision. The legacy fragment card carries the protocol in the URL fragment and has no server-side credential, so no route change can make that file confidential.

## Impact

| Dimension | A · retire legacy fragment cards | B · scrub and keep the public config |
|---|---|---|
| The patient | Every legacy tag stops working until a slug-scoped card is issued. | Legacy tags keep working. The regimen stays readable by anyone who finds the URL. |
| Existing data | No data migration. Physical tags in the field must be reissued, and a tag already on a card cannot be changed remotely. | No migration. The published file stays the source for every legacy card. |
| Code and files touched | `protocol.json`, the legacy fetch in `protocol.js`, the static route, the tag issue process. | `protocol.json` (already partly scrubbed), `protocol.js`, `templates.json`, `expect.html`, `storage.html`. |
| Effort | One inventory of tags in the field, one reissue round, one code removal. The long pole is the reissue. | One phase; already started. |
| Undo | Re-enable the legacy route from the previous image. Once the old image and file are gone, that stops being possible. | Restore the old file. The exposure returns exactly as it was. |
| Rules reopened | The legacy-card compatibility promise, if one is recorded. | The PHI confidentiality invariant for the legacy path. |

## Options

### A — retire legacy fragment cards

- Effect: a legacy tag no longer opens a public protocol. Every patient must hold a slug-scoped card, whose slug is the credential.
- Cost: the field count of legacy tags is unknown; each one must be physically replaced, and a card already in a wallet cannot be updated remotely.
- Undo: redeploy the previous image and keep the old `protocol.json`; after the file and image are discarded, the old tags stay dead.
- Reopens: the legacy-card compatibility promise, if one exists.

### B — scrub and keep the public config

- Effect: legacy tags keep working, and the public file no longer carries the prescriber phone or the prescriber's name. The regimen and the patient name remain public.
- Cost: one phase, already partly done. The residual regimen exposure is permanent and cannot be closed without removing the file.
- Undo: restore the old file; the phone and prescriber name return with it.
- Reopens: the PHI confidentiality invariant for the legacy path.

## Recommendation

Security recommends A, because a bearer address is the only model that gives the protocol a credential, and the legacy fragment has none. The product owner must supply the count of legacy tags in the field: if that count is small, A is cheap; if it is large, B is the interim and A becomes a scheduled migration. Design has no preference recorded. The recommendation is Security's, not the team's.

## If nothing changes

The patient name and regimen stay readable at `/protocol.json` indefinitely. The audit finding remains partially mitigated rather than closed, and every future audit must re-open it. The prescriber phone stays removed, but a stranger can still read the schedule.

## Evidence

- `patients/jessica/protocol.json` — still carries `patient.name` and the regimen; the `concierge.phone` line is gone.
- Sandbox run `security/sandbox/out/20261108T034839Z/evidence/protocol-json.json`: `protocol_status:200`, `contains_phone_pattern:false`, `contains_prescriber_name:false`, `contains_regimen:true`.
- Commit `85e1118` on `security/2026-11-08-lifecycle-and-egress` — the partial scrub and the lifecycle fixes.
- Audit artifact `~/security-audit-skill/tap-experience/run-1/findings.json`, fingerprint `acl.protocol-json-static`.
- `patients/jessica/assets/protocol.js` fetches `/protocol.json` for the legacy fragment path; no slug is sent.

## After the decision

Product owner counts the legacy tags in the field and records the number on this decision. If A: issue slug-scoped cards, remove `/protocol.json` from the web root, and let the legacy route fall through to 404 with a printed notice. If B: replace `patient.name` with a neutral label in the file, keep the regimen, and add the residual exposure to the risk register. Security re-runs the sandbox `protocol-json` check after either path.
