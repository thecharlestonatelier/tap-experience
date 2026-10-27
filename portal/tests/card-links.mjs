/* Christie's whole journey: every page, every link, and back again. */
import { chromium } from 'playwright';
const BASE = 'http://localhost:8093';
const CARD = '#Christie~tir:5-28.7-28.10-28';
let bad = 0;
const check = (n, ok, extra='') => { console.log(`${ok?'  ok  ':' FAIL '} ${n}${extra?' — '+extra:''}`); if(!ok) bad++; };

const browser = await chromium.launch();
const page = await browser.newPage();

for (const start of ['/', '/ritual.html', '/cards.html', '/calendar.html', '/library.html']) {
  await page.goto(`${BASE}${start}${CARD}`);
  await page.waitForTimeout(900);
  const bare = await page.$$eval('a[href]', as => as
    .map(a => a.getAttribute('href'))
    .filter(h => h && !/^(https?:|sms:|tel:|mailto:|#)/i.test(h))
    .filter(h => !h.includes('#')));
  check(`${start.padEnd(16)} every internal link carries the card`, bare.length === 0, bare.join(' '));
}

console.log('\nthe journey she actually takes:');
await page.goto(`${BASE}/${CARD}`);
await page.waitForSelector('body.resolved');
check('card opens', (await page.textContent('#patientName')).trim() === 'Christie');

for (const [label, sel] of [["Today's Ritual", '#menu a:nth-of-type(1)'], ['back', 'a.back']]) {
  // First visit asks which day she started; it covers the page until answered.
  const scrim = await page.$('#startScrim.open');
  if (scrim) {
    await page.click('#startConfirm, #startSave, .scrim .primary').catch(async () => {
      await page.evaluate(() => document.getElementById('startScrim')?.classList.remove('open'));
    });
    await page.waitForTimeout(500);
  }
  await page.click(sel);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  console.log(`   after ${label}: ${page.url().replace(BASE,'')}`);
}
await page.waitForSelector('body.resolved', { timeout: 5000 }).catch(()=>{});
const name = (await page.textContent('#patientName')).trim();
check('back arrow returns to her card', name === 'Christie', name);

// bottom nav from the ritual page
await page.goto(`${BASE}/ritual.html${CARD}`);
await page.waitForTimeout(900);
const navs = await page.$$eval('.nav a, #bottomNav a', as => as.map(a => a.getAttribute('href')));
console.log('   ritual bottom nav:', JSON.stringify(navs));
check('bottom nav carries the card',
  navs.filter(h => h && !/^(https?:|sms:|tel:|mailto:)/i.test(h)).every(h => h.includes('#')));

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the card survives every link on every page.');
process.exit(bad?1:0);
