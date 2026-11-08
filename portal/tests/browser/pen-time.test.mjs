/* Issue #11: the combined per-protocol date & time chip, the compact modal,
   and the first-dose lock. The unit suite pins the server lock; this file
   pins the patient card and the Studio editor in a real browser. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPortal, seedCard } from './harness.mjs';
import { signInGoogle } from '../auth-session.mjs';

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

const iso = d => d.toISOString().slice(0, 10);
const yesterday = iso(new Date(Date.now() - 86400000));
const dayBefore = iso(new Date(Date.now() - 2 * 86400000));

async function patientPage(slug) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/`);
  await signInGoogle(page);
  await page.goto(`${portal.base}/ritual.html?c=${slug}`);
  await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });
  return { ctx, page, errors };
}

const snapshot = page => page.evaluate(() =>
  Object.fromEntries(PENS.map(p => [p.id, { start: penStartIso(p), time: timeFor(p) }])));

test('the combined chip opens the compact modal and edits only that pen', async () => {
  const slug = `pt${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Pen Time', status: 'active',
    pens: [{ template: 'glow' }, { template: 'b12' }],
    settings: { startDate: yesterday, times: { Evening: '20:00' }, penTimes: {} },
  });

  const { ctx, page, errors } = await patientPage(slug);
  const before = await snapshot(page);
  const chipId = await page.evaluate(() => {
    const chip = document.querySelector('[data-pentimechip]');
    return chip ? chip.dataset.pentimechip : null;
  });
  assert.ok(chipId, 'a combined date/time chip renders');

  await page.click(`[data-pentimechip="${chipId}"]`);
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
  await page.fill('#ptDate', dayBefore);
  await page.fill('#ptTime', '21:15');
  await page.click('#penTimeDialog button[value="save"]');
  await page.waitForTimeout(400);

  const after = await snapshot(page);
  assert.deepEqual(after[chipId], { start: dayBefore, time: '21:15' }, 'the edited pen moved');
  for (const id of Object.keys(before)) {
    if (id === chipId) continue;
    assert.deepEqual(after[id], before[id], `${id} did not move`);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the first logged dose locks the chip and the modal', async () => {
  const slug = `lk${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Lock Time', status: 'active',
    pens: [{ template: 'glow' }],
    settings: { startDate: yesterday, times: { Evening: '20:00' }, penTimes: {} },
  });

  const dose = await fetch(`${portal.base}/api/dose`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug, template: 'glow', units: 4, mg: 0.93,
      at: `${yesterday}T20:00:00.000Z`, day: yesterday,
    }),
  });
  assert.equal(dose.status, 200);

  const { ctx, page, errors } = await patientPage(slug);
  await page.waitForSelector('[data-pentimechip].locked', { timeout: 10000 });
  await page.click('[data-pentimechip].locked');
  await page.waitForTimeout(200);
  const toast = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  assert.match(toast, /Locked — your first logged dose/);
  const open = await page.evaluate(() => document.getElementById('penTimeDialog')?.open === true);
  assert.equal(open, false, 'a locked chip does not open the modal');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the Studio pen chip opens the same compact modal', async () => {
  const slug = `st${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Studio Time', status: 'active',
    pens: [{ template: 'ghk' }],
    settings: { startDate: yesterday, times: { Evening: '20:00' }, penTimes: {} },
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
  await page.click('#penList [data-pentime="0"]');
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
  await page.fill('#ptDate', dayBefore);
  await page.fill('#ptTime', '19:30');
  await page.click('#penTimeDialog button[value="save"]');
  await page.waitForTimeout(300);

  const model = await page.evaluate(() => ({
    start: editing.pens[0].startDate,
    time: editing.settings.penTimes.ghk,
  }));
  assert.deepEqual(model, { start: dayBefore, time: '19:30' });
  assert.deepEqual(errors, []);
  await ctx.close();
});
