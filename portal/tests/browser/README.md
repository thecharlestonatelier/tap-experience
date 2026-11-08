# Browser tests

Pin the patient pages in a real browser before changing the front-end.

```sh
cd portal
npm run test:browser
```

That wraps `node --test tests/browser/` in `firebase emulators:exec
--only auth --project atelier-tap`, so the Auth emulator (the sign-in gate)
starts and stops with the suite. One-time setup: `npx playwright install
chromium`.

## What it pins

- the ritual page loads the protocol and renders a pen, and the engine
  resolves a dose in the browser (`doseOn`),
- opening a card records a tap through the page's own `fetch`,
- a peptide the patient adds reaches the record (`/api/added`),
- the reminder switch subscribes (`/api/push/key`, `/api/push/subscribe`),
  survives a reload (refreshes the schedule) and unsubscribes
  (`/api/push/unsubscribe`),
- every portal page (`calendar`, `cards`, `expect`, `storage`, `tutorial`,
  `library`) renders with a card and no errors,
- a legacy fragment card (`?card=legacy`) loads the static `protocol.json`.

## Coverage

`coverage.mjs` runs the scenarios with V8 coverage and reports line coverage
and the engine endpoints hit:

```sh
cd portal && firebase emulators:exec --only auth --project atelier-tap \
  --config ../firebase.json "node tests/browser/coverage.mjs"
```

Current: `protocol.js` ~72% of executable lines, and **all 11 engine
endpoints — all 14 `fetch` call sites** — are exercised.



`harness.mjs` runs the real portal on a file store and seeds cards through
the clinician API; `auth-session.mjs` signs the page in as a fake Google
account against the emulator. The pages pull the Firebase SDK from a CDN, so
the machine needs network access.

This is the safety net for the clean-architecture split of the dosing engine
(`patients/jessica/assets/protocol.js`): the engine/I-O move must leave
these green.
