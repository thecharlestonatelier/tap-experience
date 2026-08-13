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

const { openStore, sanitize, publicView, assertSlug } = require('./store');
const { makeSlug, blankSlug, isValidSlug, normalizeSlug } = require('./lib/slug');
const wallet = require('./lib/wallet');

const PORT = Number(process.env.PORT) || 8080;

/* In the container the portal is copied to ./public. On a laptop it is
   read straight out of the repo, so the service and the static site are
   always running the same pages. */
const WEB_ROOT = process.env.WEB_ROOT
  || (fs.existsSync(path.join(__dirname, 'public'))
        ? path.join(__dirname, 'public')
        : path.join(__dirname, '..', 'patients', 'jessica'));
const STUDIO_PASSPHRASE = process.env.STUDIO_PASSPHRASE || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const store = openStore();

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
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too_large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
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

function serveStatic(res, urlPath, { inject } = {}) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.join(WEB_ROOT, rel);

  // Never let a crafted path climb out of the web root.
  if (!full.startsWith(WEB_ROOT)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;

  const ext = path.extname(full);
  let body = fs.readFileSync(full);

  // A card address is a path, not a fragment, so the page has to be told
  // which card it is before its scripts run.
  if (inject && ext === '.html') {
    body = Buffer.from(String(body).replace(
      '<script src="assets/protocol.js"></script>',
      `<script>window.__CARD_SLUG__=${JSON.stringify(inject)};</script>\n` +
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

  if (p === '/health') return json(res, 200, { ok: true, store: store.kind });

  /* --- the card a tag points at --- */
  if (p.startsWith('/api/card/')) {
    const slug = assertSlug(p.slice('/api/card/'.length));
    const rec = await store.get(slug);
    if (!rec) return json(res, 404, { error: 'not_found', slug });
    // A blank tag is not an error — it is a card waiting to be assigned.
    return json(res, 200, publicView(rec));
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
