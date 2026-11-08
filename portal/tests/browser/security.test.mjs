/* Regression pins for the Card Studio XSS class: every patient-controlled
   string that reaches the dashboard must render as text, never as markup.
   These run on the same file-store harness as the other browser tests and
   need no Firebase. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

async function studio() {
  const ctx = await browser.newContext();
  await ctx.request.post(`${portal.base}/api/session`, {
    data: { passphrase: 'testpassphrase' },
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

const slugFor = prefix => `${prefix}${Date.now().toString(36)}.t`;

async function openCard(page, slug) {
  await page.goto(`${portal.base}/studio/`);
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`tr[data-slug="${slug}"]`);
}

test('state values render as text in Card Studio', async () => {
  const slug = slugFor('secstate');
  await seedCard(portal.base, {
    slug, name: 'Sec State', status: 'active', pens: [{ template: 'glow' }],
  });

  const marker = '<img src=x onerror=window.__xss=1>';
  const r = await fetch(`${portal.base}/api/state/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      today: [{ pen: marker, template: 'glow', phase: 'p', units: 1, mg: 1, at: '08:00' }],
      times: { Morning: '08:00' },
    }),
  });
  assert.equal(r.status, 204);

  const { ctx, page } = await studio();
  await openCard(page, slug);
  await page.waitForTimeout(600);

  assert.equal(await page.evaluate(() => window.__xss), undefined, 'the payload did not execute');
  const text = await page.evaluate(() => document.getElementById('seen')?.textContent || '');
  assert.ok(text.includes(marker), 'the payload is visible as text');
  await ctx.close();
});

test('activation names render as text in Card Studio', async () => {
  const slug = slugFor('secact');
  await seedCard(portal.base, {
    slug, name: 'Sec Act', status: 'active', pens: [{ template: 'glow' }],
  });

  const marker = '<img src=x onerror=window.__xss=2>';
  const file = path.join(portal.dir, 'cards.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all[slug].activatedBy = {
    uid: 'audit-uid', provider: 'google.com', name: marker, at: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(all));

  const { ctx, page } = await studio();
  await page.goto(`${portal.base}/studio/`);
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`[data-link="${slug}"]`);
  await page.waitForTimeout(600);

  assert.equal(await page.evaluate(() => window.__xss), undefined, 'the payload did not execute');
  const text = await page.evaluate(s =>
    document.querySelector(`tr.link-detail[data-slug="${s}"]`)?.textContent || '', slug);
  assert.ok(text.includes(marker), 'the payload is visible as text');
  await ctx.close();
});

test('dose-log template and lot render as text in Card Studio', async () => {
  const slug = slugFor('secdose');
  await seedCard(portal.base, {
    slug, name: 'Sec Dose', status: 'active', pens: [{ template: 'glow' }],
  });

  // 23 characters, inside sanitizeDose's 24-character clip.
  const marker = '<img src=x onerror=_x=3>';
  // The dose log is rendered inside the "seen" panel, which only exists once
  // the card has reported a state. A slug holder can post that themselves.
  await fetch(`${portal.base}/api/state/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      today: [{ pen: 'Normal', template: 'glow', phase: 'p', units: 1, mg: 1, at: '08:00' }],
      times: { Morning: '08:00' },
    }),
  });
  const r = await fetch(`${portal.base}/api/dose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug, template: marker, lot: marker, units: 1, mg: 1,
      at: '2026-01-01T09:00:00.000Z', day: '2026-01-01',
    }),
  });
  assert.equal(r.status, 200);

  const { ctx, page } = await studio();
  await openCard(page, slug);
  await page.waitForFunction(
    () => (document.getElementById('seenDoses')?.textContent || '').includes('Last:'),
    null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);

  assert.equal(await page.evaluate(() => window._x), undefined, 'the payload did not execute');
  const text = await page.evaluate(() =>
    document.getElementById('seenDoses')?.textContent || '');
  assert.ok(text.includes(marker), 'the template payload is visible as text');
  await ctx.close();
});

test('patient-added pen names render as text in Card Studio', async () => {
  const slug = slugFor('secadded');
  await seedCard(portal.base, {
    slug, name: 'Sec Added', status: 'active', pens: [{ template: 'glow' }],
  });

  const marker = '<img src=x onerror=_y=4>';
  const r = await fetch(`${portal.base}/api/added/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ added: [{ id: 'evil-1', template: marker }] }),
  });
  assert.equal(r.status, 200);

  const { ctx, page } = await studio();
  await openCard(page, slug);
  await page.waitForTimeout(600);

  assert.equal(await page.evaluate(() => window._y), undefined, 'the payload did not execute');
  const text = await page.evaluate(() => document.getElementById('penList')?.textContent || '');
  assert.ok(text.includes(marker), 'the added-pen payload is visible as text');
  await ctx.close();
});
