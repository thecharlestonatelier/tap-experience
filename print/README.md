# Print

`portal-card.html` — the two-sided 5 × 7 card handed to a patient with her tap
card. Side one is the portal home screen with each button named in plain words;
side two is Today's Ritual with the dial number, the supply gauge and the
calendar button called out.

The page is drawn at 480 × 672 px, which is exactly 5 × 7 in at the 96dpi
browsers print at, and `@page` is set to match. **Print at 100% with scaling
off**, double-sided, flip on the short edge.

The fonts are pulled from `patients/jessica/assets/fonts.css` at build time so
the card sets in the same Cormorant Garamond and Jost as the portal itself.
To rebuild the standalone file:

```
python3 - <<'PY'
fonts = open('patients/jessica/assets/fonts.css').read()
body  = open('print/portal-card.html').read()
title, rest = body.split('\n', 1)
open('print/portal-card.build.html','w').write(
    title + '\n\n<style>\n' + fonts + '\n</style>\n' + rest)
PY
```

The phone screens are hand-drawn replicas, not screenshots, so they stay crisp
at print resolution. Callout positions are measured off the rendered screens
rather than estimated — if the mock changes, re-measure and update each
callout's `--y`.
