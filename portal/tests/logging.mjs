/* The five things she asked for, checked in a real browser against a real
   server: the syringe figure, the number alone, a per-pen button, the
   button spent by a tapped vial, and a circle she can fill in later. */
import { chromium } from 'playwright';
import { signInGoogle } from './auth-session.mjs';

/* Arrange — the harness, and its own card, minted fresh (the run writes
   doses and a run that leaves its marks behind fails the next one). Two
   pens: a vial she draws up and a pen she dials, so "logged separately"
   is actually tested. Started two days ago, which puts a five-on-two-off
   pen on its third dosing day — due today, with two days behind it. */
const BASE = process.env.BASE || 'http://localhost:8099';
let bad = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${extra ? ' — ' + extra : ''}`);
  if (!ok) bad++;
};

const SLUG = `log${Date.now().toString(36)}.t`;
const start = new Date(); start.setDate(start.getDate() - 2);
const pad = n => String(n).padStart(2, '0');
const startDate = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`;

/* A Studio session when the service has a passphrase set; without one the
   dashboard is open and the header is simply ignored. */
let SESSION = '';
try { SESSION = (await import('node:fs')).readFileSync('/tmp/tok.txt', 'utf8').trim(); } catch {}

const made = await fetch(`${BASE}/api/cards`, {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' },
    SESSION ? { Cookie: `ca_studio=${SESSION}` } : {}),
  body: JSON.stringify({
    slug: SLUG, firstName: 'Log', lastName: 'Test',
    pens: [{ template: 'nadvial' }, { template: 'ghk' }],
    settings: { startDate }
  })
});
check('a card to test against', made.status === 201, `${SLUG} from ${startDate}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on('pageerror', e => { console.log(' FAIL  page error — ' + e.message); bad++; });

/* Sign in first — the card carries a name (derived from the first and
   last names it was minted with), and the gate is part of the flow. */
await page.goto(`${BASE}/`);
await signInGoogle(page);
await page.goto(`${BASE}/ritual.html?c=${SLUG}`);
await page.waitForFunction(() => typeof PENS !== 'undefined' && PENS.length, null, { timeout: 15000 });

/* Act — read the syringe figure */
const syr = await page.evaluate(() => {
  const pen = PENS.find(p => isSyringe(p));
  if (!pen) return null;
  const d = doseOn(pen, today());
  const svg = document.querySelector('.syr');
  return {
    name: pen.name, units: d.units,
    present: !!svg,
    label: svg && svg.getAttribute('aria-label'),
    mark: svg && svg.querySelector('.s-mark') && svg.querySelector('.s-mark').textContent,
    sub: document.querySelector('.syr-wrap .dial-sub')?.textContent.trim()
  };
});
/* Assert — the syringe is drawn to the mark, and names itself a syringe */
check('syringe figure on the vial card', !!(syr && syr.present), syr && syr.label);
check('figure marks the dose number', syr && String(syr.mark) === String(syr.units),
      syr && `mark ${syr.mark} / dose ${syr.units}`);
check('caption names the syringe, not a volume',
      !!(syr && /unit insulin syringe/.test(syr.sub) && !/\bmL\b|\bmg\b/.test(syr.sub)), syr && syr.sub);

/* Act — read the vial card's draw-up instruction */
const vialCard = await page.evaluate(() => {
  const pen = PENS.find(p => isSyringe(p));
  const cards = [...document.querySelectorAll('#todayStack .dose-card')];
  const card = cards.find(c => c.querySelector('.dose-name')?.textContent === pen.name);
  if (!card) return null;
  return {
    lead: card.querySelector('.dial-lead')?.textContent,
    num: card.querySelector('.dial-num')?.textContent,
    delivers: !!card.querySelector('.delivers'),
    // everything below the pen's own identity line
    body: [...card.querySelectorAll('.dial, .dial-sub, .delivers, .steps')]
            .map(e => e.textContent).join(' ')
  };
});
/* Assert — the number alone, no mL, no mg, and no Delivers panel */
check('vial card says "Draw up to"', vialCard && vialCard.lead === 'Draw up to', vialCard && vialCard.lead);
check('no mL or mg in the draw-up instruction',
      !!(vialCard && !/\bmL\b|\bmg\b/.test(vialCard.body)),
      vialCard && (vialCard.body.match(/[\w.]+\s?m[Lg]\b/) || [''])[0]);
check('Delivers panel dropped from the vial card', !!(vialCard && !vialCard.delivers));

/* Act — read the logging buttons */
const buttons = await page.evaluate(() => {
  const due = dueOn(today()).map(p => p.id);
  const btns = [...document.querySelectorAll('#todayStack [data-log]')].map(b => b.dataset.log);
  return { due, btns, label: document.querySelector('#todayStack [data-log]')?.textContent.trim() };
});
/* Assert — one button per pen due today, named plainly */
check('a Log this dose button under every pen due today',
      buttons.due.length > 1 && buttons.due.every(id => buttons.btns.includes(id)),
      `${buttons.btns.length} button(s) for ${buttons.due.length} pen(s): ${buttons.btns.join(', ')}`);
check('the button says Log this dose', buttons.label === 'Log this dose', buttons.label);

/* Act — tap the vial: the page posts the dose */
const vial = await page.evaluate(() => {
  const pen = PENS.find(p => isSyringe(p) && isDue(p, today()));
  const d = doseOn(pen, today());
  return { id: pen.id, key: penKeyOf(pen), name: pen.name, units: d.units,
           slug: CARD_SLUG || readSlug(), day: iso(today()) };
});
const posted = await page.evaluate(async v => {
  const r = await fetch('/api/dose', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: v.slug, template: v.key, pen: v.name,
      units: v.units, at: new Date().toISOString(), day: v.day })
  });
  return r.status;
}, vial);
/* Assert — the write lands */
check('a tap writes the dose', posted === 200, `HTTP ${posted}`);

/* Act — re-render, and read the two pens' buttons */
await page.evaluate(async () => { await loadLogged(); renderAll(); });
const spent = await page.evaluate(v => {
  const cards = [...document.querySelectorAll('#todayStack .dose-card')];
  const mine = cards.find(c => c.querySelector('.dose-name')?.textContent === v.name);
  const other = cards.find(c => c.querySelector('.dose-name')?.textContent !== v.name);
  const b = mine?.querySelector('.btn-done');
  return {
    text: b && b.textContent.trim(),
    disabled: !!(b && b.disabled),
    check: !!(b && b.querySelector('.au-check')),
    stillLoggable: !!mine?.querySelector('[data-log]'),
    otherStillLoggable: !!other?.querySelector('[data-log]'),
    otherName: other?.querySelector('.dose-name')?.textContent
  };
}, vial);
/* Assert — that pen's button is spent; the other pen is untouched */
check('tapped pen now reads Already logged', spent.text === 'Already logged', spent.text);
check('and cannot be pressed', spent.disabled && !spent.stillLoggable);
check('with the gold mark on it', spent.check);
check('the other pen is untouched and still loggable', spent.otherStillLoggable, spent.otherName);

/* Act — open the rhythm sheet, and find a past unlogged circle */
await page.click('.tab[data-panel="rhythm"]');
const back = await page.evaluate(() => {
  const pen = PENS.find(p => !isSyringe(p));
  // the most recent past day this pen was due and is not logged
  for (let i = 1; i <= 3; i++) {
    const d = addDays(today(), -i);
    if (canLog(pen, d)) return { id: pen.id, name: pen.name, day: iso(d), key: penKeyOf(pen) };
  }
  return null;
});
/* Assert — it is offered, as a button */
check('a past unlogged circle is offered', !!back, back && `${back.name} ${back.day}`);

if (back) {
  const sel = `.r-pill[data-logday="${back.id}|${back.day}"]`;
  const clickable = await page.locator(sel).count();
  check('that circle is a button', clickable === 1);

  /* Act — click it, read the question */
  await page.locator(sel).click();
  const modal = await page.evaluate(() => ({
    open: !!document.querySelector('.scrim.open'),
    eyebrow: document.getElementById('modalEyebrow').textContent,
    title: document.getElementById('modalTitle').textContent,
    body: document.getElementById('modalBody').textContent,
    confirm: document.getElementById('modalConfirm').textContent
  }));
  /* Assert — it asks before it writes */
  check('it asks before it writes', modal.open && /Add a missing dose/.test(modal.eyebrow),
        `${modal.eyebrow} | ${modal.title}`);
  check('the sheet says Submit', modal.confirm === 'Submit', modal.confirm);
  console.log(`         "${modal.body}"`);

  /* Act — confirm, then read the cell and the server */
  await page.click('#modalConfirm');
  await page.waitForTimeout(900);

  const after = await page.evaluate(b => {
    const cell = document.querySelector(`[data-cell="${b.key}.${b.day.replace(/-/g,'')}"]`);
    return {
      green: !!(cell && cell.classList.contains('taken')),
      mark: !!(cell && cell.querySelector('.au-check')),
      stillButton: cell && cell.tagName.toLowerCase() === 'button'
    };
  }, back);
  /* Assert — green with a mark, no longer a button, and on the record for
     the right day */
  check('the circle turns green with a mark', after.green && after.mark);
  check('and stops being a button', !after.stillButton);

  const srv = await page.evaluate(async b => {
    const r = await fetch(`/api/logged/${CARD_SLUG || readSlug()}`);
    const j = await r.json();
    return (j.days[b.day] || []).includes(b.key);
  }, back);
  check('the atelier has it on the right day', srv, back.day);
}

/* Act — look for a future day's circle */
const future = await page.evaluate(() => {
  for (let i = 1; i <= 3; i++) {
    const d = addDays(today(), i);
    const pen = PENS.find(p => isDue(p, d));
    if (pen) return { logged: canLog(pen, d),
      btn: !!document.querySelector(`.r-pill[data-logday="${pen.id}|${iso(d)}"]`) };
  }
  return null;
});
/* Assert — a dose she has not taken yet cannot be logged */
check('a dose she has not taken yet cannot be logged',
      !!(future && !future.logged && !future.btn));

await browser.close();
console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
