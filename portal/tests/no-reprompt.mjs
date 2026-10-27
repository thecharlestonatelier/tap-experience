/* A card that is already anchored must never ask again.

   Safari clears script storage for a site not visited in seven days. The
   card used to ask "which day did you start?" whenever THIS BROWSER had no
   answer — so a patient two months into a protocol was asked the question
   and shown a two-month-old date. One tap on "Today" moved her phases,
   her supply, her refill date and her calendar forward two months. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = readFileSync('/tmp/tok.txt','utf8').trim();
const H = { 'Content-Type':'application/json', Cookie:`ca_studio=${TOK}` };
let bad = 0;
const check = (n, ok, x='') => { console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`); if(!ok) bad++; };
const pad = n => String(n).padStart(2,'0');
const ago = n => { const d=new Date(); d.setDate(d.getDate()-n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };

const stamp = Date.now().toString(36);
const onIt = `anch${stamp}.t`, fresh = `new${stamp}.t`, logged = `log${stamp}.t`;

// two months in, start day on the record — her mother's case
await fetch(`${BASE}/api/cards`,{method:'POST',headers:H,body:JSON.stringify({
  slug:onIt, name:'Two Months In', pens:[{template:'ghk'}], startDate: ago(60) })});
// a card with no start day anywhere
await fetch(`${BASE}/api/cards`,{method:'POST',headers:H,body:JSON.stringify({
  slug:fresh, name:'Brand New', pens:[{template:'ghk'}] })});
// no start day typed, but she has logged a dose
await fetch(`${BASE}/api/cards`,{method:'POST',headers:H,body:JSON.stringify({
  slug:logged, name:'Has Logged', pens:[{template:'ghk'}] })});
await fetch(`${BASE}/api/dose`,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({ slug:logged, template:'ghk', pen:'GHK-Cu', units:6,
    at:new Date().toISOString(), day: ago(20) })});

const br = await chromium.launch();
/* Each visit is a BRAND NEW context: no localStorage, which is exactly
   what Safari leaves behind after seven quiet days. */
const visit = async slug => {
  const p = await (await br.newContext({ viewport:{width:420,height:900} })).newPage();
  p.on('pageerror', e => { console.log(' FAIL  page error — '+e.message); bad++; });
  await p.goto(`${BASE}/ritual.html?c=${slug}`);
  await p.waitForFunction(() => typeof PENS!=='undefined' && PENS.length, null, {timeout:15000});
  await p.waitForTimeout(900);
  const asked = await p.evaluate(() => !!document.querySelector('#startScrim.open'));
  const start = await p.evaluate(() => penStartIso(PENS[0]));
  return { p, asked, start };
};

const a = await visit(onIt);
check('a card two months in is not asked again', !a.asked, `start ${a.start}`);
check('and keeps its start day', a.start === ago(60), a.start);

const l = await visit(logged);
check('a card with a logged dose is not asked', !l.asked, `start ${l.start}`);
check('and takes its start from that dose', l.start === ago(20), l.start);

const f = await visit(fresh);
check('a card nobody has dated is still asked', f.asked);

/* The change link must still reach the sheet. */
await f.p.goto(`${BASE}/ritual.html?c=${onIt}&change=1`);
await f.p.waitForFunction(() => typeof PENS!=='undefined' && PENS.length, null, {timeout:15000});
await f.p.waitForTimeout(900);
check('the calendar\'s change link still opens it',
      await f.p.evaluate(() => !!document.querySelector('#startScrim.open')));

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
