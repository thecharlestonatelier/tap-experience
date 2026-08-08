# Jessica Patient Portal — Handoff

Context for picking this up in a new session. Written 8 Aug 2026.

---

## What exists

A private, per-patient portal for The Charleston Atelier, reached by NFC tap card.
Two pages, both live:

| Page | File | What it is |
|---|---|---|
| Portal | `patients/jessica/index.html` | The ivory landing screen — CA monogram, "Welcome Back, JESSICA", five action cards |
| Today's Ritual | `patients/jessica/ritual.html` | Dosing engine: what to dial today, phases, schedule, pen supply, calendar export |

**Live URL (this goes on the NFC card):** https://atelier-portal-jessica.netlify.app

---

## Deployment

Netlify project **`atelier-portal-jessica`** (site id `7ab07b22-c1dc-4c87-90a9-0de4b834a688`),
connected to GitHub. **Pushing to the branch deploys it — there is no manual step.**

- Repo: `thecharlestonatelier/tap-experience` — **public**
- Branch: `claude/jessica-nfc-patient-portal-4nxcmj`
- **Base directory: `patients/jessica`** ← the setting that matters; it makes the portal the site root
- Build command: empty. Publish directory: `.` (see `patients/jessica/netlify.toml`)

Two dead Netlify projects can be deleted whenever convenient — they are leftovers from
failed deploy attempts and affect nothing: `atelier-portal-jessica-broken`,
`atelier-portal-jessica-unused`.

---

## Environment constraints (read before debugging)

The Claude Code session's egress is allowlisted. **`*.netlify.app`, `api.netlify.com` and
`peptidemind.com` are blocked** — CONNECT returns 403 at the gateway, not from those sites.
GitHub, npm and Google Fonts are allowed.

Consequences:
- You **cannot fetch the live site to verify it.** Confirm deploys from Netlify's deploy
  record (commit SHA, file count, header-rule count) or ask the user to look.
- `WebFetch` is blocked for these hosts too.
- The Netlify MCP `import-claude-design-from-url` tool needs an approval that has not been
  grantable in-session. Irrelevant now — deploys go through git.
- Verify UI work locally with Playwright against a tiny static server (see below).
  Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

**A trap worth remembering:** an early deploy pointed Netlify at a *private* claude.ai
artifact URL. Netlify fetched it server-side, got Claude's "Page not found" page, and
published that as the site. Never deploy from a private URL.

---

## Files

```
patients/jessica/
  index.html        portal landing; buttons are config-driven (PORTAL block at the bottom)
  ritual.html       the dosing engine — pure logic, never needs editing per patient
  protocol.json     ALL clinical content for this patient
  netlify.toml      publish ".", noindex headers, no-cache on index.html
  assets/fonts.css  Cormorant Garamond + Jost as base64 woff2 (shared by both pages)
  files/            drop PDFs here; link them from the PORTAL block
HANDOFF.md          this file (outside the deploy dir, so it is not published)
```

`protocol.json` is the whole interface. A different regimen — or a different patient — is a
data change, not a code change.

---

## The dose model (pens, not syringes)

Peptides are delivered by **prefilled multi-dose pens dialled to a unit setting**, not
syringes drawn to a mark. The patient turns the dial, injects, presses the plunger down and
holds 10 seconds.

**One unit = 0.01 mL.** What a unit *delivers* depends on the pen's blend:

```
mL per dose        = units / 100
mg of component X  = (X.mg / pen.volumeMl) × mL
```

Verified against the printed Atelier cards — every figure reproduces:

| Pen | Phase | Units | mL | Delivers |
|---|---|---|---|---|
| Glow Blend (BPC-157 10 / TB-500 10 / GHK-Cu 50, 3 mL) | Starting | 4 | 0.04 | 0.93 mg total |
| | Ramp-Up | 9 | 0.09 | 2.1 mg |
| | Maintenance | 13 | 0.13 | 3.03 mg |
| Tesa/Ipa (Tesamorelin 12 / Ipamorelin 3, 3 mL, 4:1) | Week 1–2 | 62 | 0.62 | 2.48 mg tesa |
| | Week 3–4 | 87 | 0.87 | 3.48 mg |
| | Week 5+ | 112 | 1.12 | 4.48 mg |

