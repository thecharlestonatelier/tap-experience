/* QA designer — issue #11, C2: editing one pen's date/time through the modal
   moves its DERIVED outputs and no other pen's.

   The existing pen-time.test.mjs only asserts `penStartIso`/`timeFor` move. This
   pins the downstream arithmetic that actually matters — dayIndex, doseOn,
   dosesLeft, supply — for the edited pen (ghk) and a second pen (glow) that
   must stay put.

   A fragment card (no Auth emulator, no sign-in) carries two real templates:
   ghk has two phases (Starting 15d -> Maintenance), so moving its start 20 days
   back crosses the phase boundary and changes the dose; glow has one phase and
   must not move at all. */
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

/* A JSON-safe snapshot of the four derived quantities, per pen. */
const snapshot = page => page.evaluate(() => {
  const t = today();
  return Object.fromEntries(PENS.map(p => {
    const d = doseOn(p, t);
    const s = supply(p);
    return [p.id, {
      start: penStartIso(p),
      time: timeFor(p),
      dayIndex: dayIndex(t, p),
      dose: d ? { phase: d.phase.name, units: d.units } : null,
      dosesLeft: dosesLeft(p),
      supply: s.lastDose ? iso(s.lastDose) : null,
    }];
  }));
});

test('editing pen A moves its derived outputs and not pen B', async () => {
  const { ctx, page, errors } = await openFrag(['ghk', 'glow'], yesterday);
  await page.waitForFunction(() => PENS.length === 2, null, { timeout: 5000 });

  const before = await snapshot(page);
  assert.deepEqual(Object.keys(before).sort(), ['ghk', 'glow']);

  await page.click('[data-pentimechip="ghk"]');
  await page.waitForFunction(() => document.getElementById('penTimeDialog')?.open === true, null, { timeout: 5000 });
  const target = await page.evaluate(() => iso(addDays(today(), -20)));
  await page.fill('#ptDate', target);
  await page.fill('#ptTime', '23:59');
  await page.click('#penTimeDialog button[value="save"]');
  await page.waitForTimeout(400);

  const after = await snapshot(page);

  assert.notEqual(after.ghk.dayIndex, before.ghk.dayIndex, 'dayIndex(A) moved');
  assert.notDeepEqual(after.ghk.dose, before.ghk.dose, 'doseOn(A) moved');
  assert.notEqual(after.ghk.dosesLeft, before.ghk.dosesLeft, 'dosesLeft(A) moved');
  assert.notEqual(after.ghk.supply, before.ghk.supply, 'supply(A) moved');
  assert.equal(after.ghk.time, '23:59', 'time(A) moved');

  assert.deepEqual(after.glow, before.glow, 'pen B did not move');
  assert.deepEqual(errors, []);
  await ctx.close();
});
