/* Card Studio's activation surface: a linked card shows the LINKED pill
   and a detail line with name, provider, uid and timestamp; a fresh card
   shows NOT LINKED; the confirmed Unlink control clears the link and the
   pill follows. Needs (see tests/README.md):

     SEED_FILE=.data-test/studio-link-cards.json npm run seed
     CARD_STORE=file CARD_FILE=.data-test/studio-link-cards.json \
       STUDIO_PASSPHRASE=testpassphrase PORT=8093 node server.js */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/* Arrange — a studio session and the dashboard open */
const BASE = 'http://localhost:8093';
const TOK = readFileSync('/tmp/tok.txt', 'utf8').trim();

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addCookies([{ name: 'ca_studio', value: TOK, url: BASE }]);
const p = await ctx.newPage();
p.on('dialog', d => d.accept());
p.on('pageerror', e => console.log('    page error:', e.message));

await p.goto(`${BASE}/studio/`);
await p.waitForSelector('#rows tr', { timeout: 15000 });

const row = slug => p.locator(`#rows tr[data-slug="${slug}"]`);
const pill = slug => row(slug).locator('[data-link]');

/* Act — read the pills */
const linkedText = await pill('linked.t').textContent();
const freshText = await pill('fresh.t').textContent();
/* Assert — each card wears its state */
check('linked card pill says LINKED', /LINKED/i.test(linkedText), linkedText.trim());
check('fresh card pill says NOT LINKED', /NOT LINKED/i.test(freshText), freshText.trim());

/* Act — open the detail line on the linked card */
await pill('linked.t').click();
const detailLine = p.locator('#rows tr.link-detail[data-slug="linked.t"] td');
await detailLine.filter({ hasText: 'Activated by' }).waitFor({ timeout: 8000 });
const detail = await detailLine.textContent();
/* Assert — name, provider, uid and timestamp; never an email */
check('detail line shows the name', /Linked Example/.test(detail), detail.trim());
check('detail line shows the provider', /google\.com/.test(detail), detail.trim());
check('detail line shows the uid', /u123/.test(detail), detail.trim());
check('detail line shows a timestamp', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(detail), detail.trim());
check('no email renders in the detail line', !/@/.test(detail), detail.trim());

/* Act — click the pill again */
await pill('linked.t').click();
/* Assert — the detail line closes */
check('the detail line closes again', await p.locator('#rows tr.link-detail[data-slug="linked.t"]').isHidden());

/* Act — the confirmed unlink */
await pill('linked.t').click();
await p.locator('#rows tr.link-detail[data-slug="linked.t"] [data-unlink]').click();
await p.waitForTimeout(1200);
/* Assert — the record is cleared and the pill follows */
const rec = await (await fetch(`${BASE}/api/cards/linked.t`, {
  headers: { Cookie: `ca_studio=${TOK}` }
})).json();
check('unlink cleared the record', !rec.activatedBy, JSON.stringify(rec.activatedBy));
const afterText = await pill('linked.t').textContent();
check('the pill follows to NOT LINKED', /NOT LINKED/i.test(afterText), afterText.trim());

/* Assert — the pill click did not open the editor */
check('the editor stayed closed', await p.locator('#editor').evaluate(el => !el.open));

await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nPASS — the Studio shows who activated each card, and the clinician can clear a wrong link.');
process.exit(bad ? 1 : 0);
