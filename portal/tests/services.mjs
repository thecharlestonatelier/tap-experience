/* Treatments given in the room, and when the next one is due.
   The cadences are Dr Kendall's, stated in her own words. */
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8094';
const TOK = readFileSync('/tmp/tok.txt','utf8').trim();
const H = { 'Content-Type':'application/json', Cookie:`ca_studio=${TOK}` };
let bad = 0;
const check=(n,ok,x='')=>{console.log(`${ok?'  ok  ':' FAIL '} ${n}${x?' — '+x:''}`);if(!ok)bad++;};
const pad=n=>String(n).padStart(2,'0');
const ago=n=>{const d=new Date();d.setDate(d.getDate()-n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};

const { services } = await (await fetch(`${BASE}/api/services`)).json();
const by = id => services.find(s => s.id === id);
check('the menu is served', services.length > 0, services.map(s=>s.id).join(', '));

/* The colours she asked for. */
check('toxin is blue',            by('toxin').color === 'blue');
check('filler is pink',           by('filler').color === 'pink');
check('PRX is magenta',           by('prx').color === 'magenta');
check('polynucleotides are light purple', by('poly').color === 'light purple');

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

/* PRX: once a week for four weeks, then monthly. */
await mk([{service:'prx',date:ago(0)}]);
check('PRX after one is due in a week', (await state('prx')).next.days === 7);
await mk([{service:'prx',date:ago(14)},{service:'prx',date:ago(7)},{service:'prx',date:ago(0)}]);
check('and still weekly after three', (await state('prx')).next.days === 7);
await mk([{service:'prx',date:ago(21)},{service:'prx',date:ago(14)},
          {service:'prx',date:ago(7)},{service:'prx',date:ago(0)}]);
check('then monthly once the series of four is done',
      (await state('prx')).next.days === 30, `${(await state('prx')).next.days} days`);

/* Toxin: every three months. */
await mk([{service:'toxin',date:ago(0),units:24}]);
check('toxin comes back in three months', (await state('toxin')).next.days === 90);
await mk([{service:'toxin',date:ago(100)}]);
check('and reads overdue once it is past', (await state('toxin')).next.overdue === true,
      `${(await state('toxin')).next.days} days`);

/* Filler: no cadence, and must not invent one. */
await mk([{service:'filler',date:ago(30)}]);
const f = await state('filler');
check('filler is given no due date at all', f.next.none === true && !f.next.due,
      JSON.stringify(f.next));

/* Polynucleotides: every four weeks, two to three sessions. */
await mk([{service:'poly',date:ago(0)}]);
check('polynucleotides come back in four weeks', (await state('poly')).next.days === 28);
await mk([{service:'poly',date:ago(56)},{service:'poly',date:ago(28)},{service:'poly',date:ago(0)}]);
const pol = await state('poly');
check('and the course ends at three', pol.next.done === true && pol.next.course === '3 of 3',
      JSON.stringify(pol.next));

/* Liquid lipo: eight to ten weeks, one to two sessions. */
await mk([{service:'lipo',date:ago(0),area:'Underarm, per side'}]);
const lip = await state('lipo');
check('lipo is due at eight weeks', lip.next.days === 56, `${lip.next.days} days`);
check('with the window running to ten', lip.next.window &&
      lip.next.window[1] === ago(-70), JSON.stringify(lip.next.window));
await mk([{service:'lipo',date:ago(70)},{service:'lipo',date:ago(0)}]);
check('and the course ends at two', (await state('lipo')).next.done === true);

/* A visit the menu does not carry is refused rather than stored. */
await mk([{service:'not-a-service',date:ago(0)},{service:'toxin',date:ago(1)}]);
const list = await (await fetch(`${BASE}/api/cards`, { headers:H })).json();
const card = list.cards.find(c => c.slug === slug);
check('an unknown treatment is dropped on the way in',
      card.visits.length === 1 && card.visits[0].service === 'toxin',
      JSON.stringify(card.visits));
check('and a visit with no date too',
      (await (await fetch(`${BASE}/api/cards/${slug}`, { method:'PUT', headers:H,
        body: JSON.stringify({ visits:[{service:'toxin'}] }) })).json()).visits.length === 0);

console.log(bad ? `\n${bad} failing` : '\nall good');
process.exit(bad ? 1 : 0);
