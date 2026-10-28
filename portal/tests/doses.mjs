/* The number on the patient's screen must be the number the medicine
   math says it is: every phase's dial units follow from its milligram
   dose and the vial concentration — mg / (vialMg/diluentMl) per 0.01 mL
   dial unit, floored, exactly as unitsForMg computes it. The printed
   dose cards carry the same numbers, because both sides read
   templates.json; a clinical edit there must move this suite with it.

   Expected units are derived here from the same formula, not hard-coded,
   so a legitimate protocol change cannot rot the suite — and a broken
   dosing formula cannot pass it. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/* Arrange — the clinical source of truth, the same file the app fetches */
const BASE = 'http://localhost:8092';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const templates = JSON.parse(readFileSync(
  new URL('../../patients/jessica/templates.json', import.meta.url), 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/#Test~ghk`);
await page.waitForFunction(() => typeof loadTemplates === 'function', null, { timeout: 8000 });

/* Act — read what the app resolved from the same file */
const app = await page.evaluate(async () => {
  const t = await loadTemplates();
  const out = {};
  (t.templates || []).forEach(x => {
    out[x.id] = (x.phases || []).map(p => ({ name: p.name, mg: p.mg, units: p.units }));
  });
  return out;
});

/* Assert — every phase's dial matches the mirrored formula */
let checked = 0;
for (const t of templates.templates || []) {
  if (!t.vialMg || !t.diluentMl || !t.phases) continue;
  const c = t.vialMg / t.diluentMl;                     // mg per mL
  t.phases.forEach((ph, i) => {
    if (ph.mg == null) return;
    const expected = Math.floor(ph.mg / c / 0.01);       // unitsForMg, mirrored
    const got = app[t.id] && app[t.id][i];
    check(`${t.id.padEnd(10)} ${ph.name.padEnd(12)} ${ph.mg} mg`,
      got && got.name === ph.name &&
      Math.abs(got.mg - ph.mg) < 0.001 &&
      Math.abs(got.units - expected) < 0.6,
      got ? `app: ${got.name} ${got.mg}mg ${got.units}u (math says ${expected}u)` : 'missing');
    checked++;
  });
}
check('every vial template got its dials verified', checked >= 10, `${checked} checked`);

/* Act — change the diluent on one template, both directions */
const moved = await page.evaluate(() => {
  const t = TEMPLATES.templates.find(x => x.id === 'ghk');
  t.diluentMl = 5;                       // a known strength
  resolveDoses({ templates: [t] });
  const before = t.phases.map(p => p.units);
  t.diluentMl = 10;                      // half strength
  resolveDoses({ templates: [t] });
  const after = t.phases.map(p => p.units);
  return { before, after };
});
console.log('   GHK-Cu at 5 mL :', moved.before.join('u, ') + 'u');
console.log('   GHK-Cu at 10 mL:', moved.after.join('u, ') + 'u');
/* Assert — halving the strength doubles the dial */
check('halving the strength doubles the dial',
  moved.after.every((u, i) => Math.abs(u - moved.before[i] * 2) < 0.6));

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — every dial number matches the medicine math, and follows the diluent.');
process.exit(bad ? 1 : 0);
