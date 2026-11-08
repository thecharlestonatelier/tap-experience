/* Browser pin for the patient pages, before the engine/I-O split.
   A real portal on a file store + headless Chromium; the Auth emulator
   (started by `firebase emulators:exec`) provides the sign-in gate. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startPortal, seedCard, stubPush } from './harness.mjs';
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

async function signedInPage() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/`);
  await signInGoogle(page);
  return { ctx, page, errors };
}

const cardOf = (slug, cookie) =>
  fetch(`${portal.base}/api/cards/${slug}`, { headers: { Cookie: cookie } }).then(r => r.json());

test('the ritual page loads the protocol and renders a pen', async () => {
  const slug = `eng${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Engine', status: 'active', pens: [{ template: 'glow' }],
    settings: { startDate: '2026-07-13', times: {}, rev: 1 },
  });
  const { ctx, page, errors } = await signedInPage();
  await page.goto(`${portal.base}/ritual.html?c=${slug}`);
  await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });

  assert.deepEqual(errors, []);
  const info = await page.evaluate(() => ({
    pens: PENS.length,
    name: CFG && CFG.patient ? CFG.patient.name : null,
    text: document.body.innerText,
    dose: (() => { const d = doseOn(PENS[0], parse('2026-07-13')); return d && d.units; })(),
  }));
  assert.ok(info.pens >= 1, 'a pen renders');
  assert.ok(info.dose > 0, 'the engine resolves a dose in the browser');
  assert.match(info.text, /Glow/i, 'the pen name is on the page');
  await ctx.close();
});

test('opening the card records a tap through the page fetch', async () => {
  const slug = `tap${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Tap', status: 'active', pens: [{ template: 'glow' }],
    settings: { startDate: '2026-07-13', times: {}, rev: 1 },
  });
  const beforeCard = await cardOf(slug, cookie);
  const { ctx, page } = await signedInPage();
  await page.goto(`${portal.base}/ritual.html?c=${slug}`);
  await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const afterCard = await cardOf(slug, cookie);
  assert.ok((Number(afterCard.taps) || 0) > (Number(beforeCard.taps) || 0), 'the tap counter advanced');
  await ctx.close();
});

test('a peptide the patient adds reaches the record', async () => {
  const slug = `add${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Add', status: 'active', pens: [{ template: 'ghk' }],
    settings: { startDate: '2026-07-13', times: {}, rev: 1 },
  });
  const { ctx, page, errors } = await signedInPage();
  await page.goto(`${portal.base}/ritual.html?c=${slug}`);
  await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });
  await page.evaluate(async () => {
    const t = await loadTemplates();
    addPen(t.templates.find(x => x.id === 'bpc'));
    renderAll();
  });
  await page.waitForTimeout(900);
  const card = await cardOf(slug, cookie);
  assert.ok((card.added || []).some(a => a.template === 'bpc'), 'the added peptide reaches the record');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the reminder switch subscribes, survives reload and unsubscribes', async () => {
  const slug = `rem${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Rem', status: 'active', pens: [{ template: 'glow' }],
    settings: { startDate: '2026-07-13', times: {}, rev: 1 },
  });
  const ctx = await browser.newContext({ permissions: ['notifications'], viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  await stubPush(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/`);
  await signInGoogle(page);
  await page.goto(`${portal.base}/${slug}`);
  await page.waitForSelector('body.resolved', { timeout: 15000 });
  await page.waitForSelector('#remind.on', { timeout: 10000 }).catch(() => {});

  const subs = () => {
    try { return Object.values(JSON.parse(fs.readFileSync(path.join(portal.dir, 'subs.json'), 'utf8'))); }
    catch { return []; }
  };
  await page.waitForSelector('#remindBtn', { timeout: 10000 });
  await page.click('#remindBtn');
  await page.waitForFunction(() => document.getElementById('remindBtn')?.dataset.state === 'on', null, { timeout: 10000 });
  assert.equal(subs().filter(s => s.slug === slug).length, 1, 'subscription stored');

  await page.reload();
  await page.waitForFunction(() => document.getElementById('remindBtn')?.dataset.state === 'on', null, { timeout: 10000 });
  await page.click('#remindBtn');
  await page.waitForFunction(() => document.getElementById('remindBtn')?.dataset.state === 'off', null, { timeout: 10000 });
  assert.equal(subs().filter(s => s.slug === slug).length, 0, 'subscription removed');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('every portal page renders with a card and no errors', async () => {
  const slug = `pg${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Pages', status: 'active', pens: [{ template: 'glow' }],
    settings: { startDate: '2026-07-13', times: {}, rev: 1 },
  });
  const { ctx, page, errors } = await signedInPage();
  for (const pg of ['calendar.html', 'cards.html', 'expect.html', 'storage.html', 'tutorial.html']) {
    await page.goto(`${portal.base}/${pg}?c=${slug}`);
    await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });
    const info = await page.evaluate(() => ({ pens: PENS.length, text: document.body.innerText.length }));
    assert.ok(info.pens >= 1, `${pg} renders a pen`);
    assert.ok(info.text > 0, `${pg} renders text`);
  }
  await page.goto(`${portal.base}/library.html?c=${slug}`);
  await page.waitForTimeout(500);
  assert.ok((await page.evaluate(() => document.body.innerText.length)) > 0, 'library renders');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a legacy fragment card still loads the static protocol', async () => {
  const { ctx, page, errors } = await signedInPage();
  await page.goto(`${portal.base}/ritual.html?card=legacy`);
  await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });
  assert.ok((await page.evaluate(() => PENS.length)) >= 1, 'the legacy card renders its protocol');
  assert.deepEqual(errors, []);
  await ctx.close();
});
