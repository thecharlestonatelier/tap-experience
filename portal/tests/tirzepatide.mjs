/* Tirzepatide: 1 mL vials, own units, a weekly climb, and carrying on
   into a second vial when the first is spent. */
import { chromium } from 'playwright';
const BASE='http://localhost:8089';
let bad=0; const check=(n,ok,x='')=>{console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`); if(!ok)bad++;};

const b=await chromium.launch(); const page=await b.newPage();
page.on('pageerror', e=>console.log('  PAGE ERROR:', e.message));
await page.goto(`${BASE}/ritual.html#Tess~tir`);
await page.waitForFunction(()=>typeof ownPhases==='function',null,{timeout:8000});

// the vial
const vial = await page.evaluate(async () => {
  const t=(await loadTemplates()).templates.find(x=>x.id==='tirz');
  return { conc:t.concentrationMgPerMl, vol:t.volumeMl, max:t.maxUnits,
           steps:t.stepUpOptions, opts:t.vialOptions||null };
});
console.log('  vial:', JSON.stringify(vial));
check('1 mL vial', vial.vol===1);
check('no vial-size question any more', vial.opts===null);
check('climb options are 0-4', JSON.stringify(vial.steps)==='[0,1,2,3,4]');
check('one unit is 0.17 mg', Math.abs(vial.conc*0.01-0.17)<0.001);

// the climb
const climb = await page.evaluate(() => {
  const pen={ maxUnits:50 };
  return {
    none: ownPhases(pen,20,0).map(p=>p.units),
    two:  ownPhases(pen,20,2).map(p=>p.units).slice(0,8),
    twoEnd: ownPhases(pen,20,2).slice(-1)[0],
    four: ownPhases(pen,44,4).map(p=>p.units)
  };
});
console.log('  no increase   :', climb.none.join(', '));
console.log('  +2 a week     :', climb.two.join(', '), '…');
console.log('  +4 from 44    :', climb.four.map(u=>u).join(', '));
check('no increase holds one dose', climb.none.length===1 && climb.none[0]===20);
check('+2 climbs by two', climb.two[0]===20 && climb.two[1]===22 && climb.two[2]===24);
check('the climb stops at the 50-unit ceiling',
  climb.twoEnd.units<=50 && climb.twoEnd.days===364, JSON.stringify(climb.twoEnd));
check('it never steps past the ceiling', climb.four.every(u=>u<=50), climb.four.join(','));

// supply from a 1 mL vial, and a second one
const supplyOut = await page.evaluate(() => {
  const pen = JSON.parse(JSON.stringify(PENS[0]));
  pen.id='tirz'; pen.startDate=null;
  const out={};
  applySetup(pen, { mode:'own', units:25, stepUp:0, vials:1 });
  out.oneVial = { ml: pen.volumeMl, vials: pen.vials };
  applySetup(pen, { mode:'own', units:25, stepUp:0, vials:2 });
  out.twoVials = { ml: pen.volumeMl, vials: pen.vials };
  return out;
});
console.log('  one vial :', JSON.stringify(supplyOut.oneVial));
console.log('  two vials:', JSON.stringify(supplyOut.twoVials));
check('one vial is 1 mL', supplyOut.oneVial.ml===1);
check('a second vial doubles the supply', supplyOut.twoVials.ml===2 && supplyOut.twoVials.vials===2);

await b.close();
console.log(bad?`\n${bad} FAILED`:'\nPASS — 1 mL vials, the climb holds at the ceiling, a new vial only adds supply.');
process.exit(bad?1:0);
