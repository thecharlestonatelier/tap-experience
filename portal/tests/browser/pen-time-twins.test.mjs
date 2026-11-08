/* QA explorer proving test — the Studio pen chip writes a twin pen's time
 * under the BARE template key, which the patient's phone never reads.
 *
 * The phone hydrates two same-template pens with ids `ghk#0` / `ghk#1`
 * (hydrateRecord), and `timeFor(pen)` reads `atelierPenTimes[pen.id]` — i.e.
 * `ghk#0`, not `ghk`. The Studio per-pen time ROWS use those ids correctly
 * (renderTimes → data-pentime="ghk#0"/"ghk#1"), but the pen CHIP in the pen
 * deck (renderPens → data-pentime="<index>") routes to openPenTimeEditor,
 * which writes `editing.settings.penTimes[pen.template]` — the bare `ghk`.
 * So a time set through the chip saves and toasts success, but the patient
 * never gets it: `timeFor(ghk#0)` looks up `ghk#0` and finds nothing.
 *
 * No Auth emulator is needed — this drives Card Studio only. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPortal, seedCard } from './harness.mjs';

let portal;
let browser;

before(async () => {
  portal = await startPortal();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  portal?.stop();
});

test('a Studio chip time on a twin pen lands on that twin\'s own key (ghk#0)', async () => {
  const slug = `qax${Date.now().toString(36)}.t`;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await seedCard(portal.base, {
    slug, name: 'Twin Chip', status: 'active',
    pens: [{ template: 'ghk' }, { template: 'ghk' }],
    settings: { startDate: yesterday, times: {}, penTimes: {} },
  });

  /* Card Studio, signed in with the passphrase (no Firebase involved). */
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.request.post(`${portal.base}/api/session`, { data: { passphrase: 'testpassphrase' } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/studio/`);
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`tr[data-slug="${slug}"]`);
  await page.waitForSelector('#editor[open]', { timeout: 10000 });

  /* The first twin's chip (index 0) opens the compact modal. */
  await page.click('#penList [data-pentime="0"]');
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
  await page.fill('#ptTime', '19:30');
  await page.click('#penTimeDialog button[value="save"]');
  await page.waitForTimeout(300);

  await page.click('#saveCard');
  await page.waitForTimeout(1200);

  const rec = await (await ctx.request.get(`${portal.base}/api/cards/${slug}`)).json();

  assert.deepEqual(errors, []);
  /* The correct behaviour: the time lands on the phone's own twin id. */
  assert.equal(
    rec.settings && rec.settings.penTimes && rec.settings.penTimes['ghk#0'],
    '19:30',
    `expected ghk#0 to hold the chip time; got ${JSON.stringify(rec.settings && rec.settings.penTimes)}`,
  );
  await ctx.close();
});
