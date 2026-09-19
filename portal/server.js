/* ==================================================================
   THE CHARLESTON ATELIER — tap card service
   ------------------------------------------------------------------
   Serves three things off one origin:

     /phil.h            a patient's card. The tag is written once with
                        this address and never again; the protocol behind
                        it is edited from the dashboard.
     /api/*             the record the card reads, and the dashboard's
                        writes.
     everything else    the portal itself — the same HTML, CSS and dosing
                        engine the static site serves, read straight from
                        patients/jessica so the two can never drift.

   Cards written before this service existed carry their protocol in the
   URL fragment and keep working untouched: the fragment never reaches
   here, and the portal still decodes it client-side.

   No dependencies. Firestore is required lazily, only in the cloud, so
   this file runs on a laptop with nothing installed.
   ================================================================== */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { openStore, sanitize, publicView, assertSlug, sanitizeState } = require('./store');
const { openDoses, sanitizeDose } = require('./store/doses');
const { openFeeds, sanitizeFeed } = require('./store/feeds');
const { openSubs, sanitizeSub, idFor: subIdFor, dueNow } = require('./store/subs');
const { makeSlug, blankSlug, isValidSlug, normalizeSlug } = require('./lib/slug');
const wallet = require('./lib/wallet');
const push = require('./lib/push');

const PORT = Number(process.env.PORT) || 8080;

/* In the container the portal is copied to ./public. On a laptop it is
   read straight out of the repo, so the service and the static site are
   always running the same pages. */
const WEB_ROOT = process.env.WEB_ROOT
  || (fs.existsSync(path.join(__dirname, 'public'))
        ? path.join(__dirname, 'public')
        : path.join(__dirname, '..', 'patients', 'jessica'));
const STUDIO_PASSPHRASE = process.env.STUDIO_PASSPHRASE || '';

/* Cloud Run runs several instances and replaces them freely, so a random
   per-process secret would sign a cookie one instance could not verify —
   the dashboard would appear to log itself out at random. Derive it from
   the passphrase instead, so every instance agrees without a second secret
   to manage. SESSION_SECRET still overrides if one is set. */
const SESSION_SECRET = process.env.SESSION_SECRET
  || (STUDIO_PASSPHRASE
        ? crypto.createHash('sha256').update(`tca.session.${STUDIO_PASSPHRASE}`).digest('hex')
        : crypto.randomBytes(32).toString('hex'));

/* Cloud Scheduler proves itself with this rather than a session cookie. */
const PUSH_RUN_SECRET = process.env.PUSH_RUN_SECRET || '';

const store = openStore();
const doses = openDoses();
const subs = openSubs();
const feeds = openFeeds();

/* ---------- the reminder sweep ----------
   Called by Cloud Scheduler every quarter hour. For each phone, ask
   whether one of the instants it posted has just come round; if so, send
   the one notification and remember that we did.

   Nothing here reads the protocol. The card is consulted only to check it
   still exists and is still active, so a retired patient stops hearing
   from us the moment the card is retired. */
async function runReminders(now = Date.now()) {
  const all = await subs.listAll();
  const out = { phones: all.length, sent: 0, skipped: 0, dropped: 0, failed: 0 };
  const cards = new Map();

  for (const rec of all) {
    const at = dueNow(rec, now);
    if (!at) { out.skipped++; continue; }

    if (!cards.has(rec.slug)) cards.set(rec.slug, await store.get(rec.slug).catch(() => null));
    const card = cards.get(rec.slug);
    if (!card || card.status === 'retired') {
      await subs.remove(rec.id);
      out.dropped++;
      continue;
    }

    try {
      const result = await push.sendPush(rec.sub, {
        title: 'The Charleston Atelier',
        body: 'Time for your injection.',
        url: `/${rec.slug}`,
        tag: 'dose'
      });
      if (result.gone) { await subs.remove(rec.id); out.dropped++; continue; }
      // Mark sent even on a soft failure, so one unreachable phone is not
      // retried every quarter hour for the rest of the day.
      await subs.markSent(rec.id, at);
      result.ok ? out.sent++ : out.failed++;
    } catch {
      out.failed++;
    }
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.woff2': 'font/woff2',
  '.pdf':  'application/pdf',
  '.ics':  'text/calendar; charset=utf-8'
};

/* ---------- small helpers ---------- */

function send(res, status, body, headers = {}) {
  const base = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Robots-Tag': 'noindex, nofollow'
  };
  res.writeHead(status, Object.assign(base, headers));
  res.end(body);
}