Supply is simulated dose by dose, opening a fresh pen when the next dose no longer fits, so
run-out dates stay correct across phase step-ups.

---

## ⚠️ Open clinical question — needs the physician, not a developer

**At the stated dial settings, Tesa/Ipa cannot be a month's supply.** A 3 mL pen holds
4.8 doses at 62 units and 2.7 doses at 112 units. Running 5 days/week for four weeks needs
about 90 mg of tesamorelin; the pen contains 12 mg. The simulation reaches **pen 6 within
four weeks**, while Glow Blend is still on pen 1.

Either the click counts, the pen concentration, or the frequency is off by roughly 7×.
Glow Blend is internally consistent (23 doses ≈ 32 days). The Supply tab will keep saying
"runs out in 2 days" until this is resolved — that is the arithmetic, not a bug.

(Separate from, though related to, the Ipamorelin under-dosing note already on the card,
which is carried into the app as an advisory.)

---

## Decisions made, and why

- **Structure mirrors peptidemind.com/protocols/102** (the reference the user gave) but is
  rendered in the Atelier palette and serif, so it reads as one system with the portal
  rather than a blue-and-white SaaS page.
- **Fonts are inlined as base64** so the page renders with zero external requests — it
  loads instantly on a tap and can't flash a fallback face.
- **Lining figures are forced** (`font-feature-settings: 'lnum'`). Cormorant defaults to
  old-style numerals, which render 10 as "IO". Unacceptable on dosing information.
- **The patient sets her own start day** (picker on first open, changeable after). The whole
  schedule — on/off rhythm, phase transitions, refills, calendar — counts from it. This also
  removed the need to decide whether "5 on / 2 off" anchors to Monday.
- **Injection tracking is OFF** (`protocol.tracking: false`). Log button, adherence strip and
  the NFC tap-to-log deep link are all gated on it. Nothing was deleted; flipping the flag
  restores all three (tested both ways).

---

## Assumptions still baked in — confirm before Jessica uses it

1. `startDate: "2026-07-13"` is a placeholder (though the patient's own picker overrides it).
2. Glow Blend phase lengths — **not on the card**; 14/14/ongoing assumed.
3. "5 days on / 2 off" runs as a rolling cycle from the start day.
4. Both pens are assumed to be Jessica's, running concurrently.

---

## Next steps discussed

**PWA** — unblocked, no backend needed, ~1 hour. Manifest + service worker gives a
home-screen icon, full-screen launch, offline, and (iOS 16.4+, once installed) real push
notifications for daily reminders. This is the recommended next build.

**Practice Better integration** — the user has an API key. It must be set as a Netlify
environment variable named `PRACTICE_BETTER_API_KEY` (Site configuration → Environment
variables), marked "Contains secret values", **All scopes** (specific scopes are paywalled on
their plan), and the value set for the Production context. A Netlify Function then reads
`process.env` — the key never touches the repo, the browser, or a chat transcript.
**Never accept the key pasted into conversation.**

**NFC tags** — NTAG213 stickers, ~$0.30. Encode the *product and lot*, not the patient, so
tags can be pre-printed in bulk and any pen tag works for any patient; identity comes from
the phone. iPhone XS+ reads them with no app, but it is two taps (tag → banner → page), not
zero. Apple exposes nothing more automatic. Foil seals and metal barrels need on-metal tags.

---

## Privacy notes

- The repo is **public** and the site URL is **unlisted but guessable**, and contains the
  patient's first name. `noindex` headers are set, but treat the URL as shareable-by-anyone.
- A better long-term shape: one shared app plus per-patient JSON addressed by an unguessable
  token (`/p/k7x2m9`), rather than a folder named after the patient.
- Netlify does not sign BAAs on standard plans. Any injection log that leaves the device is
  PHI in a non-covered system — which is why tracking is device-only, and why Practice Better
  is the right system of record if tracking comes back.

---

## Verifying UI changes locally

```js
// serve patients/jessica on a port, then drive it
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
await p.clock.setFixedTime(new Date('2026-07-15T10:00:00'));  // land on a dosing day
await p.route('**://*/**', r =>
  r.request().url().includes('localhost') ? r.continue() : r.abort());  // prove self-contained
```

Freezing the clock matters: with a 5-on/2-off cycle, most real "today"s are rest days and the
dose card won't render at all.
