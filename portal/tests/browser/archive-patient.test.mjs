/* QA designer defensive tests — issue #12 per-pen archive, patient side.

   Uses a self-contained fragment card (no Auth emulator, no sign-in — the
   same approach as portal/tests/browser/pen-time-derived.test.mjs) so the
   rhythm-sheet overflow menu and the archive gesture run in a real browser:

     gap 4 — an active (non-spent) pen offers no [data-archive]; archiving
             one spent pen hides only that pen — the other stays in PENS and
             in the rhythm DOM.
     gap 7 — the overflow menu toggles aria-expanded, an outside click
             closes it, and "Stop taking it" still works from that menu. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPortal } from './harness.mjs';


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

/* glow: a finite 33-dose pen, spent ~47 days after the start day.
   cjcipa: a ~20-week pen, still active months after glow runs dry.
   Both start the same day; on a day ~100 days later glow is spent and
   cjcipa is not. */
async function openFrag(pens, start) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`${portal.base}/ritual.html#c=Alice~${pens.join('~')}&s=${start}`);
  await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 2, null, { timeout: 20000 });
  return { ctx, page, errors };
}

test('an active pen offers no archive, and archiving one spent pen hides only that pen', async () => {
  const { ctx, page, errors } = await openFrag(['glow', 'cjcipa'], '2026-08-01');

  const spent = await page.evaluate(() => Object.fromEntries(PENS.map(p => [p.id, isSpent(p)])));
  assert.equal(spent.glow, true, 'precondition: glow is spent');
  assert.equal(spent.cjcipa, false, 'precondition: cjcipa is still active');

  // Only the spent pen carries the archive control.
  assert.equal(await page.locator('[data-archive]').count(), 1, 'exactly one pen offers Archive');
  assert.equal(await page.locator('[data-archive="glow"]').count(), 1, 'the spent glow pen offers Archive');
  assert.equal(await page.locator('[data-archive="cjcipa"]').count(), 0, 'the active cjcipa pen offers none');

  await page.click('[data-penmenu="glow"]');
  await page.click('[data-archive="glow"]');
  await page.waitForFunction(() => !PENS.some(p => p.id === 'glow'), null, { timeout: 5000 });

  assert.equal(await page.evaluate(() => PENS.length), 1, 'only the archived pen left PENS');
  assert.equal(await page.evaluate(() => PENS[0].id), 'cjcipa', 'the second pen stays in PENS');
  assert.equal(await page.locator('[data-penmenu="glow"]').count(), 0, 'the archived pen\u2019s rhythm row is gone');
  assert.equal(await page.locator('[data-penmenu="cjcipa"]').count(), 1, 'the second pen\u2019s rhythm row stays');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the overflow menu toggles aria-expanded, closes on an outside click, and Stop taking it still works', async () => {
  const { ctx, page, errors } = await openFrag(['glow', 'cjcipa'], '2026-08-01');

  const btn = page.locator('[data-penmenu="glow"]');
  const menu = page.locator('[data-penmenu-for="glow"]');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'starts closed');

  await btn.click();
  assert.equal(await btn.getAttribute('aria-expanded'), 'true', 'opens on click');
  assert.equal(await menu.isVisible(), true, 'the menu shows');

  // An outside click closes it and resets the flag.
  await page.evaluate(() => document.body.click());
  assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'outside click collapses the flag');
  assert.equal(await menu.isVisible(), false, 'outside click hides the menu');

  // "Stop taking it" lives in the same menu and still removes the pen.
  await btn.click();
  await page.click('[data-stop="glow"]');
  await page.waitForFunction(() => !PENS.some(p => p.id === 'glow'), null, { timeout: 5000 });

  assert.equal(await page.evaluate(() => PENS.length), 1, 'Stop taking it removed the pen');
  assert.equal(await page.evaluate(() => PENS[0].id), 'cjcipa', 'the other pen is untouched');
  assert.deepEqual(errors, []);
  await ctx.close();
});
