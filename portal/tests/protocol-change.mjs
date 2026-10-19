/* A card left open, the way a home-screen card is: never reloaded.
   The atelier changes the protocol; the patient comes back to the app. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B='http://localhost:8096', TOK=readFileSync('/tmp/tok.txt','utf8').trim();
const H={'Content-Type':'application/json',Cookie:`ca_studio=${TOK}`};
let bad=0; const check=(n,ok,x='')=>{console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`);if(!ok)bad++;};

await fetch(`${B}/api/cards/est.t`,{method:'PUT',headers:H,body:JSON.stringify({pens:[{template:'ghk'}]})});

const br=await chromium.launch();
const ctx=await br.newContext({viewport:{width:420,height:900}});
const p=await ctx.newPage(); p.on('pageerror',e=>{console.log(' FAIL  page error —',e.message);bad++;});

await p.goto(`${B}/ritual.html?c=est.t`);
await p.waitForFunction(()=>typeof PENS!=='undefined'&&PENS.length,null,{timeout:15000});
/* Coming back to a card that was left open. The browser fires these when
   an app returns to the front; nothing here is reloaded. */
const resume=async()=>{ await p.evaluate(()=>{
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
}); await p.waitForTimeout(1200); };
const names=async()=>p.evaluate(()=>[...document.querySelectorAll('#todayStack .dose-name')].map(e=>e.textContent));
check('card opens with one peptide',(await names()).length===1,(await names()).join(', '));

// --- the atelier adds a peptide while her card sits open ---
await fetch(`${B}/api/cards/est.t`,{method:'PUT',headers:H,
  body:JSON.stringify({pens:[{template:'ghk'},{template:'nadvial'}]})});

// she switches away and comes back. NO reload.
await resume(); 

const after=await names();
check('the new peptide is on her screen, with no reload', after.length===2, after.join(', '));
check('and the engine has it', (await p.evaluate(()=>PENS.map(x=>x.id))).includes('nadvial'));

// --- and a peptide removed goes away the same way ---
await fetch(`${B}/api/cards/est.t`,{method:'PUT',headers:H,body:JSON.stringify({pens:[{template:'nadvial'}]})});
await resume(); 
const gone=await names();
check('a peptide removed disappears the same way', gone.length===1 && !gone.join().includes('GHK'), gone.join(', '));

// --- nothing changed: the screen must not churn ---
const stamp=await p.evaluate(()=>document.getElementById('todayStack').innerHTML.length);
await resume(); 
check('coming back with nothing changed redraws nothing',
      await p.evaluate(()=>document.getElementById('todayStack').innerHTML.length)===stamp);

await br.close();
console.log(bad?`\n${bad} failing`:'\nall good');
process.exit(bad?1:0);
