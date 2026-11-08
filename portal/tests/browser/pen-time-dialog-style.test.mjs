/* The start day & time dialog, pinned as a look rather than a behaviour.

   Two defects are easy to reintroduce and invisible to the behaviour
   tests: the global `* { margin: 0 }` reset strips the browser's own
   `margin: auto` from <dialog>, which pins an otherwise-correct modal to
   the top-left; and the ritual's action buttons must use the same button
   classes as the rest of the app, not the browser's default chrome.

   Both pages build the same dialog, so both are checked here. */
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

/* Centre of the dialog versus centre of the viewport, in CSS pixels. */
const dialogCentre = page => page.evaluate(() => {
  const d = document.getElementById('penTimeDialog');
  const r = d.getBoundingClientRect();
  return {
    dx: (r.left + r.width / 2) - innerWidth / 2,
    dy: (r.top + r.height / 2) - innerHeight / 2,
    left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    vw: innerWidth, vh: innerHeight,
  };
});

const assertCentred = (box, label) => {
  assert.ok(Math.abs(box.dx) <= 1.5, `${label}: horizontally centred (off by ${box.dx}px)`);
  assert.ok(Math.abs(box.dy) <= 1.5, `${label}: vertically centred (off by ${box.dy}px)`);
  assert.ok(box.left >= 0 && box.top >= 0 && box.right <= box.vw && box.bottom <= box.vh,
    `${label}: fully on screen`);
};

test('the patient dialog is centred and its buttons match the app', async () => {
  const slug = `sty${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Style Check', status: 'active',
    pens: [{ template: 'glow' }],
    settings: { startDate: yesterday, times: { Evening: '20:00' }, penTimes: {} },
  });

  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/`);
  await signInGoogle(page);
  await page.goto(`${portal.base}/ritual.html?c=${slug}`);
  await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length > 0, null, { timeout: 20000 });

  const chipId = await page.evaluate(() => {
    const chip = document.querySelector('[data-pentimechip]');
    return chip ? chip.dataset.pentimechip : null;
  });
  assert.ok(chipId, 'a combined date/time chip renders');
  await page.click(`[data-pentimechip="${chipId}"]`);
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });

  assertCentred(await dialogCentre(page), 'pen dialog');

  const buttons = await page.evaluate(() => {
    const cancel = document.querySelector('#penTimeDialog button[value="cancel"]');
    const save = document.querySelector('#penTimeDialog button[value="save"]');
    const sheet = document.getElementById('modalConfirm');
    const cs = getComputedStyle(save);
    const sheetCs = getComputedStyle(sheet);
    return {
      cancel: cancel.className,
      save: save.className,
      saveBg: cs.backgroundColor,
      saveRadius: cs.borderRadius,
      saveWeight: cs.fontWeight,
      sheetBg: sheetCs.backgroundColor,
      sheetRadius: sheetCs.borderRadius,
      sheetWeight: sheetCs.fontWeight,
    };
  });
  assert.match(buttons.cancel, /\bbtn\b/, 'Cancel uses the app .btn class');
  assert.match(buttons.cancel, /\bbtn-ghost\b/, 'Cancel is the ghost button');
  assert.match(buttons.save, /\bbtn\b/, 'Save uses the app .btn class');
  assert.match(buttons.save, /\bbtn-primary\b/, 'Save is the primary button');
  assert.equal(buttons.saveBg, buttons.sheetBg, 'Save has the same fill as the log sheet');
  assert.equal(buttons.saveRadius, buttons.sheetRadius, 'Save has the same corner as the log sheet');
  assert.equal(buttons.saveWeight, buttons.sheetWeight, 'Save has the same weight as the log sheet');

  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the Studio dialog is centred and its buttons match the Studio', async () => {
  const slug = `sts${Date.now().toString(36)}.t`;
  await seedCard(portal.base, {
    slug, name: 'Studio Style', status: 'active',
    pens: [{ template: 'ghk' }],
    settings: { startDate: yesterday, times: { Evening: '20:00' }, penTimes: {} },
  });

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.request.post(`${portal.base}/api/session`, { data: { passphrase: 'testpassphrase' } });
  const page = await ctx.newPage();
  await page.goto(`${portal.base}/studio/`);
  await page.waitForSelector(`tr[data-slug="${slug}"]`, { timeout: 15000 });
  await page.click(`tr[data-slug="${slug}"]`);
  await page.waitForSelector('#editor[open]', { timeout: 10000 });
  await page.click('#penList [data-pentime="0"]');
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });

  assertCentred(await dialogCentre(page), 'studio pen dialog');

  const buttons = await page.evaluate(() => {
    const cancel = document.querySelector('#penTimeDialog button[value="cancel"]');
    const save = document.querySelector('#penTimeDialog button[value="save"]');
    const cardSave = document.getElementById('saveCard');
    const cs = getComputedStyle(save);
    const cardCs = getComputedStyle(cardSave);
    return {
      cancel: cancel.className,
      save: save.className,
      saveBg: cs.backgroundColor,
      saveRadius: cs.borderRadius,
      cardBg: cardCs.backgroundColor,
      cardRadius: cardCs.borderRadius,
    };
  });
  assert.match(buttons.cancel, /\bghost\b/, 'Cancel is the Studio ghost button');
  assert.match(buttons.save, /\bprimary\b/, 'Save is the Studio primary button');
  assert.equal(buttons.saveBg, buttons.cardBg, 'Save has the same fill as Save card');
  assert.equal(buttons.saveRadius, buttons.cardRadius, 'Save has the same corner as Save card');

  await ctx.close();
});
