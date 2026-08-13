/* ==================================================================
   CARD SLUGS
   ------------------------------------------------------------------
   The slug is the whole address of a card: tap.thecharlestonatelier.com
   /phil.h. It is written to the tag once, before the protocol is known,
   and never changes again — everything the patient sees is looked up
   behind it. That is what lets a stack of tags be written ahead of a
   clinic day and assigned afterwards.

   A slug is first name, a dot, last initial. Optionally a dash and three
   random characters, which is what stops someone reading a stranger's
   protocol by guessing /john.s. With ~34,000 combinations per name a
   guess is no longer worth attempting, and the card is still legible to
   a human sorting a tray of them.
   ================================================================== */

// No vowels and no look-alikes: nothing here can be misread off a card
// or turn into a word by accident.
const ALPHABET = '23456789bcdfghjkmnpqrstvwxz';

const SHAPE = /^[a-z0-9][a-z0-9.\-]{0,38}[a-z0-9]$/;

// Routes and files that must never be shadowed by a patient's card.
const RESERVED = new Set([
  'api', 'studio', 'admin', 'login', 'logout', 'health', 'assets',
  'files', 'library', 'index', 'ritual', 'cards', 'calendar', 'wallet',
  'templates', 'protocol', 'favicon', 'robots', 'sitemap', 'well-known'
]);

function randomSuffix(n = 3) {
  const bytes = new Uint8Array(n);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

/* "Phillip", "Hurley" → "phil.h". The given name is trimmed to four
   characters because that is what fits a card and still reads as a name;
   shorter names keep whatever they have. */
function baseSlug(firstName, lastName) {
  const first = String(firstName || '')
    .toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  const last = String(lastName || '')
    .toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  if (!first) return '';
  const stem = first.slice(0, 4);
  return last ? `${stem}.${last[0]}` : stem;
}

/* The address as written on the tag. `unique: false` gives the bare
   phil.h the atelier asked for; true adds the three characters that
   make it unguessable. */
function makeSlug(firstName, lastName, { unique = true } = {}) {
  const base = baseSlug(firstName, lastName);
  if (!base) return '';
  return unique ? `${base}-${randomSuffix()}` : base;
}

/* A slug the atelier can hand out before anyone is assigned to it —
   for pre-writing a tray of blank tags. */
function blankSlug() {
  return randomSuffix(6);
}

function isValidSlug(s) {
  if (typeof s !== 'string') return false;
  const v = s.toLowerCase();
  if (v.length < 2 || v.length > 40) return false;
  if (!SHAPE.test(v)) return false;
  if (v.includes('..') || v.includes('--')) return false;
  return !RESERVED.has(v.split(/[.\-]/)[0]) && !RESERVED.has(v);
}

/* Cards are handed out on paper and read aloud over the phone, so the
   address has to survive a capital letter or a trailing slash. */
function normalizeSlug(s) {
  return String(s || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

module.exports = {
  ALPHABET, makeSlug, baseSlug, blankSlug, randomSuffix,
  isValidSlug, normalizeSlug, RESERVED
};