function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), Object.assign(
    { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    headers));
}

async function readBody(req, limit = 64 * 1024) {
  // A calendar is posted as text, not JSON, and runs to a few hundred
  // kilobytes; everything else is a small object.
  const asText = limit === 'text';
  const cap = asText ? 400 * 1024 : limit;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) throw Object.assign(new Error('too_large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return asText ? '' : {};
  const body = Buffer.concat(chunks).toString('utf8');
  if (asText) return body;
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('bad_json'), { status: 400 }); }
}

/* ---------- dashboard session ----------
   A passphrase in the environment, exchanged for a signed cookie. Enough
   to keep the dashboard off the open web; on Cloud Run the stronger move
   is to put /studio behind IAP as well, which DEPLOY.md covers. */

function signSession(exp) {
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('hex');
  return `${exp}.${mac}`;
}

function validSession(token) {
  if (!token || !token.includes('.')) return false;
  const [exp, mac] = token.split('.');
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(exp).digest('hex');
  return mac.length === expected.length &&
         crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

function isClinician(req) {
  if (!STUDIO_PASSPHRASE) return true;   // unset locally: the dashboard is open
  const cookie = /(?:^|;\s*)ca_studio=([^;]+)/.exec(req.headers.cookie || '');
  return cookie ? validSession(decodeURIComponent(cookie[1])) : false;
}

function requireClinician(req, res) {
  if (isClinician(req)) return true;
  json(res, 401, { error: 'unauthorized' });
  return false;
}

/* ---------- static files ---------- */

function serveStatic(res, urlPath, { inject, vial } = {}) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.join(WEB_ROOT, rel);

  // Never let a crafted path climb out of the web root.
  if (!full.startsWith(WEB_ROOT)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;

  const ext = path.extname(full);
  let body = fs.readFileSync(full);

  // A card address is a path, not a fragment, so the page has to be told
  // which card it is before its scripts run.
  if ((inject || vial) && ext === '.html') {
    const pre = [];
    if (inject) pre.push(`window.__CARD_SLUG__=${JSON.stringify(inject)};`);
    // The vial label names the vial only. Which patient it is logged
    // against comes from the card already open on this phone.
    if (vial) pre.push(`window.__VIAL__=${JSON.stringify(vial)};`);
    body = Buffer.from(String(body).replace(
      '<script src="assets/protocol.js"></script>',
      `<script>${pre.join('')}</script>\n` +
      '<script src="assets/protocol.js"></script>'));
  }

  send(res, 200, body, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
  });
  return true;
}

