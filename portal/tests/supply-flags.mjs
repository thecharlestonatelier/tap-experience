/* Telling at a glance who is out of something.

   The dashboard works this out from the prescription and the start day,
   not from what the patient's phone last reported — a patient who has
   not opened her card in a fortnight is exactly the one whose pen
   quietly ran out. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8095';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};

const pad = n => String(n).padStart(2, '0');
const daysAgo = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/* Tirzepatide is weekly from a 1 mL vial, so its life is long. The three
   cards below are the same prescription started at three different times:
   fresh, nearly empty, and past the end. */
const mk = (slug, name, startedDaysAgo, settingsOnly) => fetch(`${BASE}/api/cards`, {
  method: 'POST', headers: H,
  body: JSON.stringify(settingsOnly
    ? { slug, name, pens: [{ template: 'ghk' }], settings: { startDate: daysAgo(startedDaysAgo) } }
    : { slug, name, pens: [{ template: 'ghk' }], startDate: daysAgo(startedDaysAgo) })
});

const stamp = Date.now().toString(36);
const fresh = `fresh${stamp}.t`, low = `low${stamp}.t`, out = `out${stamp}.t`;

/* How long a tirzepatide vial actually lasts, read from the engine rather
   than guessed, so the three cards land where this test intends. */
const life = await (async () => {
  const br = await chromium.launch();
  const p = await br.newPage();
  await p.goto(`${BASE}/ritual.html#Life~ghk`);
  await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
  const days = await p.evaluate(() => {
    const pen = PENS[0];
    let n = 0;
    for (let i = 0; i < 900; i++) if (isDue(pen, addDays(START, i))) n = i + 1;
    return n;
  });
  await br.close();
  return days;
})();
console.log(`         a GHK-Cu pen lasts about ${life} days`);

await mk(fresh, 'Fresh Start', 1, false);
await mk(low, 'Nearly Out', life - 5, false);
await mk(out, 'Maggie Test', life + 14, false);
// and one whose start day only ever reached her phone, never the card
const viaSettings = `set${stamp}.t`;
await mk(viaSettings, 'Settings Only', life + 14, true);

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'ca_studio', value: TOK, url: BASE }]);
const p = await ctx.newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
await p.goto(`${BASE}/studio/`);
await p.waitForTimeout(3000);

const row = s => p.locator(`tr[data-slug="${s}"]`);
const pills = async s => (await row(s).locator('.pill').allInnerTexts()).join(' | ');

check('a fresh vial raises nothing',
      !(await pills(fresh)).toLowerCase().includes('left') &&
      !(await pills(fresh)).toLowerCase().includes('out of'),
      await pills(fresh));

const lowPills = await pills(low);
check('a vial nearly gone says how many days are left',
      /\d+d left/i.test(lowPills), lowPills);

const outPills = await pills(out);
check('a vial past its end says what she is out of',
      /out of/i.test(outPills) && /ghk/i.test(outPills), outPills);
check('and says it in the loud pill, not the quiet one',
      (await row(out).locator('.pill.stop').count()) === 1);

check('a start day that only reached her phone still counts',
      /out of/i.test(await pills(viaSettings)), await pills(viaSettings));
check('and that card no longer reads "waiting for her start day"',
      !(await row(viaSettings).locator('.dose').innerText()).includes('waiting for her start day'),
      await row(viaSettings).locator('.dose').innerText());

await br.close();

/* --- a vial she sized herself ---
   Tirzepatide is set up on the patient's phone, so this end cannot
   project it. The number has to come from her card's own report, and an
   old report is still right because the date it carries is absolute. */
{
  const slug = `tirz${stamp}.t`;
  await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
    body: JSON.stringify({ slug, name: 'Maggie Test', pens: [{ template: 'tirz' }],
      startDate: daysAgo(40) }) });

  const outDay = daysAgo(3);                 // her last dose was three days ago
  await fetch(`${BASE}/api/state/${slug}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: daysAgo(40), today: [],
      supply: [{ template: 'tirz', dosesLeft: 0, lastDose: outDay }] }) });

  const br2 = await chromium.launch();
  const c2 = await br2.newContext({ viewport: { width: 1400, height: 900 } });
  await c2.addCookies([{ name: 'ca_studio', value: TOK, url: BASE }]);
  const q = await c2.newPage();
  q.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
  await q.goto(`${BASE}/studio/`); await q.waitForTimeout(3000);
  const pl = (await q.locator(`tr[data-slug="${slug}"] .pill`).allInnerTexts()).join(' | ');
  check('a vial she sized herself is flagged from her own report',
        /out of/i.test(pl) && /tirzepatide/i.test(pl), pl);

  // and one with days still on the clock reads as low, not out
  const slug2 = `tirz2${stamp}.t`;
  await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H,
    body: JSON.stringify({ slug: slug2, name: 'Still Going', pens: [{ template: 'tirz' }],
      startDate: daysAgo(10) }) });
  await fetch(`${BASE}/api/state/${slug2}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: daysAgo(10), today: [],
      supply: [{ template: 'tirz', dosesLeft: 1, lastDose: daysAgo(-6) }] }) });
  await q.reload(); await q.waitForTimeout(3000);
  const pl2 = (await q.locator(`tr[data-slug="${slug2}"] .pill`).allInnerTexts()).join(' | ');
  check('and six days out reads as running low, not out',
        /6d left/i.test(pl2) && !/out of/i.test(pl2), pl2);
  await q.locator(`tr[data-slug="${slug}"]`).screenshot({ path: 'tests/_out.png' });
  await br2.close();
}

console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
