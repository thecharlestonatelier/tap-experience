# Icons

`icon-master-1254.png` is the artwork as supplied — 1254×1254, **no alpha**.
Outside its rounded tile the pixels are black, not transparent, which is why
nothing here uses it directly.

Everything else is generated from it by `build-icons.mjs`:

| File | Shape | Used by |
|---|---|---|
| `icon-512.png`, `icon-192.png` | rounded, transparent corners | `rel=icon`, manifest `purpose: any`, push notifications |
| `icon-180.png`, `icon-120.png` | full-bleed square, opaque | `apple-touch-icon` |
| `icon-512-maskable.png` | tile inside the safe circle | manifest `purpose: maskable` |

Three shapes because the platforms disagree:

- **iOS** masks `apple-touch-icon` into its own superellipse and renders any
  alpha as **black**. A pre-rounded transparent icon gives black corners on the
  home screen, so those two are square and opaque — the sage is extended to the
  edges with a gradient sampled from the art's own margin.
- **Android** may crop a `maskable` icon to a **circle** of 80% the icon's
  width. A square only fits a circle across its diagonal, so the tile is drawn
  at 80%/√2 ≈ 57% — that keeps the corners of the gold rule from being cut.
- Browsers want the tile as drawn, with the corners actually transparent.

## Regenerating

    cd <this directory>
    node build-icons.mjs        # needs playwright; writes all five PNGs

It rasterises through headless Chromium, so the downscale is the browser's own
and the hairline rule survives. If the artwork is replaced, re-measure the
corner radius (`R`) — it is a fraction of the side, currently 253/1254.

## One thing to know

iOS snapshots the icon when a tile is added to the home screen. Changing these
files does **not** update a tile that already exists; it has to be removed and
re-added.
