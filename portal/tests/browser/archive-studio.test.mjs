/* QA designer defensive tests — issue #12 per-pen archive, Card Studio side.

   Drives Card Studio only (passphrase session, no Auth emulator, the same
   approach as portal/tests/browser/pen-time-twins.test.mjs):

     gap 2 — a twin pair's Archived badge and Restore use the twin key
             (ghk#0), never the bare template, and restoring one twin does
             not disturb the other.
     gap 8 — the editor save round-trips `archived`: saving another field
             preserves the archive, and restoring the last pen then saving
             leaves it cleared. */
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

async function openStudio(slug) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.request.post(`${portal.base}/api/session`, { data: { passphrase: 'testpassphrase' } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/studio/`);
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`tr[data-slug="${slug}"]`);
  await page.waitForSelector('#penList .pen-row', { timeout: 10000 });
  return { ctx, page, errors };
}

const readCard = (slug, cookie) => fetch(`${portal.base}/api/cards/${slug}`, { headers: { Cookie: cookie } }).then(r => r.json());

test('the Studio badges and restores a twin pen by its ghk#0 key, not the bare template', async () => {
  const slug = `qat${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Twin Studio', status: 'active',
    pens: [{ template: 'ghk' }, { template: 'ghk' }],
    settings: { startDate: '2025-01-01', times: {}, penTimes: {} },
  });
  await fetch(`${portal.base}/api/archive/${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'ghk#0' }),
  });

  const { ctx, page, errors } = await openStudio(slug);

  // Exactly one pen row is archived, and it is index 0 (ghk#0), not ghk#1.
  assert.equal(await page.locator('#penList .pen-row.archived').count(), 1, 'one twin is badged');
  assert.equal(await page.locator('#penList [data-unarchive]').count(), 1);
  assert.equal(await page.locator('#penList [data-unarchive]').getAttribute('data-unarchive'), 'ghk#0',
    'the Restore control targets the twin key ghk#0, not ghk#1');

  await page.click('#penList [data-unarchive="ghk#0"]');
  await page.waitForSelector('#penList .pen-row.archived', { state: 'detached', timeout: 5000 });

  const card = await readCard(slug, cookie);
  assert.deepEqual(card.archived, {}, 'restoring ghk#0 clears the archive');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('an editor save preserves the archive, and restoring the last pen then saving clears it', async () => {
  const slug = `qas${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Save Archive', status: 'active',
    pens: [{ template: 'ghk' }],
    settings: { startDate: '2025-01-01', times: {}, penTimes: {} },
  });
  await fetch(`${portal.base}/api/archive/${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'ghk' }),
  });

  const { ctx, page, errors } = await openStudio(slug);
  assert.equal(await page.locator('#penList .pen-row.archived').count(), 1, 'the pen is badged before the save');

  // Save an unrelated field while the pen is archived.
  await page.fill('#editNote', 'round-trip');
  await page.click('#saveCard');
  await page.waitForTimeout(1200);

  const afterSave = await readCard(slug, cookie);
  assert.match(afterSave.archived.ghk, /^\d{4}-\d{2}-\d{2}T/, 'saving another field preserves the archive');

  // Reopen, restore the last pen, then save again.
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`tr[data-slug="${slug}"]`);
  await page.waitForSelector('#penList .pen-row.archived', { timeout: 10000 });
  await page.click('#penList [data-unarchive="ghk"]');
  await page.waitForSelector('#penList .pen-row.archived', { state: 'detached', timeout: 5000 });
  await page.click('#saveCard');
  await page.waitForTimeout(1200);

  const afterRestore = await readCard(slug, cookie);
  assert.deepEqual(afterRestore.archived, {}, 'restoring the last pen then saving leaves the archive cleared');
  assert.deepEqual(errors, []);
  await ctx.close();
});
