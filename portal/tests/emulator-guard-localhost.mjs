/* The loopback guard in requireLocalHost, proven on a fake page object —
   no browser, no service, no network. A URL on any host but the loopback
   must throw naming that host; localhost, 127.0.0.1 and [::1] must pass;
   and a page whose url() is not a URL must refuse rather than pass. */
import { requireLocalHost } from './emulator-guard.mjs';

let bad = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${x ? ' — ' + x : ''}`); if (!ok) bad++; };
const throws = (fn, needle, label) => {
  try { fn(); check(label, false, 'did not throw'); }
  catch (e) { check(label, String(e.message).includes(needle), e.message); }
};
const fake = url => ({ url: () => url });

/* Act — a deployed URL */
throws(() => requireLocalHost(fake('https://atelier.example.com/ritual.html?c=x')),
  'Refusing to sign into live Firebase',
  'a non-localhost host refuses to sign in');

/* Act — a deployed URL that names the host in the message */
throws(() => requireLocalHost(fake('https://tap.thecharlestonatelier.com/')),
  'tap.thecharlestonatelier.com',
  'the refusal names the host');

/* Act — the three loopback forms */
let out;
out = requireLocalHost(fake('http://localhost:8096/'));
check('localhost passes', out === 'http://localhost:8096/', out);
out = requireLocalHost(fake('https://127.0.0.1:8096/ritual.html'));
check('127.0.0.1 passes', out === 'https://127.0.0.1:8096/ritual.html', out);
out = requireLocalHost(fake('http://[::1]:8096/'));
check('[::1] passes', out === 'http://[::1]:8096/', out);

/* Act — a page whose address is not a URL at all */
throws(() => requireLocalHost(fake('not a url')),
  'Refusing to sign into live Firebase',
  'an unparseable address refuses rather than passes');

console.log(bad ? `\n${bad} FAILED` : '\nPASS — only the loopback signs in; everything else refuses.');
process.exit(bad ? 1 : 0);