/* ---------- routes ---------- */

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // Actually touch the store. Reporting which one is configured proves
  // nothing — a service account that cannot reach Firestore still answers
  // "firestore", and the first sign of trouble is a clinician unable to
  // save a card. Better the check fails than the dashboard does.
  if (p === '/health') {
    try {
      if (store.ping) await store.ping();
      return json(res, 200, { ok: true, store: store.kind, reachable: true });
    } catch (err) {
      return json(res, 503, {
        ok: false, store: store.kind, reachable: false,
        error: String(err && err.message || err).slice(0, 300)
      });
    }
  }

  /* --- the card a tag points at --- */
  if (p.startsWith('/api/card/')) {
    const slug = assertSlug(p.slice('/api/card/'.length));
    const rec = await store.get(slug);
    if (!rec) return json(res, 404, { error: 'not_found', slug });
    // A blank tag is not an error — it is a card waiting to be assigned.
    return json(res, 200, publicView(rec));
  }

  /* --- a tag was tapped ---
     Called by the card itself on open. It records three things and nothing
     else: that this slug was opened, when, and on which day. No address, no
     device, no fragment — the fragment carries the protocol and browsers do
     not send it, which is why legacy fragment cards are invisible here and
     will stay that way. The page pings once per browsing session, so a
     refresh does not inflate the count. */
  if (p.startsWith('/api/tap/') && req.method === 'POST') {
    const slug = assertSlug(p.slice('/api/tap/'.length));
    if (!store.touch) return json(res, 501, { error: 'not_supported' });
    const rec = await store.get(slug);
    // An unknown slug is not worth a record — it would let anyone create
    // rows by guessing.
    if (!rec) return json(res, 404, { error: 'not_found' });
    const day = new Date().toISOString().slice(0, 10);
    await store.touch(slug, day);
    res.writeHead(204); return res.end();
  }

  /* --- a vial label was tapped ---
     The tag names the vial, never the patient: one printed lot label is
     valid for whoever holds it, and a label that named someone would be
     PHI lying on a bench. Identity comes from the card already open on
     the phone, which is why the page asks her to confirm her own name
     before anything is written. */
  if (p.startsWith('/v/')) {
    const payload = decodeURIComponent(p.slice('/v/'.length));
    if (/^[A-Za-z0-9._-]{1,48}$/.test(payload)) {
      if (serveStatic(res, '/dose.html', { vial: payload })) return;
    }
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  /* --- she confirmed the injection --- */
  if (p === '/api/dose' && req.method === 'POST') {
    const body = await readBody(req);
    const dose = sanitizeDose(body);
    if (!dose || !dose.units) return json(res, 400, { error: 'bad_request' });

    // The card has to exist, or anyone could post doses against a guess.
    const rec = await store.get(assertSlug(dose.slug));
    if (!rec) return json(res, 404, { error: 'not_found' });

    const { duplicate } = await doses.put(dose);
    return json(res, 200, { ok: true, duplicate });
  }

  /* --- the calendar she can subscribe to ---
     Written by her card, because the card is what knows the schedule.
     Served to whatever her phone's calendar uses to fetch it, which is
     not her browser and carries no cookie — the address is the whole
     credential, exactly as it is for the card itself. */
  if (p.startsWith('/api/ics/') && req.method === 'POST') {
    const slug = assertSlug(p.slice('/api/ics/'.length));
    if (!await store.get(slug)) return json(res, 404, { error: 'not_found' });
    const text = sanitizeFeed(await readBody(req, 'text'));
    if (!text) return json(res, 400, { error: 'bad_request' });
    await feeds.put(slug, text);
    res.writeHead(204); return res.end();
  }

  if (p.startsWith('/ics/')) {
    const slug = assertSlug(p.slice('/ics/'.length).replace(/\.ics$/i, ''));
    const feed = await feeds.get(slug);
    if (!feed) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    // Calendar clients poll this; let them, but never let a proxy hold a
    // schedule that has since changed.
    return send(res, 200, feed.text, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="atelier-doses.ics"',
      'Cache-Control': 'no-cache, must-revalidate'
    });
  }

  /* --- her phone saying what it is showing ---
     The card does the dosing arithmetic, so the card is what knows the
     answer. It reports on each visit and the dashboard reads it back,
     which is why "showing now" is what she is actually looking at rather
     than a second copy of the maths that can drift from hers.

     Public, like the tap counter and the dose log: her card's address is
     what opens it, and everything here came off her own screen. Only the
     reported block is written — the protocol cannot be edited this way. */
  if (p.startsWith('/api/state/') && req.method === 'POST') {
    const slug = assertSlug(p.slice('/api/state/'.length));
    const rec = await store.get(slug);
    if (!rec) return json(res, 404, { error: 'not_found' });
    const state = sanitizeState(await readBody(req));
    if (!state) return json(res, 400, { error: 'bad_request' });
    if (!store.setState) return json(res, 501, { error: 'not_supported' });
    await store.setState(slug, state);
    res.writeHead(204); return res.end();
  }

  /* --- which days are green, for the patient's own calendar ---
     Her card address is what opens this, the same as the protocol behind
     it, so it carries no more than she can already see. Days and pen ids
     only: no lot, no dose, nothing that would matter if it were read
     aloud. The dashboard's /api/doses below is the full record and stays
     behind the passphrase. */
  if (p.startsWith('/api/logged/')) {
    const slug = assertSlug(p.slice('/api/logged/'.length));
    if (!await store.get(slug)) return json(res, 404, { error: 'not_found' });
    const days = {};
    for (const d of await doses.forSlug(slug, 400)) {
      const day = d.day || String(d.at || '').slice(0, 10);
      if (!day) continue;
      (days[day] = days[day] || []).push(d.template || 'pen');
    }
    return json(res, 200, { days });
  }

  /* --- what a card has logged, for the dashboard --- */
  if (p.startsWith('/api/doses/')) {
    const slug = assertSlug(p.slice('/api/doses/'.length));
    if (!requireClinician(req, res)) return;
    return json(res, 200, { doses: await doses.forSlug(slug) });
  }

  /* --- the dashboard's side --- */
  if (p === '/api/session' && req.method === 'POST') {
    const body = await readBody(req);
    if (!STUDIO_PASSPHRASE) return json(res, 200, { ok: true, open: true });
    const given = Buffer.from(String(body.passphrase || ''));
    const want = Buffer.from(STUDIO_PASSPHRASE);
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) return json(res, 401, { error: 'bad_passphrase' });
    const token = signSession(Date.now() + 12 * 3600 * 1000);
    return json(res, 200, { ok: true }, {
      'Set-Cookie': `ca_studio=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    });
  }

  if (p === '/api/session' && req.method === 'GET') {
    return json(res, 200, { signedIn: isClinician(req), required: !!STUDIO_PASSPHRASE });
  }

  if (p === '/api/cards' && req.method === 'GET') {
    if (!requireClinician(req, res)) return;
    return json(res, 200, { cards: await store.list(), store: store.kind });
  }

  if (p === '/api/cards' && req.method === 'POST') {
    if (!requireClinician(req, res)) return;
    const body = await readBody(req);

    // Three ways to mint an address: spell it out, derive it from a name,
    // or take a random one for a tag being written before it is assigned.
    let slug = body.slug
      ? normalizeSlug(body.slug)
      : (body.firstName
          ? makeSlug(body.firstName, body.lastName, { unique: body.unique !== false })
          : blankSlug());

    if (!isValidSlug(slug)) return json(res, 400, { error: 'invalid_slug', slug });
    if (await store.get(slug)) return json(res, 409, { error: 'slug_taken', slug });

    const rec = sanitize(Object.assign({}, body, { slug }));
    await store.put(rec);
    return json(res, 201, rec);
  }

  if (p.startsWith('/api/cards/')) {
    if (!requireClinician(req, res)) return;
    const slug = assertSlug(p.slice('/api/cards/'.length));
    const existing = await store.get(slug);

    if (req.method === 'GET') {
      return existing ? json(res, 200, existing) : json(res, 404, { error: 'not_found' });
    }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (!existing) return json(res, 404, { error: 'not_found' });
      const rec = sanitize(Object.assign({}, await readBody(req), { slug }), existing);
      await store.put(rec);
      return json(res, 200, rec);
    }
    if (req.method === 'DELETE') {
      await store.remove(slug);
      return json(res, 204, '');
    }
    return json(res, 405, { error: 'method_not_allowed' });
  }

  /* --- Apple Wallet ---
     The pass carries who the card belongs to and a QR of its address. It
     deliberately does not carry today's dose: a pass only refreshes when a
     push service tells it to, and a stale number on a lock screen is worse
     than no number. The QR opens the portal, which is always current. */
  if (p === '/api/wallet/status') {
    return json(res, 200, { available: wallet.configured() });
  }

  if (p.startsWith('/api/wallet/')) {
    const slug = assertSlug(p.slice('/api/wallet/'.length).replace(/\.pkpass$/, ''));
    const rec = await store.get(slug);
    if (!rec) return json(res, 404, { error: 'not_found' });
    const origin = `https://${req.headers.host}`;
    const pass = wallet.buildPass(rec, { origin });
    return send(res, 200, pass, {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${slug}.pkpass"`,
      'Cache-Control': 'no-store'
    });
  }

  /* --- reminders ---
     A patient turns these on from her own card. The device works out when
     her doses fall and posts the instants; nothing clinical is stored here
     and nothing clinical goes in a notification. See portal/lib/push.js. */

  if (p === '/api/push/key') {
    return json(res, 200, { available: push.configured(), key: push.publicKey() });
  }

  if (p === '/api/push/subscribe' && req.method === 'POST') {
    if (!push.configured()) return json(res, 503, { error: 'push_not_configured' });
    const body = await readBody(req);
    const slug = assertSlug(body.slug || '');
    const card = await store.get(slug);
    // Refuse to remind for a card that does not exist or has been retired.
    if (!card || card.status === 'retired') return json(res, 404, { error: 'not_found' });

    const rec = sanitizeSub(body, slug);
    if (!rec) return json(res, 400, { error: 'bad_subscription' });
    const saved = await subs.put(rec);
    return json(res, 201, { ok: true, id: saved.id, due: saved.due.length });
  }

  if (p === '/api/push/unsubscribe' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.endpoint) return json(res, 400, { error: 'no_endpoint' });
    await subs.remove(subIdFor(body.endpoint));
    return json(res, 200, { ok: true });
  }

  /* Cloud Scheduler knocks here. Guarded by a shared secret rather than the
     studio session — a cron job has no cookie. */
  if (p === '/api/push/run' && req.method === 'POST') {
    if (!PUSH_RUN_SECRET || req.headers['x-push-secret'] !== PUSH_RUN_SECRET) {
      return json(res, 401, { error: 'unauthorized' });
    }
    return json(res, 200, await runReminders());
  }

  /* How many phones are listening for this card — so the dashboard only
     offers a test where there is something to send to. */
  if (p.startsWith('/api/push/phones/')) {
    if (!requireClinician(req, res)) return;
    const slug = assertSlug(p.slice('/api/push/phones/'.length));
    const found = await subs.forSlug(slug);
    return json(res, 200, { phones: found.length });
  }

  /* Send one to a card's phones now, so the atelier can prove it works
     without waiting for a dose to come round. */
  if (p === '/api/push/test' && req.method === 'POST') {
    if (!requireClinician(req, res)) return;
    if (!push.configured()) return json(res, 503, { error: 'push_not_configured' });
    const body = await readBody(req);
    const slug = assertSlug(body.slug || '');
    const targets = await subs.forSlug(slug);
    let sent = 0, dropped = 0;
    for (const rec of targets) {
      const out = await push.sendPush(rec.sub, {
        title: 'The Charleston Atelier',
        body: 'Reminders are working. You will hear from us when a dose is due.',
        url: `/${slug}`,
        tag: 'test'
      }).catch(() => ({ ok: false, gone: false }));
      if (out.ok) sent++;
      if (out.gone) { await subs.remove(rec.id); dropped++; }
    }
    return json(res, 200, { phones: targets.length, sent, dropped });
  }

  /* --- batch of blank tags, for writing a tray ahead of a clinic day --- */
  if (p === '/api/blanks' && req.method === 'POST') {
    if (!requireClinician(req, res)) return;
    const body = await readBody(req);
    const count = Math.min(50, Math.max(1, Number(body.count) || 10));
    const made = [];
    for (let i = 0; i < count; i++) {
      let slug = blankSlug();
      // Collisions are vanishingly rare at 27^6, but a duplicate would
      // hand two patients the same card, so retry rather than assume.
      for (let tries = 0; tries < 5 && await store.get(slug); tries++) slug = blankSlug();
      if (await store.get(slug)) continue;
      const rec = sanitize({ slug, status: 'blank' });
      await store.put(rec);
      made.push(rec);
    }
    return json(res, 201, { cards: made });
  }

  /* --- static portal --- */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  /* --- the clinician's dashboard --- */
  if (p === '/studio' || p === '/studio/') {
    const file = path.join(__dirname, 'studio', 'index.html');
    if (fs.existsSync(file)) {
      return send(res, 200, fs.readFileSync(file), {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'
      });
    }
  }
  if (p.startsWith('/studio/')) {
    const rel = p.slice('/studio/'.length);
    const file = path.join(__dirname, 'studio', rel);
    if (file.startsWith(path.join(__dirname, 'studio')) && fs.existsSync(file) &&
        !fs.statSync(file).isDirectory()) {
      return send(res, 200, fs.readFileSync(file), {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
    }
  }

  if (p === '/' ) {
    if (serveStatic(res, '/index.html')) return;
    return send(res, 404, 'Not found');
  }
  if (serveStatic(res, p)) return;

  /* --- a card address --- */
  const candidate = normalizeSlug(p);
  if (isValidSlug(candidate)) {
    const rec = await store.get(candidate);
    if (rec) {
      if (serveStatic(res, '/index.html', { inject: candidate })) return;
    }
    // An unassigned tag still opens the portal, which offers to set it up.
    if (serveStatic(res, '/index.html', { inject: candidate })) return;
  }

  send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

/* ---------- server ---------- */

const server = http.createServer((req, res) => {
  route(req, res).catch(err => {
    const status = err.status || 500;
    if (status >= 500) console.error('unhandled', err);
    json(res, status, { error: err.message || 'server_error' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`atelier tap service on :${PORT}  store=${store.kind}  web=${WEB_ROOT}`);
    if (!STUDIO_PASSPHRASE) console.warn('STUDIO_PASSPHRASE is unset — the dashboard is open.');
  });
}

module.exports = { server, store, route };
