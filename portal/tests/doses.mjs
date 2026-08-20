/* The number on the patient's screen must equal the number on the dose card. */
import { chromium } from 'playwright';
const BASE = 'http://localhost:8092';
let bad = 0;
const check = (n, ok, extra='') => { console.log(`${ok?'  ok  ':' FAIL '} ${n}${extra?' — '+extra:''}`); if(!ok) bad++; };

// straight off the Dr Kendall Concierge dose cards
const CARD = {
  ghk:        [['Starting',1.0,10],['Ramp-Up',2.0,20],['Maintenance',3.0,30]],
  bpc:        [['Starting',0.25,12.5],['Ramp-Up',0.5,25]],
  semax:      [['Starting',0.3,9],['Ramp-Up',0.5,15],['Bridge',0.6,18],['Maintenance',0.8,24]],
  blend2x:    [['Starting',1.5,15],['Ramp-Up',2.5,25],['Maintenance',4.5,45]],
  epithalon:  [['Starting',5.0,50],['Ramp-Up',7.5,75],['Maintenance',10.0,100]],
  pinealon:   [['Starting',2.0,12],['Ramp-Up',2.5,15],['Maintenance',3.0,18]],
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/#Test~ghk`);
await page.waitForFunction(() => typeof loadTemplates === 'function', null, {timeout:8000});

const got = await page.evaluate(async () => {
  const t = await loadTemplates();
  const out = {};
  (t.templates||[]).forEach(x => {
    out[x.id] = {
      conc: (x.vialMg && x.diluentMl) ? x.vialMg/x.diluentMl : null,
      phases: (x.phases||[]).map(p => [p.name, p.mg, p.units])
    };
  });
  return out;
});

for (const [id, expect] of Object.entries(CARD)) {
  const t = got[id];
  if (!t) { check(`${id} exists`, false); continue; }
  expect.forEach(([name, mg, units], i) => {
    const p = t.phases[i];
    const ok = p && p[0] === name && Math.abs(p[1]-mg) < 0.001 && Math.abs(p[2]-units) < 0.6;
    check(`${id.padEnd(10)} ${name.padEnd(12)} ${mg} mg = ${units}u`,
          ok, p ? `app: ${p[0]} ${p[1]}mg ${p[2]}u` : 'missing');
  });
}

// changing the diluent must move every dial number with it
const moved = await page.evaluate(() => {
  const t = TEMPLATES.templates.find(x => x.id === 'ghk');
  const before = t.phases.map(p => p.units);
  t.diluentMl = 10;                       // half strength
  resolveDoses({ templates: [t] });
  const after = t.phases.map(p => p.units);
  t.diluentMl = 5; resolveDoses({ templates: [t] });
  return { before, after };
});
console.log('   GHK-Cu at 5 mL :', moved.before.join('u, ') + 'u');
console.log('   GHK-Cu at 10 mL:', moved.after.join('u, ') + 'u');
check('halving the strength doubles the dial',
  moved.after.every((u,i) => Math.abs(u - moved.before[i]*2) < 0.6));

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — every dial number matches the dose card, and follows the diluent.');
process.exit(bad?1:0);
