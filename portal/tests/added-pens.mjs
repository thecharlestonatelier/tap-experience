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
check('every peptide carries a remove control', xs===2, `${xs} control(s)`);

await p.locator('#todayStack .dose-card:has-text("BPC") [data-drop]').first().click();
await p.waitForTimeout(900);
check('removing hers clears it from the card', !(await p.evaluate(()=>PENS.some(x=>x.addedByPatient))));
const r2=await rec();
check('and the atelier sees it gone', (r2.added||[]).length===0, JSON.stringify(r2.added));

// --- and she can take off a PRESCRIBED one ---
await p.locator('#todayStack [data-drop]').first().click();
await p.waitForTimeout(900);
check('a prescribed peptide comes off too',
      !(await p.evaluate(()=>PENS.some(x=>x.id==='ghk'))),
      (await p.evaluate(()=>PENS.map(x=>x.id))).join(', ')||'(none left)');
const r3=await rec();
check('recorded as stopped, not deleted',
      (r3.dropped||[]).includes('ghk') &&
      JSON.stringify(r3.pens)===JSON.stringify([{template:'ghk'}]),
      `dropped ${JSON.stringify(r3.dropped)} · pens ${JSON.stringify(r3.pens)}`);

await p.reload(); await p.waitForFunction(()=>typeof PENS!=='undefined',null,{timeout:15000});
check('it stays off after a reload', !(await p.evaluate(()=>PENS.some(x=>x.id==='ghk'))));
check('the card names what she stopped, with a way back',
      (await p.locator('#stopped [data-restore]').count())===1,
      (await p.locator('#stopped').innerText()).split('\n').join(' | '));

// --- and she can put it back ---
await p.locator('#stopped [data-restore]').first().click();
await p.waitForTimeout(1500);
check('putting it back restores it', await p.evaluate(()=>PENS.some(x=>x.id==='ghk')),
      (await p.evaluate(()=>PENS.map(x=>x.id))).join(', '));
check('and the record agrees', ((await rec()).dropped||[]).length===0,
      JSON.stringify((await rec()).dropped));
await p.reload(); await p.waitForFunction(()=>typeof PENS!=='undefined',null,{timeout:15000});
check('and it survives a reload', await p.evaluate(()=>PENS.some(x=>x.id==='ghk')));

await br.close();
console.log(bad?`\n${bad} failing`:'\nall good');
process.exit(bad?1:0);
