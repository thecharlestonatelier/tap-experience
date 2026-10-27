import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';
const B=process.env.BASE||'http://localhost:8096', TOK=readFileSync('/tmp/tok.txt','utf8').trim();
const H={'Content-Type':'application/json',Cookie:`ca_studio=${TOK}`};
let bad=0; const check=(n,ok,x='')=>{console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`);if(!ok)bad++;};
/* Its own card each run, so a previous run's leftovers cannot decide
   what this one sees. */
const SLUG = `sp${Date.now().toString(36)}.t`;
await fetch(`${B}/api/cards`, { method:'POST', headers:H, body: JSON.stringify({
  slug: SLUG, name: 'Studio Pens', pens:[{template:'ghk'}],
  settings:{ startDate:'2026-10-22' } }) });

// patient has stopped ghk
await fetch(`${B}/api/added/${SLUG}`,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({dropped:['ghk']})});
const br=await chromium.launch(); const ctx=await br.newContext({viewport:{width:1200,height:900}});
await ctx.addCookies([{name:'ca_studio',value:TOK,url:B}]);
const p=await ctx.newPage(); p.on('dialog',d=>d.accept()); p.on('pageerror',e=>{console.log('ERR',e.message);bad++;});
await p.goto(`${B}/studio/`); await p.waitForTimeout(2500);
await p.locator(`tr[data-slug="${SLUG}"]`).first().click(); await p.waitForTimeout(1200);
const txt=await p.locator('#penList').innerText();
check('Studio says she stopped it', /stopped these/i.test(txt) && /GHK/i.test(txt),
      txt.split('\n').slice(0,4).join(' | '));
check('with a way to put it back', (await p.locator('[data-undrop]').count())===1);
await p.locator('[data-undrop]').first().click(); await p.waitForTimeout(500);
await p.locator('#saveCard').click(); await p.waitForTimeout(1500);
const rec=await (await fetch(`${B}/api/card/${SLUG}`)).json();
check('saving puts it back on the record', (rec.dropped||[]).length===0, JSON.stringify(rec.dropped));
// and it returns to her card
const q=await (await br.newContext()).newPage();
await q.goto(`${B}/`);
await signInGoogle(q);
await q.goto(`${B}/ritual.html?c=${SLUG}`);
await q.waitForFunction(()=>typeof PENS!=='undefined'&&PENS.length,null,{timeout:15000});
check('and back onto her card', await q.evaluate(()=>PENS.some(x=>x.id==='ghk')),
      (await q.evaluate(()=>PENS.map(x=>x.id))).join(', '));
await br.close();
console.log(bad?`\n${bad} failing`:'\nall good'); process.exit(bad?1:0);
