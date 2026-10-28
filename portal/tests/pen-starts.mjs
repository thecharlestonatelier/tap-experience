/* Each pen keeps its own start day.

   One start day for the whole protocol was wrong the moment a second pen
   existed: a patient months into one pen who begins another today was
   asked "which day did you start?", and answering today dragged the first
   pen back with it — new phase, wrong dial number, wrong supply. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — the harness, and a two-pen card planned sixty days ago */
const BASE = process.env.BASE || 'http://localhost:8095';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();
const H = { 'Content-Type': 'application/json', Cookie: `ca_studio=${TOK}` };
let bad = 0;
const check = (n, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`);
  if (!ok) bad++;
};
const pad = n => String(n).padStart(2, '0');
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const slug = `start${Date.now().toString(36)}.t`;
await fetch(`${BASE}/api/cards`, { method: 'POST', headers: H, body: JSON.stringify({
  slug, name: 'Two Pens', pens: [{ template: 'ghk' }, { template: 'bpc' }],
  settings: { startDate: daysAgo(60) } }) });

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 420, height: 1000 } })).newPage();
p.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });
p.on('dialog', d => d.accept());
/* Sign in first — the card is named, and the gate is part of the flow. */
await p.goto(`${BASE}/`);
await signInGoogle(p);
await p.goto(`${BASE}/ritual.html?c=${slug}`);
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });

const starts = () => p.evaluate(() =>
  Object.fromEntries(PENS.map(x => [x.id, penStartIso(x)])));

await p.evaluate(() => { try { closeStartPicker(); } catch {} });
await p.waitForTimeout(400);

/* Assert — the starting point: both pens on the protocol day */
const before = await starts();
check('both pens begin on the protocol day', before.ghk === before.bpc, JSON.stringify(before));

/* Act — open the picker */
await p.evaluate(() => openStartPicker());
await p.waitForTimeout(400);
/* Assert — it asks per pen, and the single-date field steps aside */
check('the sheet asks about each one',
      (await p.locator('#startPens [data-penstart]').count()) === 2,
      await p.locator('#startTitle').innerText());
check('and the single-date field steps aside',
      await p.locator('#startInput').isHidden());

/* Act — move one pen, save */
const newDay = daysAgo(3);
await p.evaluate(d => {
  document.querySelector('[data-penstart="bpc"]').value = d;
}, newDay);
await p.click('#startSave');
await p.waitForTimeout(800);

/* Assert — the one she moved moved; the other is untouched */
const after = await starts();
check('the pen she moved moved', after.bpc === newDay, after.bpc);
check('and the one she did not is untouched', after.ghk === before.ghk,
      `${before.ghk} -> ${after.ghk}`);

/* Act — reload */
await p.reload();
await p.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });
await p.evaluate(() => { try { closeStartPicker(); } catch {} });
/* Assert — both are remembered */
const kept = await starts();
check('both are remembered', kept.bpc === newDay && kept.ghk === before.ghk,
      JSON.stringify(kept));

/* Act — she adds a pen */
await p.evaluate(async () => {
  const t = await loadTemplates();
  addPen(t.templates.find(x => x.id === 'semax'));
  renderAll();
});
await p.waitForTimeout(600);
const added = await starts();
/* Assert — the new one starts today, and the others do not move */
check('a pen added today starts today',
      added[Object.keys(added).find(k => k.startsWith('semax'))] === daysAgo(0));
check('and the pens already there do not move',
      added.bpc === newDay && added.ghk === before.ghk, JSON.stringify(added));

/* Act — the card reports its state, and the dashboard reads it back */
await p.evaluate(() => reportState(true));
await p.waitForTimeout(1500);
// The patient-facing view deliberately omits the state report — it came
// from her phone and she has no use for it back — so read the dashboard's.
const list = await (await fetch(`${BASE}/api/cards`, { headers: H })).json();
const rec = list.cards.find(c => c.slug === slug);
const reported = Object.fromEntries(
  ((rec.state && rec.state.supply) || []).map(s => [s.template, s.startDate]));
/* Assert — each pen's own day reaches the atelier */
check('each pen\'s day reaches the atelier',
      reported.bpc === newDay && reported.ghk === before.ghk, JSON.stringify(reported));

/* Act — open the rhythm sheet and count the remove controls */
await p.click('.tab[data-panel="rhythm"]');
await p.waitForTimeout(500);
/* Assert — every pen carries one, due today or not */
check('every pen carries a remove control in the rhythm sheet',
      (await p.locator('#rhythmList [data-drop]').count()) ===
      (await p.evaluate(() => PENS.length)),
      `${await p.locator('#rhythmList [data-drop]').count()} control(s)`);

/* Act — use it */
await p.locator('#rhythmList [data-drop]').first().click();
await p.waitForTimeout(900);
/* Assert — the pen comes off */
check('and it works from there',
      (await p.evaluate(() => PENS.length)) === Object.keys(added).length - 1,
      (await p.evaluate(() => PENS.map(x => x.id))).join(', '));

await br.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
