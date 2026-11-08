/* Browser pin for the patient pages, before the engine/I-O split.
   A real portal on a file store + headless Chromium; the Auth emulator
   (started by `firebase emulators:exec`) provides the sign-in gate. */
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
