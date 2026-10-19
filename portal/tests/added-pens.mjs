import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B='http://localhost:8096', TOK=readFileSync('/tmp/tok.txt','utf8').trim();
const H={'Content-Type':'application/json',Cookie:`ca_studio=${TOK}`};
let bad=0; const check=(n,ok,x='')=>{console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`);if(!ok)bad++;};
const rec=async()=>(await (await fetch(`${B}/api/card/est.t`)).json());

await fetch(`${B}/api/cards/est.t`,{method:'PUT',headers:H,
  body:JSON.stringify({pens:[{template:'ghk'}],added:[]})});

const br=await chromium.launch();
const ctx=await br.newContext({viewport:{width:420,height:900}});
const p=await ctx.newPage(); p.on('pageerror',e=>{console.log(' FAIL page error —',e.message);bad++;});
p.on('dialog',d=>d.accept());
await p.goto(`${B}/ritual.html?c=est.t`);
await p.waitForFunction(()=>typeof PENS!=='undefined'&&PENS.length,null,{timeout:15000});

// --- the patient adds a peptide on her own card ---
await p.evaluate(async()=>{ const t=await loadTemplates();
  addPen(t.templates.find(x=>x.id==='bpc')); renderAll(); });
await p.waitForTimeout(900);
const r1=await rec();
check('a peptide she adds reaches the atelier', (r1.added||[]).some(a=>a.template==='bpc'),
      JSON.stringify(r1.added));
check('and does not touch what was prescribed',
      JSON.stringify(r1.pens)===JSON.stringify([{template:'ghk'}]), JSON.stringify(r1.pens));

// --- it comes back on a phone that has never seen it ---
const fresh=await (await br.newContext({viewport:{width:420,height:900}})).newPage();
await fresh.goto(`${B}/ritual.html?c=est.t`);
await fresh.waitForFunction(()=>typeof PENS!=='undefined'&&PENS.length,null,{timeout:15000});
check('a wiped phone gets it back',
      (await fresh.evaluate(()=>PENS.map(x=>x.template))).includes('bpc'),
      (await fresh.evaluate(()=>PENS.map(x=>x.id))).join(', '));

// --- she can take off what she added ---
const xs=await p.locator('#todayStack [data-drop]').count();
check('her own peptide carries a remove control', xs===1, `${xs} control(s)`);
const pres=await p.evaluate(()=>PENS.filter(x=>!x.addedByPatient).map(x=>x.id));
check('a prescribed peptide carries none', pres.length>0 &&
      !(await p.evaluate(ids=>ids.some(i=>!!document.querySelector(`[data-drop="${i}"]`)), pres)),
      pres.join(', '));

await p.locator('#todayStack [data-drop]').first().click();
await p.waitForTimeout(900);
check('removing it clears the card', !(await p.evaluate(()=>PENS.some(x=>x.addedByPatient))));
const r2=await rec();
check('and the atelier sees it gone', (r2.added||[]).length===0, JSON.stringify(r2.added));

await p.reload(); await p.waitForFunction(()=>typeof PENS!=='undefined',null,{timeout:15000});
check('it stays gone after a reload', !(await p.evaluate(()=>PENS.some(x=>x.addedByPatient))),
      (await p.evaluate(()=>PENS.map(x=>x.id))).join(', '));

// --- a prescribed pen cannot be removed by a tap ---
check('removePen refuses a prescribed pen',
      (await p.evaluate(()=>removePen(PENS.find(x=>!x.addedByPatient))))===false);
check('and it is still on the record',
      JSON.stringify((await rec()).pens)===JSON.stringify([{template:'ghk'}]));

await br.close();
console.log(bad?`\n${bad} failing`:'\nall good');
process.exit(bad?1:0);
