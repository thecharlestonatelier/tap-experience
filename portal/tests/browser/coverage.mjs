/* Measure what the browser harness exercises. Each scenario runs in its own
   page (sign-in happens once, the session persists), coverage is collected
   per scenario and unioned by URL. Also lists the same-origin endpoints the
   pages actually call.
     firebase emulators:exec --only auth --project atelier-tap \
       --config ../firebase.json "node tests/browser/coverage.mjs" */
import { chromium } from 'playwright';
import { startPortal, seedCard, stubPush } from './harness.mjs';
import { signInGoogle } from '../auth-session.mjs';

function paint(source, functions) {
  const covered = new Uint8Array(source.length);
  const ranges = [];
  for (const fn of functions || []) for (const r of fn.ranges || []) ranges.push(r);
  ranges.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
  for (const r of ranges) {
    const val = r.count > 0 ? 1 : 0;
    for (let i = r.startOffset; i < r.endOffset && i < covered.length; i++) covered[i] = val;
  }
  return covered;
}
function lineStats(source, covered) {
  const lines = source.split('\n');
  let off = 0, total = 0, exec = 0;
  for (let n = 0; n < lines.length; n++) {
    const start = off, end = off + lines[n].length;
    off = end + 1;
    const t = lines[n].trim();
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) continue;
    total++;
    let any = false;
    for (let i = start; i < end; i++) if (covered[i]) { any = true; break; }
    if (any) exec++;
  }
  return { exec, total };
}

const portal = await startPortal();
const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['notifications'], viewport: { width: 420, height: 900 } });

// Sign in once; the session persists in the context.
const auth = await ctx.newPage();
await auth.goto(`${portal.base}/`);
await signInGoogle(auth);
await auth.close();

const stamp = Date.now().toString(36);
const card = await seedCard(portal.base, { slug: `c${stamp}.t`, name: 'Cov', status: 'active', pens: [{ template: 'ghk' }], settings: { startDate: '2026-07-13', times: {}, rev: 1 } });
await seedCard(portal.base, { slug: `r${stamp}.t`, name: 'Rem', status: 'active', pens: [{ template: 'glow' }], settings: { startDate: '2026-07-13', times: {}, rev: 1 } });

const union = new Map();   // url -> { source, covered }
const requests = new Set();

async function scenario(push, run) {
  const page = await ctx.newPage();
  page.on('request', r => {
    try { const u = new URL(r.url()); if (u.origin === portal.base) requests.add(u.pathname); } catch {}
  });
  if (push) await stubPush(page);
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  try { await run(page); } finally {
    const entries = await page.coverage.stopJSCoverage();
    for (const e of entries) {
      if (!e.source) continue;
      const cov = paint(e.source, e.functions);
      const prev = union.get(e.url);
      if (prev) { for (let i = 0; i < prev.covered.length; i++) if (cov[i]) prev.covered[i] = 1; }
      else union.set(e.url, { source: e.source, covered: cov });
    }
    await page.close();
  }
}

await scenario(false, async p => {
  await p.goto(`${portal.base}/ritual.html?c=c${stamp}.t`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });
  await p.waitForTimeout(600);
  await p.evaluate(async () => { const t = await loadTemplates(); addPen(t.templates.find(x => x.id === 'bpc')); renderAll(); });
  await p.waitForTimeout(800);
});

await scenario(true, async p => {
  await p.goto(`${portal.base}/r${stamp}.t`);
  await p.waitForSelector('body.resolved', { timeout: 15000 });
  await p.waitForSelector('#remindBtn', { timeout: 10000 });
  await p.click('#remindBtn');
  await p.waitForFunction(() => document.getElementById('remindBtn')?.dataset.state === 'on', null, { timeout: 10000 });
  await p.reload();
  await p.waitForSelector('body.resolved', { timeout: 15000 });
  await p.waitForFunction(() => document.getElementById('remindBtn')?.dataset.state === 'on', null, { timeout: 10000 });
  await p.click('#remindBtn');
  await p.waitForTimeout(500);
});

for (const pg of ['calendar.html', 'cards.html', 'expect.html', 'storage.html', 'tutorial.html', 'library.html']) {
  await scenario(false, async p => {
    await p.goto(`${portal.base}/${pg}?c=c${stamp}.t`);
    await p.waitForTimeout(1200);
  });
}

await scenario(false, async p => {
  await p.goto(`${portal.base}/ritual.html?card=legacy`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });
});

for (const [url, info] of union) {
  if (url.endsWith('/assets/protocol.js')) {
    const s = lineStats(info.source, info.covered);
    console.log(`protocol.js         lines ${s.exec}/${s.total} (${(100 * s.exec / s.total).toFixed(1)}%)`);
  }
  if (url.includes('/ritual.html')) {
    const s = lineStats(info.source, info.covered);
    console.log(`ritual.html inline  lines ${s.exec}/${s.total} (${(100 * s.exec / s.total).toFixed(1)}%)`);
  }
}

const API = ['/api/tap', '/api/state', '/api/added', '/api/card', '/api/logged', '/api/ics',
  '/api/push/key', '/api/push/subscribe', '/api/push/unsubscribe', '/templates.json', '/protocol.json'];
const hit = API.filter(k => [...requests].some(p => p.startsWith(k)));
console.log(`engine endpoints exercised: ${hit.length}/${API.length}`);
console.log('  hit:  ' + hit.join(', '));
console.log('  miss: ' + (API.filter(k => !hit.includes(k)).join(', ') || 'none'));

await browser.close();
portal.stop();
