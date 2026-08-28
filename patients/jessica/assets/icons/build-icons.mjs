import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const SRC = 'icon-master-1254.png';
const R = 253 / 1254;   // measured corner radius, as a fraction of the side
const HERE = pathToFileURL(import.meta.dirname + '/').href;

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--allow-file-access-from-files']
});
const p = await b.newPage();
await p.goto(HERE);

const files = await p.evaluate(async ({ SRC, R }) => {
  const img = new Image();
  img.src = SRC;
  await img.decode();
  const N = img.width;

  // Read the art once so the sage can be sampled from it.
  const ref = document.createElement('canvas');
  ref.width = ref.height = N;
  const rg = ref.getContext('2d');
  rg.drawImage(img, 0, 0);
  const px = rg.getImageData(0, 0, N, N).data;
  const at = (x, y) => {
    const i = ((y | 0) * N + (x | 0)) * 4;
    return `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`;
  };

  // The ground the art sits on is a vertical gradient. Sample it down the
  // left margin, well inside the frame but clear of the monogram, so the
  // fill behind the corners matches the tile edge it meets.
  // Sample points are pulled toward the centre column near the top and
  // bottom, where the left margin is still inside the corner arc.
  const SAMPLES = [
    [0.00, 0.50, 0.055], [0.06, 0.50, 0.060], [0.20, 0.12, 0.200],
    [0.40, 0.09, 0.400], [0.60, 0.09, 0.600], [0.80, 0.12, 0.800],
    [0.94, 0.50, 0.940], [1.00, 0.50, 0.945]
  ];
  const STOPS = SAMPLES.map(([t, sx, sy]) => [t, at(N * sx, N * sy)]);

  const make = (S, mode) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';

    // `trim` shaves the source's own outer shadow rim, which otherwise reads
    // as a dark ring once the black corners are replaced with sage.
    const tile = (x, y, w, h, trim = 0) => {
      g.save();
      g.beginPath();
      g.roundRect(x + trim, y + trim, w - 2 * trim, h - 2 * trim, (w - 2 * trim) * R);
      g.clip();
      g.drawImage(img, x, y, w, h);
      g.restore();
    };

    const sageGround = () => {
      const grad = g.createLinearGradient(0, 0, 0, S);
      for (const [t, col] of STOPS) grad.addColorStop(t, col);
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
    };

    if (mode === 'rounded') {
      tile(0, 0, S, S);                            // transparent corners
    } else if (mode === 'square') {
      sageGround();                                // iOS applies its own mask
      tile(0, 0, S, S, S * 0.018);
    } else if (mode === 'maskable') {
      sageGround();
      // A maskable icon can be cropped to a circle, so the whole tile —
      // corners of the gold rule included — has to fit inside the safe
      // circle. A square fits a circle only across its diagonal.
      const inner = S * 0.80 / Math.SQRT2, off = (S - inner) / 2;
      tile(off, off, inner, inner, inner * 0.018);
    }
    return c.toDataURL('image/png');
  };

  // The bare mark, for the portal header — the same gold, no ground.
  // The sage is keyed out on warmth (red minus blue) rather than on
  // brightness: the mark runs from near-white highlight to a dark bevel and
  // so overlaps the ground's brightness range, but never its hue.
  const monogram = (H) => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const im = g.getImageData(0, 0, N, N), d = im.data;

    const MARGIN = 0.085;          // excludes the gold rule and everything outside it
    const LO = 30, HI = 52;        // warmth ramp: ground ~16-25, mark ~55-90
    let x0 = N, y0 = N, x1 = 0, y1 = 0;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        const outside = x < N * MARGIN || x > N * (1 - MARGIN) ||
                        y < N * MARGIN || y > N * (1 - MARGIN);
        let a = outside ? 0 : (d[i] - d[i + 2] - LO) / (HI - LO);
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        d[i + 3] = Math.round(a * a * (3 - 2 * a) * 255);   // smoothstep: soft edges
        if (a > 0.35) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    g.putImageData(im, 0, 0);

    const pad = Math.round(N * 0.012);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(N - 1, x1 + pad); y1 = Math.min(N - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;

    const out = document.createElement('canvas');
    out.height = H;
    out.width = Math.round(w / h * H);
    const og = out.getContext('2d');
    og.imageSmoothingQuality = 'high';
    og.drawImage(c, x0, y0, w, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  };

  return {
    'icon-512.png':          make(512, 'rounded'),
    'icon-192.png':          make(192, 'rounded'),
    'icon-180.png':          make(180, 'square'),
    'icon-120.png':          make(120, 'square'),
    'icon-512-maskable.png': make(512, 'maskable'),
    'monogram.png':          monogram(480),   // header shows it at 78px; 480 covers 3x
    _sage: STOPS
  };
}, { SRC, R });

const stops = files._sage; delete files._sage;
console.log('sampled sage:', stops.map(s => s[1]).join('  '));
for (const [name, uri] of Object.entries(files)) {
  fs.writeFileSync(name, Buffer.from(uri.split(',')[1], 'base64'));
  console.log(name, fs.statSync(name).size, 'bytes');
}
await b.close();
