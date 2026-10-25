/* Every tirzepatide vial is 1 mL — 100 units — whatever the patient is
   dosing out of it. How long it lasts is that, divided by her units,
   taken weekly, and it must be right because it is what tells the
   atelier when to dispense the next one. */
import { chromium } from 'playwright';
let bad = 0;
const BASE = process.env.BASE || 'http://localhost:8094';
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};

const br = await chromium.launch();
const p = await br.newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/ritual.html#Vial~tir`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });

const t = await p.evaluate(async () =>
  (await loadTemplates()).templates.find(x => x.id === 'tirz'));
check('the vial is 1 mL', t.volumeMl === 1, `${t.volumeMl} mL`);
check('and is fixed, so no stored answer can resize it', t.vialFixed === true);

/* Her own dose, no weekly climb: the whole vial at N units a week. */
for (const units of [10, 17, 25, 30, 40]) {
  const got = await p.evaluate(u => {
    const pen = PENS[0];
    applySetup(pen, { vials: 1, mode: 'own', units: u, stepUp: 0, day: 1 });
    _supplyCache.clear();
    return { ml: pen.volumeMl, doses: dosesLeft(pen) };
  }, units);
  const expect = Math.floor(100 / units);
  check(`${String(units).padStart(2)} units a week gives ${expect} doses from the vial`,
        got.ml === 1 && got.doses === expect, `${got.doses} doses, vial ${got.ml} mL`);
}

/* A stored answer claiming a bigger vial must not take. */
const forced = await p.evaluate(() => {
  const pen = PENS[0];
  applySetup(pen, { vials: 1, vialMl: 3, mode: 'own', units: 25, stepUp: 0, day: 1 });
  _supplyCache.clear();
  return { ml: pen.volumeMl, doses: dosesLeft(pen) };
});
check('a 3 mL answer cannot resize a tirzepatide vial',
      forced.ml === 1 && forced.doses === 4, `${forced.ml} mL, ${forced.doses} doses`);

/* A second vial adds supply without restarting the schedule. */
const two = await p.evaluate(() => {
  const pen = PENS[0];
  applySetup(pen, { vials: 2, mode: 'own', units: 25, stepUp: 0, day: 1 });
  _supplyCache.clear();
  return { ml: pen.volumeMl, doses: dosesLeft(pen) };
});
check('two vials are 2 mL and twice the doses',
      two.ml === 2 && two.doses === 8, `${two.ml} mL, ${two.doses} doses`);

/* The run-out date is the last dose, and it is weekly. */
const when = await p.evaluate(() => {
  const pen = PENS[0];
  applySetup(pen, { vials: 1, mode: 'own', units: 25, stepUp: 0, day: 1 });
  _supplyCache.clear();
  const s = supply(pen);
  // The weekly dosing day is not the start day, so measure from the first
  // day actually due rather than from the start.
  let firstDue = null;
  for (let i = 0; i < 30 && !firstDue; i++) {
    const d = addDays(START, i);
    if (isDue(pen, d)) firstDue = iso(d);
  }
  return { doses: dosesLeft(pen), last: s.lastDose ? iso(s.lastDose) : null, firstDue };
});
const weeks = (new Date(when.last) - new Date(when.firstDue)) / (7 * 86400000);
check('four doses, a week apart, is three weeks from the first',
      when.doses === 4 && weeks === 3,
      `${when.doses} doses, ${when.firstDue} to ${when.last} = ${weeks} weeks`);

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
