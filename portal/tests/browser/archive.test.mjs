/* Issue #12: a finished vial archives from the patient's overflow menu,
   keeps its dose history, leaves the calendar, and the Studio restores it
   from the inline Archived badge. */
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
const today = iso(new Date());

test('a finished vial archives from the overflow menu, keeps doses, and leaves the calendar', async () => {
  const slug = `ar${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Archive Test', status: 'active',
    pens: [{ template: 'glow' }],
    settings: { startDate: '2025-01-01', times: {}, penTimes: {} },
  });
  const dose = await fetch(`${portal.base}/api/dose`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'glow', units: 4, mg: 0.93, at: '2025-01-01T20:00:00.000Z', day: '2025-01-01' }),
  });
  assert.equal(dose.status, 200);

  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`${portal.base}/`);
  await signInGoogle(page);
  await page.goto(`${portal.base}/ritual.html?c=${slug}`);
  await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length === 1, null, { timeout: 20000 });

  await page.click('[data-penmenu="glow"]');
  assert.equal(await page.locator('[data-archive="glow"]').count(), 1, 'the finished vial offers Archive');
  await page.click('[data-archive="glow"]');
  await page.waitForFunction(() => !PENS.some(p => p.id === 'glow'), null, { timeout: 5000 });

  const card = await (await fetch(`${portal.base}/api/cards/${slug}`, { headers: { Cookie: cookie } })).json();
  assert.ok(card.archived && card.archived.glow, 'the archive is recorded');
  const doses = await (await fetch(`${portal.base}/api/doses/${slug}`, { headers: { Cookie: cookie } })).json();
  assert.ok(doses.doses.some(d => d.template === 'glow'), 'the dose history stays');

  await page.waitForTimeout(800);
  const feed = await fetch(`${portal.base}/ics/${slug}`);
  const text = await feed.text();
  assert.ok(!/Glow|glow/.test(text), 'the calendar feed omits the archived pen');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the Studio shows the archived pen with an inline badge and restores it', async () => {
  const slug = `as${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Studio Archive', status: 'active',
    pens: [{ template: 'glow' }],
    settings: { startDate: '2025-01-01', times: {}, penTimes: {} },
  });
  await fetch(`${portal.base}/api/archive/${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'glow' }),
  });

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.request.post(`${portal.base}/api/session`, { data: { passphrase: 'testpassphrase' } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/studio/`);
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`tr[data-slug="${slug}"]`);
  await page.waitForSelector('#penList .pen-row.archived', { timeout: 10000 });
  await page.click('[data-unarchive="glow"]');
  await page.waitForSelector('#penList .pen-row.archived', { state: 'detached', timeout: 5000 });

  const card = await (await fetch(`${portal.base}/api/cards/${slug}`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(card.archived, {});
  assert.deepEqual(errors, []);
  await ctx.close();
});
