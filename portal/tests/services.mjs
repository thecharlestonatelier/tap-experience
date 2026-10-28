/* Treatments given in the room, and when the next one is due.
   The cadences are Dr Kendall's, stated in her own words. */
import { readFileSync } from 'node:fs';

/* Arrange — a studio session, the harness, and the date helpers */
const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = readFileSync('/tmp/tok.txt','utf8').trim();
const H = { 'Content-Type':'application/json', Cookie:`ca_studio=${TOK}` };
let bad = 0;
const check=(n,ok,x='')=>{console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`);if(!ok)bad++;};
const pad=n=>String(n).padStart(2,'0');
const ago=n=>{const d=new Date();d.setDate(d.getDate()-n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};

/* Act — read the menu the dashboard serves */
const { services } = await (await fetch(`${BASE}/api/services`)).json();
const by = id => services.find(s => s.id === id);
/* Assert — it is served, in the colours she asked for */
check('the menu is served', services.length > 0, services.map(s=>s.id).join(', '));
check('toxin is blue',            by('toxin').color === 'blue');
check('filler is pink',           by('filler').color === 'pink');
check('PRX is magenta',           by('prx').color === 'magenta');
check('polynucleotides are light purple', by('poly').color === 'light purple');

/* Arrange — one fresh card to hang the visits on */
const slug = `svc${Date.now().toString(36)}.t`;
const mk = visits => fetch(`${BASE}/api/cards/${slug}`, { method:'PUT', headers:H,
  body: JSON.stringify({ visits }) });
await fetch(`${BASE}/api/cards`, { method:'POST', headers:H,
  body: JSON.stringify({ slug, name:'Service Test', pens:[] }) });

const state = async id => {
  const list = await (await fetch(`${BASE}/api/cards`, { headers:H })).json();
  const card = list.cards.find(c => c.slug === slug);
  return (card.services || []).find(s => s.id === id);
};

/* Act — PRX, once a week */
await mk([{service:'prx',date:ago(0)}]);
/* Assert — due in a week */
check('PRX after one is due in a week', (await state('prx')).next.days === 7);

/* Act — three weekly PRX visits */
await mk([{service:'prx',date:ago(14)},{service:'prx',date:ago(7)},{service:'prx',date:ago(0)}]);
/* Assert — still weekly */
check('and still weekly after three', (await state('prx')).next.days === 7);

/* Act — the fourth visit of the series */
await mk([{service:'prx',date:ago(21)},{service:'prx',date:ago(14)},
          {service:'prx',date:ago(7)},{service:'prx',date:ago(0)}]);
/* Assert — monthly from then on */
check('then monthly once the series of four is done',
      (await state('prx')).next.days === 30, `${(await state('prx')).next.days} days`);

/* Act — a toxin visit */
await mk([{service:'toxin',date:ago(0),units:24}]);
/* Assert — due in three months */
check('toxin comes back in three months', (await state('toxin')).next.days === 90);

/* Act — a toxin visit further back than the cadence */
await mk([{service:'toxin',date:ago(100)}]);
/* Assert — reads overdue */
check('and reads overdue once it is past', (await state('toxin')).next.overdue === true,
      `${(await state('toxin')).next.days} days`);

/* Act — a filler visit */
await mk([{service:'filler',date:ago(30)}]);
const f = await state('filler');
/* Assert — no cadence, and none invented */
check('filler is given no due date at all', f.next.none === true && !f.next.due,
      JSON.stringify(f.next));

/* Act — one polynucleotide visit */
await mk([{service:'poly',date:ago(0)}]);
/* Assert — due in four weeks */
check('polynucleotides come back in four weeks', (await state('poly')).next.days === 28);

/* Act — the third polynucleotide visit */
await mk([{service:'poly',date:ago(56)},{service:'poly',date:ago(28)},{service:'poly',date:ago(0)}]);
const pol = await state('poly');
/* Assert — the course ends at three */
check('and the course ends at three', pol.next.done === true && pol.next.course === '3 of 3',
      JSON.stringify(pol.next));

/* Act — a liquid-lipo visit */
await mk([{service:'lipo',date:ago(0),area:'Underarm, per side'}]);
const lip = await state('lipo');
/* Assert — due at eight weeks, window to ten */
check('lipo is due at eight weeks', lip.next.days === 56, `${lip.next.days} days`);
check('with the window running to ten', lip.next.window &&
      lip.next.window[1] === ago(-70), JSON.stringify(lip.next.window));

/* Act — the second lipo visit */
await mk([{service:'lipo',date:ago(70)},{service:'lipo',date:ago(0)}]);
/* Assert — the course ends at two */
check('and the course ends at two', (await state('lipo')).next.done === true);

/* Act — a visit the menu does not carry, alongside a real one */
await mk([{service:'not-a-service',date:ago(0)},{service:'toxin',date:ago(1)}]);
const list = await (await fetch(`${BASE}/api/cards`, { headers:H })).json();
const card = list.cards.find(c => c.slug === slug);
/* Assert — refused on the way in, the real one kept */
check('an unknown treatment is dropped on the way in',
      card.visits.length === 1 && card.visits[0].service === 'toxin',
      JSON.stringify(card.visits));

/* Act — a visit with no date */
const noDate = await (await fetch(`${BASE}/api/cards/${slug}`, { method:'PUT', headers:H,
  body: JSON.stringify({ visits:[{service:'toxin'}] }) })).json();
/* Assert — dropped too */
check('and a visit with no date too', noDate.visits.length === 0);

console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
