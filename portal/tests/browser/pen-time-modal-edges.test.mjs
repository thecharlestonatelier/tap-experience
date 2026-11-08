/* QA designer — issue #11, the patient modal's defensive edges.

   Covers the analyst's gap list for the patient chip/modal:
   - Cancel discards the edits;
   - an empty date and an empty / invalid time write nothing;
   - an atelier-pinned pen time (`settings.penTimes`) shows "Set by the atelier."
     and does not open the modal;
   - a first dose for one template locks only that pen, not a different one;
   - the boundary times 00:00 and 23:59 are accepted.

   These run against fragment cards (no Auth emulator needed). Where the lock is
   involved, the dose log (`LOGGED`) is seeded exactly as `loadLogged` would fill
   it from `/api/logged/<slug>` after a real dose. */
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

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = iso(new Date(Date.now() - 86400000));

async function openFrag(pens, start) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${portal.base}/ritual.html#c=Alice~${pens.join('~')}&s=${start}`);
  await page.waitForFunction(
    () => typeof PENS !== 'undefined' && PENS.length > 0,
    null, { timeout: 20000 },
  );
  return { ctx, page, errors };
}

const pen0 = page => page.evaluate(() => ({ start: penStartIso(PENS[0]), time: timeFor(PENS[0]) }));

test('Cancel discards the edits', async () => {
  const { ctx, page, errors } = await openFrag(['ghk'], yesterday);
  await page.waitForSelector('[data-pentimechip="ghk"]', { timeout: 10000 });
  const before = await pen0(page);

  await page.click('[data-pentimechip="ghk"]');
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
  const target = await page.evaluate(() => iso(addDays(today(), -20)));
  await page.fill('#ptDate', target);
  await page.fill('#ptTime', '23:59');
  await page.click('#penTimeDialog button[value="cancel"]');
  await page.waitForTimeout(300);

  assert.deepEqual(await pen0(page), before, 'nothing was written');
  assert.equal(await page.evaluate(() => document.getElementById('penTimeDialog').open), false, 'modal closed');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('an empty date and an empty or invalid time write nothing', async () => {
  const { ctx, page, errors } = await openFrag(['ghk'], yesterday);
  await page.waitForSelector('[data-pentimechip="ghk"]', { timeout: 10000 });
  const before = await pen0(page);

  await page.click('[data-pentimechip="ghk"]');
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
  await page.fill('#ptDate', '');
  await page.fill('#ptTime', '');
  await page.click('#penTimeDialog button[value="save"]');
  await page.waitForTimeout(300);

  assert.deepEqual(await pen0(page), before, 'empty date and empty time write nothing');

  // An invalid time is rejected by setPenTime's own guard.
  const wroteInvalid = await page.evaluate(() => {
    const pen = PENS[0];
    setPenTime(pen, '99:99');
    return loadPenTimes()[pen.id];
  });
  assert.equal(wroteInvalid, undefined, 'an invalid time is not stored');

  assert.deepEqual(errors, []);
  await ctx.close();
});

test('an atelier-pinned pen time shows "Set by the atelier." and does not open', async () => {
  const { ctx, page, errors } = await openFrag(['ghk'], yesterday);
  await page.waitForSelector('[data-pentimechip="ghk"]', { timeout: 10000 });

  // settings.penTimes reaches the phone as this localStorage map (applySettings).
  await page.evaluate(() => {
    localStorage.setItem('tca.pentime.atelier.alice', JSON.stringify({ ghk: '08:00' }));
    renderAll();
  });
  await page.waitForSelector('[data-pentimechip="ghk"].atelier', { timeout: 8000 });

  await page.click('[data-pentimechip="ghk"].atelier');
  const toast = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  assert.match(toast, /Set by the atelier/);
  assert.equal(await page.evaluate(() => document.getElementById('penTimeDialog')?.open === true), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a dose for one template locks only that pen', async () => {
  const { ctx, page, errors } = await openFrag(['ghk', 'glow'], yesterday);
  await page.waitForSelector('[data-pentimechip="ghk"]', { timeout: 10000 });
  await page.waitForSelector('[data-pentimechip="glow"]', { timeout: 10000 });

  // Seed the dose log the way loadLogged would fill it after a real ghk dose.
  await page.evaluate(() => { LOGGED = { '2026-01-01': ['ghk'] }; renderAll(); });
  await page.waitForSelector('[data-pentimechip="ghk"].locked', { timeout: 8000 });

  assert.equal(await page.evaluate(() => !!document.querySelector('[data-pentimechip="ghk"].locked')), true);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-pentimechip="glow"].locked')), false);

  // The un-dosed pen still opens its modal.
  await page.click('[data-pentimechip="glow"]');
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the boundary times 00:00 and 23:59 are accepted', async () => {
  const { ctx, page, errors } = await openFrag(['ghk'], yesterday);
  await page.waitForSelector('[data-pentimechip="ghk"]', { timeout: 10000 });

  for (const t of ['00:00', '23:59']) {
    await page.click('[data-pentimechip="ghk"]');
    await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
    await page.fill('#ptTime', t);
    await page.click('#penTimeDialog button[value="save"]');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => timeFor(PENS[0])), t, `accepted ${t}`);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});
