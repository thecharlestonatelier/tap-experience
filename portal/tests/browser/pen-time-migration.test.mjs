/* QA designer — issue #11, the migration path.

   A card written before per-pen start/time existed (no `pens[].startDate`, no
   `settings.penTimes`) must still render an editable chip that locks after a
   first dose. And a "setup" template (the patient configures her own vial /
   regimen / injection day) has no editable chip in the Studio pen deck. */
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

test('a card with no per-pen start/time renders an editable chip that locks after a dose', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // A fragment card with no per-pen start or time — only the protocol day.
  await page.goto(`${portal.base}/ritual.html#c=Alice~ghk&s=${yesterday}`);
  await page.waitForSelector('[data-pentimechip="ghk"]', { timeout: 20000 });

  // Editable: neither locked nor atelier-pinned.
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-pentimechip="ghk"].locked')), false);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-pentimechip="ghk"].atelier')), false);

  // It opens the modal.
  await page.click('[data-pentimechip="ghk"]');
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
  await page.click('#penTimeDialog button[value="cancel"]');

  // A first dose then locks it.
  await page.evaluate(() => { LOGGED = { '2026-01-01': ['ghk'] }; renderAll(); });
  await page.waitForSelector('[data-pentimechip="ghk"].locked', { timeout: 8000 });
  await page.click('[data-pentimechip="ghk"].locked');
  const toast = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  assert.match(toast, /Locked — your first logged dose/);

  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a setup pen has no editable chip in the Studio pen deck', async () => {
  const slug = `qadm${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Setup Pen', status: 'active',
    pens: [{ template: 'tirz' }],
    settings: { startDate: yesterday, times: {}, penTimes: {} },
  });

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.request.post(`${portal.base}/api/session`, { data: { passphrase: 'testpassphrase' } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/studio/`);
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`tr[data-slug="${slug}"]`);
  await page.waitForSelector('#editor[open]', { timeout: 10000 });

  // A setup pen shows a "patient chooses" note, not a start/time chip.
  assert.equal(await page.evaluate(() => document.querySelectorAll('#penList [data-pentime]').length), 0);
  assert.match(await page.evaluate(() => document.getElementById('penList').textContent), /patient chooses/i);

  assert.deepEqual(errors, []);
  await ctx.close();
});
