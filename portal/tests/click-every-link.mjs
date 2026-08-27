/* Click every internal link on every page, in both kinds of card, and
   assert the patient is never told her card is not set up. */
import { chromium } from 'playwright';
const BASE='http://localhost:8087';
const CARDS = [
  ['slug card',     '/layn.p-v2p',                       'Layna'],
  ['fragment card', '/#Christie~tir:5-28.7-28.10-28',    'Christie'],
];
const PAGES = ['', 'ritual.html', 'cards.html', 'calendar.html', 'library.html'];
let bad=0; const check=(n,ok,x='')=>{console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`); if(!ok)bad++;};

const b=await chromium.launch(); const page=await b.newPage();
page.on('pageerror', e=>console.log('  PAGE ERROR:', e.message));

const broken = async () => {
  await page.waitForTimeout(750);
  await page.evaluate(()=>document.getElementById('startScrim')?.classList.remove('open'));
  const t = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  return /not set up|does not carry a protocol|no protocol on it yet/i.test(t);
};

for (const [label, entry, who] of CARDS) {
  console.log(`\n${label}  ${entry}`);
  let clicks = 0, fails = 0;
  for (const p of PAGES) {
    // enter through the card, then walk to the page
    await page.goto(BASE + entry);
    await page.waitForTimeout(700);
    if (p) {
      const sep = entry.includes('#') ? entry.slice(entry.indexOf('#')) : '';
      const q = entry.includes('#') ? '' : `?c=${entry.slice(1)}`;
      await page.goto(`${BASE}/${p}${q}${sep}`);
      await page.waitForTimeout(700);
    }
    const hrefs = await page.$$eval('a[href]', as => as
      .map(a=>a.getAttribute('href'))
      .filter(h => h && !/^(https?:|sms:|tel:|mailto:|#)/i.test(h)));
    for (const h of [...new Set(hrefs)]) {
      const from = p || '(card)';
      await page.evaluate(()=>document.getElementById('startScrim')?.classList.remove('open'));
      const el = await page.$(`a[href="${h.replace(/"/g,'\\"')}"]`);
      if (!el) continue;
      await el.click().catch(()=>{});
      clicks++;
      if (await broken()) { fails++; console.log(`     BROKEN: ${from} -> ${h} -> ${page.url().replace(BASE,'')}`); }
      // back to where we were
      await page.goBack().catch(()=>{});
      await page.waitForTimeout(400);
    }
  }
  check(`${label}: ${clicks} links clicked, none lost the card`, fails===0, fails?`${fails} broke`:'');
}

// and the guard must not resurrect a card on a cold visit to the root
await page.goto(`${BASE}/layn.p-v2p`); await page.waitForTimeout(700);
const ctx2 = await b.newContext(); const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/`); await p2.waitForTimeout(800);
const rootTxt = await p2.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
check('a cold visit to the root still names nobody',
  /not set up/i.test(rootTxt) && !/layna|christie/i.test(rootTxt));

await b.close();
console.log(bad?`\n${bad} FAILED`:'\nPASS — no link on any page can lose the card.');
process.exit(bad?1:0);
