/* QA designer — issue #11, the Studio half of the first-dose lock.

   A card whose phone reported a first dose (`state.supply[].lastDose`) must show
   a locked pen chip in Card Studio; tapping it explains itself and does not open
   the modal. Then a stale client that still moves `editing.pens[0].startDate` and
   saves must get the server 409, surfaced as the "Use Force to override" toast.

   Two writes arm the two halves of the lock:
   - POST /api/dose            -> the server `writeCard` 409 (a real logged dose);
   - POST /api/state/<slug>    -> the Studio chip `.locked` (her phone's report).

   No Auth emulator is needed — Card Studio only needs the passphrase session. */
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

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = iso(new Date(Date.now() - 86400000));

test('a reported first dose locks the Studio chip and a stale start change 409s', async () => {
  const slug = `qad${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Studio Lock', status: 'active',
    pens: [{ template: 'ghk' }],
    settings: { startDate: yesterday, times: {}, penTimes: {} },
  });

  // Arm the server lock with a real logged dose.
  const d = await fetch(`${portal.base}/api/dose`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'ghk', units: 4, at: `${yesterday}T20:00:00.000Z`, day: yesterday }),
  });
  assert.equal(d.status, 200);

  // Her phone's report: the pen has a first dose (supply.lastDose).
  const s = await fetch(`${portal.base}/api/state/${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supply: [{ template: 'ghk', dosesLeft: 1, lastDose: yesterday }] }),
  });
  assert.equal(s.status, 204);

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.request.post(`${portal.base}/api/session`, { data: { passphrase: 'testpassphrase' } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/studio/`);
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`tr[data-slug="${slug}"]`);
  await page.waitForSelector('#editor[open]', { timeout: 10000 });

  // The chip is locked.
  await page.waitForSelector('#penList [data-pentime="0"].locked', { timeout: 8000 });

  // Tapping it explains itself and does not open the modal.
  await page.click('#penList [data-pentime="0"].locked');
  await page.waitForFunction(
    () => (document.getElementById('toast')?.textContent || '').includes('Use Force to override'),
    null, { timeout: 5000 },
  );
  assert.equal(await page.evaluate(() => document.getElementById('penTimeDialog')?.open === true), false);

  // A stale client moves the start day directly and saves: the server 409s, and
  // the toast names the pen (GHK-Cu) and points at Force.
  await page.evaluate(() => { editing.pens[0].startDate = '2000-01-01'; });
  await page.click('#saveCard');
  await page.waitForFunction(
    () => (document.getElementById('toast')?.textContent || '').includes('GHK-Cu'),
    null, { timeout: 8000 },
  );
  const toast = await page.evaluate(() => document.getElementById('toast').textContent);
  assert.match(toast, /Use Force to override/);
  assert.match(toast, /first dose is logged/);

  assert.deepEqual(errors, []);
  await ctx.close();
});
