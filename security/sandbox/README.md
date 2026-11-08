# Security-audit sandbox

A hardened, offline container for the dynamic half of the `security-audit`
run. It exists because the audit host cannot provide the OS-enforced sandbox
the skill requires, which forced the first run to stop at source analysis.

## What it gives you

| Requirement | How | Verified by |
|---|---|---|
| Empty allowlisted environment | only the `-e` vars in `run.sh`; image ENV is allowlisted in `probes.mjs` | `probes.mjs` `env-allowlist` |
| No external network | `--network none` | TCP + DNS probes |
| Read-only target/toolchain | `--read-only`, repo mounted `:ro` | write probes for `/repo` and `/app` |
| Scratch-only writes | tmpfs `/work` (512 MB, `noexec`, `nosuid`) | `scratch-writable` |
| CPU / memory / pids | `--cpus=1 --memory=1g --pids-limit=128` | inside cgroup + `docker inspect` |
| File-size limit | `--ulimit fsize=5242880` | `ulimit -f` + `docker inspect` |
| Wall clock | host-side deadline (`SANDBOX_TIMEOUT`) | `run.sh` |
| No privilege escalation | `--cap-drop=ALL --security-opt=no-new-privileges --user 1000:1000` | `probes.mjs` + `docker inspect` |
| Scratch promotion | `promote.mjs`: path confinement, `O_NOFOLLOW`, regular files only, 2 MB/file + 16 MB total | `promotion.json` |

The parent verifies containment with `docker inspect` **before** trusting any
result (`containment.mjs`). If the container was not actually run with those
flags, the run aborts.

## Run

```sh
security/sandbox/run.sh probe      # controls only
security/sandbox/run.sh file       # file-store reproductions
security/sandbox/run.sh firestore  # Firestore-emulator reproductions
security/sandbox/run.sh all        # everything (default)
```

Artifacts land in `security/sandbox/out/<UTC>/`:

- `provenance.json` — HEAD, dirty files, image, runtime Node, run flags
- `containment.json` — the `docker inspect` assertions
- `evidence/` — promoted JSON results and screenshots/logs
- `evidence/promotion.json` — per-file size and SHA-256

`out/` is gitignored.

## Reproductions

| Script | Lead | Decisive assertion |
|---|---|---|
| `repro/xss-state.mjs` | stored XSS via device state | `window.__xss === 1` after a clinician opens the card |
| `repro/xss-activation.mjs` | stored XSS via activation name | `window.__xss === 2` after the LINKED pill is opened |
| `repro/feed-delete.mjs` | feed survives card deletion | `/ics/<slug>` returns 200 + marker after DELETE and after re-mint |
| `repro/slug-reuse.mjs` | slug reuse carries old authority | state/dose/added writes by the old holder land on the new card |
| `repro/protocol-json.mjs` | unauthenticated PHI | `GET /protocol.json` is 200 and contains the patient object and a phone pattern (body redacted) |
| `repro/push-endpoint.mjs` | arbitrary push endpoint | the sweep POSTs to the attacker's loopback endpoint with `aes128gcm` |

`firestore-suite.mjs` re-runs the two lifecycle scenarios against the
Firestore emulator (`--only firestore`) with `CARD_STORE=firestore`.

## Limits

- **Emulator ≠ production.** It proves application logic, not Firestore IAM,
  Cloud Run env, Secret Manager, or provider log retention. Those stay
  owner-observed checks.
- **Runtime is the Playwright base image's Node, not `node:20-slim`.** The
  exact version is recorded in `provenance.json`. The application uses
  standard Node APIs; this is a fidelity note, not a behaviour change.
- **`xss-activation` seeds the persisted `activatedBy` shape** that
  `linkFromToken` writes. The token-to-store path is source-confirmed; the
  reproduction proves the sink executes.
- **`protocol-json` uses the sandbox image's `/app/public`**, which mirrors
  `Dockerfile`'s `COPY patients/jessica ./public`. It does not build the
  production image itself.
- The patient pages load the Firebase SDK from a CDN. The XSS repros go to
  `/studio/`, which does not use Firebase, so no network is needed. The
  patient-page browser suite would need the SDK vendored.

## Adding a reproduction

1. Add `repro/<name>.mjs` that imports `guard`/`startPortal` from `lib.mjs`
   and emits one JSON object.
2. Add the name to `FILE_REPROS` in `entrypoint.sh`.
3. Keep evidence to predicates, lengths, and hashes — never patient content.
