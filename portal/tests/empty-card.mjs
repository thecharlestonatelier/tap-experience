/* Three states must look different: her card unfinished, an address that
   resolves to nobody, and a blank tag never assigned. */
import { chromium } from 'playwright';
const BASE='http://localhost:8091';
let bad=0; const check=(n,ok,x='')=>{console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`); if(!ok)bad++;};

const b=await chromium.launch(); const page=await b.newPage();

async function look(path){
  await page.goto(BASE+path);
  await page.waitForSelector('body.resolved',{timeout:8000});
  return {
    greet:(await page.textContent('.greeting')).trim(),
    name:(await page.textContent('#patientName')).trim(),
    menu:(await page.textContent('#menu')).replace(/\s+/g,' ').trim()
  };
}

const named = await look('/test.p');
console.log('  named-but-empty :', named.greet, '/', named.name);
console.log('    ', named.menu.slice(0,120));
check('names the patient on an unfinished card', /test/i.test(named.name), named.name);
check('does not shout NOT SET UP at her', !/not set up/i.test(named.name), named.name);
check('says the protocol is not on it yet', /has not been added/i.test(named.menu));
check('reassures dosing is unchanged', /nothing about your dosing has changed/i.test(named.menu));

const blank = await look('/blank.q');
console.log('  blank tag       :', blank.greet, '/', blank.name);
check('a blank tag still says NOT SET UP', /not set up/i.test(blank.name), blank.name);

const root = await look('/');
console.log('  bare root       :', root.greet, '/', root.name);
check('the bare root names nobody', /not set up/i.test(root.name), root.name);
check('the bare root leaks no patient', !/test|jessica|christie/i.test(root.name + root.menu));

await b.close();
console.log(bad?`\n${bad} FAILED`:'\nPASS — an unfinished card is told apart from an unknown one.');
process.exit(bad?1:0);
