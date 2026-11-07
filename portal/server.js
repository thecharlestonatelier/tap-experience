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
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { openStore, sanitize, publicView, assertSlug, sanitizeState } = require('./store');
const { openDoses, sanitizeDose } = require('./store/doses');
const { openFeeds, sanitizeFeed } = require('./store/feeds');
const { supplyFor, effectiveStart } = require('./lib/supply');
const { catalogue: serviceCatalogue, servicesFor } = require('./lib/services');
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

/* A read-only overview for an assistant acting for the atelier, proved by
   a bearer token rather than the dashboard session, because a program has
   no browser and should not be handed the passphrase.

   Unset means the route does not exist. There is no default and no
   fallback: a PHI endpoint that turns itself on is not one worth having.
   Revoking is deleting the secret and redeploying. */
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';

/* Compared in constant time, and never logged or echoed. */
function isAgent(req) {
  if (!AGENT_TOKEN) return false;
  const raw = String(req.headers.authorization || '');
  const given = /^Bearer\s+(.+)$/i.exec(raw);
  if (!given) return false;
  const a = Buffer.from(given[1]), b = Buffer.from(AGENT_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const store = openStore();
const doses = openDoses();
const subs = openSubs();
const feeds = openFeeds();
const STARTED_AT = new Date().toISOString();

/* Firebase Admin, for verifying the Google ID token a card posts. Loaded
   lazily, like Firestore: a laptop without the dependency still serves,
   and the first /api/activate call is where a missing credential fails. */
let adminAuthInstance = null;
function adminAuth() {
  if (!adminAuthInstance) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        // On Cloud Run the default credential identifies the project;
        // GOOGLE_CLOUD_PROJECT is set explicitly so the Auth emulator
        // path works on a laptop too.
        projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined
      });
    }
    adminAuthInstance = admin.auth();
  }
  return adminAuthInstance;
}

/* ---------- the reminder sweep ----------
   Called by Cloud Scheduler every quarter hour. For each phone, ask
   whether one of the instants it posted has just come round; if so, send
   the one notification and remember that we did.

   Nothing here reads the protocol. The card is consulted only to check it
   still exists and is still active, so a retired patient stops hearing
   from us the moment the card is retired. */
/* Where the atelier's own subscriptions live. A '~' cannot survive
   normalizeSlug(), so no card can ever be given this address. */
const ATELIER_SLUG = '~atelier';

/* The last time the scheduler knocked, and what came of it. In memory, so
   it resets when Cloud Run replaces the instance — which is itself worth
   knowing, because "never" after a day of uptime means the job is not
   running at all. */
let LAST_RUN = null;

/* Told that something changed, never what. The body is a fixed string
   with no patient and no drug in it — a notification renders on a locked
   screen, and the push services are outside the BAA. Tapping it opens
   Card Studio, which is behind the passphrase and has the detail. */
async function notifyAtelier(body, tag) {
  if (!push.configured()) return { sent: 0 };
  let sent = 0;
  for (const rec of await subs.forSlug(ATELIER_SLUG)) {
    const out = await push.sendPush(rec.sub, {
      title: 'The Charleston Atelier', body, url: '/studio/', tag
    }).catch(() => ({ ok: false, gone: false }));
    if (out.gone) { await subs.remove(rec.id); continue; }
    if (out.ok) sent++;
  }
  return { sent };
}

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
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) { tooLarge = true; continue; }  // drain the rest
    chunks.push(chunk);
  }
  // Refusing mid-stream poisons the keep-alive connection: answering 413
  // while the client is still uploading resets its next request. Draining
  // to the end first lets the socket be reused.
  if (tooLarge) throw Object.assign(new Error('too_large'), { status: 413 });
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

/* decodeURIComponent on attacker-controlled input throws URIError on a
   malformed escape, and a thrown decode once surfaced as a 500 with a
   stack trace on every dashboard and static route. Decode defensively: a
   value that cannot be decoded is not the value we are looking for. */
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

function isClinician(req) {
  if (!STUDIO_PASSPHRASE) return true;   // unset locally: the dashboard is open
  const cookie = /(?:^|;\s*)ca_studio=([^;]+)/.exec(req.headers.cookie || '');
  if (!cookie) return false;
  const value = safeDecode(cookie[1]);
  return value === null ? false : validSession(value);
}

function requireClinician(req, res) {
  if (isClinician(req)) return true;
  json(res, 401, { error: 'unauthorized' });
  return false;
}

/* ---------- static files ---------- */

/* ---------- which card this browser belongs to ----------
   The phone remembering its own card in localStorage is not durable
   enough to hang a dose log on. Safari clears storage for a site not
   visited in seven days, private browsing gives a tab its own that dies
   with it, and the privacy settings a patient may have on can empty it
   at any time — and the first thing she sees when a vial tag opens a
   browser that has forgotten is "Open your card first", with no way to
   know why.

   So the card also sets a cookie when it is opened, server-side, which
   survives all three. It carries the slug and nothing else — the same
   value that is already in the address bar.

   It does NOT cross from Safari to a card added to the home screen:
   those are separate browsers with separate everything, and no cookie
   can bridge them. A patient who lives in the installed app has to open
   her card in Safari once. */
const CARD_COOKIE = 'ca_card';

function cardCookie(slug) {
  return `${CARD_COOKIE}=${encodeURIComponent(slug)}; Path=/; Max-Age=${180 * 86400}` +
         `; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function readCardCookie(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map(c => c.trim())
    .find(c => c.startsWith(CARD_COOKIE + '='));
  if (!hit) return null;
  const dec = safeDecode(hit.slice(CARD_COOKIE.length + 1));
  if (dec === null) return null;
  const slug = normalizeSlug(dec);
  return isValidSlug(slug) ? slug : null;
}

/* The cookie was only being set by the card's own address, `/<slug>`. But
   almost nothing a patient actually opens is that address: a home-screen
   shortcut, a reminder, a link inside a calendar event and every link
   between pages all carry the card as `?c=<slug>` on a page. So a patient
   could use her card every day for a month and still leave the vial tag
   nothing to find.

   Any page served with a card in the address renews the cookie. Pages
   only — a stylesheet does not need to re-sign the browser each time. */
async function queryCard(url, pathname) {
  if (pathname !== '/' && !/\.html$/.test(pathname)) return undefined;
  const c = url.searchParams.get('c');
  if (!c) return undefined;
  const slug = normalizeSlug(c);
  if (!isValidSlug(slug)) return undefined;
  return (await store.get(slug)) ? slug : undefined;
}

function serveStatic(res, urlPath, { inject, vial, remember, setCard } = {}) {
  const decoded = safeDecode(urlPath);
  if (decoded === null) {
    send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
    return true;
  }
  const rel = decoded.replace(/^\/+/, '');
  const full = path.join(WEB_ROOT, rel);

  // Never let a crafted path climb out of the web root. Sending the 403
  // and returning true makes the router stop here — returning send()'s
  // falsy result once let the router fall through to a second writeHead
  // on an already-ended response, and the unhandled throw killed the
  // whole service. One GET could take the site down.
  if (full !== WEB_ROOT && !full.startsWith(WEB_ROOT + path.sep)) {
    send(res, 403, 'Forbidden');
    return true;
  }
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;

  const ext = path.extname(full);
  let body = fs.readFileSync(full);

  // A card address is a path, not a fragment, so the page has to be told
  // which card it is before its scripts run.
  if ((inject || vial || remember) && ext === '.html') {
    const pre = [];
    if (inject) pre.push(`window.__CARD_SLUG__=${JSON.stringify(inject)};`);
    // The vial label names the vial only. Which patient it is logged
    // against comes from the card already open on this phone.
    if (vial) pre.push(`window.__VIAL__=${JSON.stringify(vial)};`);
    // Who this browser last opened a card as, when the page itself has
    // been forgotten.
    if (remember) pre.push(`window.__CARD_MEMORY__=${JSON.stringify(remember)};`);
    body = Buffer.from(String(body).replace(
      '<script src="assets/protocol.js"></script>',
      `<script>${pre.join('')}</script>\n` +
      '<script src="assets/protocol.js"></script>'));
  }

  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
  };
  if (setCard) headers['Set-Cookie'] = cardCookie(setCard);
  send(res, 200, body, headers);
  return true;
}

/* ---------- sign-in helper proxy ----------

   Firebase's redirect sign-in runs its helper code (handler + iframe) on
   the auth domain, and the browser hands the credential back through that
   domain's storage. Browsers that block third-party storage refuse that
   handoff unless the helper is first-party — the official fix is to serve
   /__/auth/* from the app's own origin, transparently, with no 302
   (Auth web guide: "Best practices for signInWithRedirect flows").

   Cloud Run is the app origin, so this service proxies the helper paths
   to the Firebase auth domain. The SDK is pointed at the app origin as
   its authDomain (patients/jessica/assets/firebase.js), which makes the
   whole round trip same-origin and immune to third-party storage rules. */

const AUTH_HELPER_HOST = 'atelier-tap.firebaseapp.com';
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'te', 'trailer', 'proxy-authenticate', 'proxy-authorization',
  'content-length'
]);

function proxyAuthHelper(req, res, url) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(String(k).toLowerCase()) && k !== 'host') headers[k] = v;
  }

  const upstream = https.request({
    hostname: AUTH_HELPER_HOST,
    port: 443,
    method: req.method,
    path: url.pathname + url.search,
    headers: Object.assign(headers, { host: AUTH_HELPER_HOST })
  }, upstreamRes => {
    const out = {};
    for (const [k, v] of Object.entries(upstreamRes.headers)) {
      if (!HOP_BY_HOP.has(String(k).toLowerCase())) out[k] = v;
    }
    res.writeHead(upstreamRes.statusCode || 502, out);
    upstreamRes.pipe(res);
  });

  upstream.on('error', err => {
    console.error('auth helper proxy failed', err && err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('sign-in helper unavailable');
  });

  req.pipe(upstream);
}

/* ---------- routes: one handler per route ---------- */

async function handleHealth(req, res) {
  // Which build is answering, so a deploy can be told from a browser cache.
  // Cloud Run names every revision; a laptop has none.
  const build = {
    revision: process.env.K_REVISION || 'local',
    service: process.env.K_SERVICE || 'local',
    // A fresh Cloud Shell has no project set and the deploy stops to ask.
    // The running container knows the answer, so it can be written into
    // the command rather than looked up.
    project: process.env.GOOGLE_CLOUD_PROJECT || '',
    startedAt: STARTED_AT
  };
  try {
    if (store.ping) await store.ping();
    return json(res, 200, Object.assign({ ok: true, store: store.kind, reachable: true }, build));
  } catch (err) {
    return json(res, 503, Object.assign({
      ok: false, store: store.kind, reachable: false,
      error: String(err && err.message || err).slice(0, 300)
    }, build));
  }
}

function handleAuthHelper(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'method_not_allowed' });
  }
  return proxyAuthHelper(req, res, url);
}

/* --- the card a tag points at --- */
async function handleCardView(req, res, url, p) {
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
async function handleTap(req, res, url, p) {
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
   valid for whoever holds it, and a label that named someone would be PHI
   lying on a bench. Identity comes from the card already open on the
   phone, which is why the page asks her to confirm her own name before
   anything is written. */
function handleVial(req, res, url, p) {
  const payload = safeDecode(p.slice('/v/'.length));
  if (payload && /^[A-Za-z0-9._-]{1,48}$/.test(payload)) {
    // A sticker written for one patient carries ?c=<slug>. The page reads
    // it from the address; the cookie stays as the fallback for a generic
    // sticker, and the page prefers whichever of the two is present.
    if (serveStatic(res, '/dose.html', { vial: payload, remember: readCardCookie(req) })) return;
  }
  return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

/* --- she confirmed the injection --- */
async function handleDose(req, res) {
  const body = await readBody(req);
  const dose = sanitizeDose(body);
  if (!dose || !dose.units) return json(res, 400, { error: 'bad_request' });

  // The card has to exist, or anyone could post doses against a guess.
  const rec = await store.get(assertSlug(dose.slug));
  if (!rec) return json(res, 404, { error: 'not_found' });

  const { duplicate } = await doses.put(dose);
  return json(res, 200, { ok: true, duplicate });
}

/* --- what the patient put on her own card ---
   The `+` on Today's Ritual used to write to localStorage and stop there:
   the atelier never saw a peptide a patient added, and a phone whose
   storage was cleared lost it. Now it lands on the record, in its own
   list, so the dashboard shows it and another phone finds it. */
async function handleAdded(req, res, url, p) {
  const slug = assertSlug(p.slice('/api/added/'.length));
  const rec = await store.get(slug);
  if (!rec) return json(res, 404, { error: 'not_found' });
  const body = await readBody(req) || {};
  const patch = {};
  if (Array.isArray(body.added)) patch.added = body.added;
  if (Array.isArray(body.dropped)) patch.dropped = body.dropped;
  if (!Object.keys(patch).length) return json(res, 400, { error: 'bad_request' });
  const before = (rec.dropped || []).slice();
  const saved = await store.put(sanitize(patch, rec));

  /* Stopping a prescription is the one thing a patient can do here that
     the atelier would want to hear about rather than find later. Only a
     pen that was not already off counts — her phone re-posts the whole
     list, so without this every save would ring. */
  const fresh = (saved.dropped || []).filter(id => !before.includes(id));
  if (fresh.length) {
    notifyAtelier(
      'A patient has taken a prescribed pen off her schedule. Open Card Studio.',
      'stopped'
    ).catch(() => {});
  }
  return json(res, 200, { ok: true, added: saved.added || [], dropped: saved.dropped || [] });
}

/* --- the calendar she can subscribe to --- */
async function handleIcsWrite(req, res, url, p) {
  const slug = assertSlug(p.slice('/api/ics/'.length));
  if (!await store.get(slug)) return json(res, 404, { error: 'not_found' });
  const text = sanitizeFeed(await readBody(req, 'text'));
  if (!text) return json(res, 400, { error: 'bad_request' });
  await feeds.put(slug, text);
  res.writeHead(204); return res.end();
}

async function handleIcsRead(req, res, url, p) {
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

/* --- her phone saying what it is showing --- */
async function handleState(req, res, url, p) {
  const slug = assertSlug(p.slice('/api/state/'.length));
  const rec = await store.get(slug);
  if (!rec) return json(res, 404, { error: 'not_found' });
  const state = sanitizeState(await readBody(req));
  if (!state) return json(res, 400, { error: 'bad_request' });
  if (!store.setState) return json(res, 501, { error: 'not_supported' });
  await store.setState(slug, state);
  res.writeHead(204); return res.end();
}

/* --- who this card belongs to ---
   The first tap of a newly assigned card asks for a Google sign-in and
   posts the ID token here. The token is verified with the Admin SDK. */
async function handleActivate(req, res, url, p) {
  const slug = assertSlug(p.slice('/api/activate/'.length));
  const rec = await store.get(slug);
  if (!rec) return json(res, 404, { error: 'not_found' });
  if (!store.activate) return json(res, 501, { error: 'not_supported' });
  const body = await readBody(req);
  if (typeof body.idToken !== 'string' || !body.idToken) {
    return json(res, 400, { error: 'bad_request' });
  }
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(body.idToken);
  } catch (err) {
    // Codes the card itself could produce: a malformed, expired, revoked
    // or disabled-account token. Anything else — missing credential,
    // unreachable Auth — is ours and must not look like hers, or a broken
    // deploy reads as "every card is wrong".
    const clientSide = new Set([
      'auth/argument-error', 'auth/id-token-expired',
      'auth/id-token-revoked', 'auth/user-disabled'
    ]);
    if (err && clientSide.has(err.code)) {
      return json(res, 400, { error: 'bad_request' });
    }
    console.error('activate: token verification failed', err && err.message);
    return json(res, 503, { error: 'auth_unavailable' });
  }
  const activatedBy = {
    uid: String(decoded.uid || '').slice(0, 64),
    provider: String((decoded.firebase && decoded.firebase.sign_in_provider) || 'unknown').slice(0, 24),
    name: String(decoded.name || '').trim().slice(0, 60),
    at: new Date().toISOString()
  };
  const outcome = await store.activate(slug, activatedBy);
  if (outcome.result === 'missing') return json(res, 404, { error: 'not_found' });
  if (outcome.result === 'blocked') return json(res, 409, { error: 'uid_mismatch' });
  return json(res, 200, { ok: true, result: outcome.result });
}

/* --- which days are green, for the patient's own calendar --- */
async function handleLogged(req, res, url, p) {
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
async function handleDoses(req, res, url, p) {
  const slug = assertSlug(p.slice('/api/doses/'.length));
  if (!requireClinician(req, res)) return;
  return json(res, 200, { doses: await doses.forSlug(slug) });
}

/* --- the dashboard's side --- */
async function handleSessionPost(req, res) {
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

function handleSessionGet(req, res) {
  return json(res, 200, { signedIn: isClinician(req), required: !!STUDIO_PASSPHRASE });
}

/* --- the read-only overview --- */
async function handleOverview(req, res) {
  if (!AGENT_TOKEN) return json(res, 404, { error: 'not_found' });
  if (!isAgent(req)) return json(res, 401, { error: 'unauthorized' });

  const cards = (await store.list()).filter(c => c.status !== 'blank');
  return json(res, 200, {
    asOf: new Date().toISOString(),
    patients: cards.map(c => {
      const s = supplyFor(c, WEB_ROOT);
      return {
        slug: c.slug,
        name: c.name || '',
        status: c.status,
        lastSeen: c.lastSeen || null,
        startDate: effectiveStart(c),
        pens: (c.pens || []).map(x => x.template),
        outOf: s.out,
        runningLow: s.low,
        supplyUnknown: s.unknown,
        stopped: c.dropped || [],
        addedHerself: (c.added || []).map(a => a.template)
      };
    })
  });
}

/* The treatments the atelier gives in the room, and their cadences.
   Public: it is the menu, not anybody's record. */
function handleServices(req, res) {
  return json(res, 200, { services: serviceCatalogue() });
}

async function handleCardsGet(req, res) {
  if (!requireClinician(req, res)) return;
  // The dashboard reads supply and service cadences from here rather than
  // working them out in the page, so the list, the editor and the overview
  // can never disagree.
  const cards = (await store.list()).map(c => Object.assign({}, c, {
    supply: supplyFor(c, WEB_ROOT),
    services: servicesFor(c)
  }));
  return json(res, 200, { cards, store: store.kind });
}

async function handleCardsPost(req, res) {
  if (!requireClinician(req, res)) return;
  const body = await readBody(req);

  // Three ways to mint an address: spell it out, derive it from a name, or
  // take a random one for a tag being written before it is assigned.
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

async function handleCardItem(req, res, url, p) {
  if (!requireClinician(req, res)) return;
  const rest = p.slice('/api/cards/'.length);

  /* --- clear a wrong first link ---
     The remedy behind the patient's "message the atelier": the link comes
     off the card and nothing else, so whoever signs in next becomes its
     owner. Passphrase-protected like every dashboard write. Checked before
     assertSlug — the suffix is not part of a valid slug. */
  if (req.method === 'POST' && rest.endsWith('/unlink')) {
    const slug = assertSlug(rest.slice(0, -'/unlink'.length));
    if (!(await store.get(slug))) return json(res, 404, { error: 'not_found' });
    if (!store.unlink) return json(res, 501, { error: 'not_supported' });
    await store.unlink(slug);
    return json(res, 200, await store.get(slug));
  }

  const slug = assertSlug(rest);
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

/* --- Apple Wallet --- */
function handleWalletStatus(req, res) {
  return json(res, 200, { available: wallet.configured() });
}

async function handleWallet(req, res, url, p) {
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

/* --- reminders --- */
function handlePushKey(req, res) {
  return json(res, 200, { available: push.configured(), key: push.publicKey() });
}

async function handlePushSubscribe(req, res) {
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

/* --- the atelier's own phone ---
   Not a card, so it cannot hang off a slug. The sentinel below is not a
   valid slug — normalizeSlug() can never produce a leading '~' — so it can
   never collide with a patient, and runReminders() leaves it alone because
   it carries no due times. */
async function handlePushAtelier(req, res) {
  if (!requireClinician(req, res)) return;

  if (req.method === 'GET') {
    const found = await subs.forSlug(ATELIER_SLUG);
    return json(res, 200, { on: found.length, available: push.configured() });
  }

  if (req.method === 'POST') {
    if (!push.configured()) return json(res, 503, { error: 'push_not_configured' });
    const body = await readBody(req);
    if (body && body.off && body.endpoint) {
      await subs.remove(subIdFor(body.endpoint));
      return json(res, 200, { ok: true, on: false });
    }
    const rec = sanitizeSub(body, ATELIER_SLUG);
    if (!rec) return json(res, 400, { error: 'bad_subscription' });
    await subs.put(rec);
    return json(res, 201, { ok: true, on: true });
  }
}

async function handlePushUnsubscribe(req, res) {
  const body = await readBody(req);
  if (!body.endpoint) return json(res, 400, { error: 'no_endpoint' });
  await subs.remove(subIdFor(body.endpoint));
  return json(res, 200, { ok: true });
}

/* Cloud Scheduler knocks here. Guarded by a shared secret rather than the
   studio session — a cron job has no cookie. */
async function handlePushRun(req, res) {
  if (!PUSH_RUN_SECRET || req.headers['x-push-secret'] !== PUSH_RUN_SECRET) {
    // Recorded, because this is the failure that looks like nothing at all:
    // the scheduler knocks every quarter hour, is turned away, and no
    // patient is ever nudged.
    LAST_RUN = { at: new Date().toISOString(), ok: false,
                 why: PUSH_RUN_SECRET ? 'wrong secret' : 'no PUSH_RUN_SECRET set' };
    return json(res, 401, { error: 'unauthorized' });
  }
  const out = await runReminders();
  LAST_RUN = Object.assign({ at: new Date().toISOString(), ok: true }, out);
  return json(res, 200, out);
}

/* --- are reminders actually working? --- */
async function handlePushHealth(req, res) {
  if (!requireClinician(req, res)) return;
  const all = await subs.listAll();
  const patients = all.filter(s => s.slug !== ATELIER_SLUG);
  return json(res, 200, {
    configured: push.configured(),
    schedulerSecretSet: !!PUSH_RUN_SECRET,
    phones: patients.length,
    cards: new Set(patients.map(s => s.slug)).size,
    // How many have a dose still to come — a phone whose schedule ran out
    // months ago is subscribed and will never be nudged again.
    withUpcoming: patients.filter(s =>
      (s.due || []).some(t => Date.parse(t) > Date.now())).length,
    atelierDevices: all.length - patients.length,
    lastRun: LAST_RUN
  });
}

/* How many phones are listening for this card — so the dashboard only
   offers a test where there is something to send to. */
async function handlePushPhones(req, res, url, p) {
  if (!requireClinician(req, res)) return;
  const slug = assertSlug(p.slice('/api/push/phones/'.length));
  const found = await subs.forSlug(slug);
  return json(res, 200, { phones: found.length });
}

/* Send one to a card's phones now, so the atelier can prove it works
   without waiting for a dose to come round. */
async function handlePushTest(req, res) {
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
async function handleBlanks(req, res) {
  if (!requireClinician(req, res)) return;
  const body = await readBody(req);
  const count = Math.min(50, Math.max(1, Number(body.count) || 10));
  const made = [];
  for (let i = 0; i < count; i++) {
    let slug = blankSlug();
    // Collisions are vanishingly rare at 27^6, but a duplicate would hand
    // two patients the same card, so retry rather than assume.
    for (let tries = 0; tries < 5 && await store.get(slug); tries++) slug = blankSlug();
    if (await store.get(slug)) continue;
    const rec = sanitize({ slug, status: 'blank' });
    await store.put(rec);
    made.push(rec);
  }
  return json(res, 201, { cards: made });
}

/* --- static portal and card addresses --- */
/* A file inside portal/studio, or null when the path escapes it or is not a
   file. */
function studioFile(rel) {
  const studioRoot = path.join(__dirname, 'studio');
  const file = path.join(studioRoot, rel);
  if (file !== studioRoot && !file.startsWith(studioRoot + path.sep)) return null;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return file;
}

/* The clinician's dashboard, served from portal/studio. Returns true when it
   answered. */
function serveStudio(res, p) {
  const rel = (p === '/studio' || p === '/studio/') ? 'index.html'
            : p.startsWith('/studio/') ? p.slice('/studio/'.length)
            : null;
  if (rel === null) return false;
  const file = studioFile(rel);
  if (!file) return false;
  send(res, 200, fs.readFileSync(file), {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  return true;
}

/* A card's own address, `/phil.h`, opens the portal with the card injected.
   An unassigned tag still opens it, which is how a blank card is set up.
   Returns true when it answered. */
async function serveCardAddress(res, p) {
  const candidate = normalizeSlug(p);
  if (!isValidSlug(candidate)) return false;
  const rec = await store.get(candidate);
  if (rec && serveStatic(res, '/index.html', { inject: candidate, setCard: candidate })) return true;
  return !!serveStatic(res, '/index.html', { inject: candidate });
}

async function servePortal(req, res, url, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'method_not_allowed' });
  }
  if (serveStudio(res, p)) return;

  if (p === '/') {
    if (serveStatic(res, '/index.html', { setCard: await queryCard(url, p) })) return;
    return send(res, 404, 'Not found');
  }
  if (serveStatic(res, p, { setCard: await queryCard(url, p) })) return;
  if (await serveCardAddress(res, p)) return;

  send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

/* ---------- the router ----------
   One handler per route, matched in order. The order is the contract: a
   request falls through the table the same way it fell through the old
   if-chain, so a route that matches an earlier entry always wins. */
const ROUTES = [
  { match: p => p === '/health', handler: handleHealth },
  { match: p => p.startsWith('/__/auth/') || p.startsWith('/__/firebase/'), handler: handleAuthHelper },
  { match: p => p.startsWith('/api/card/'), handler: handleCardView },
  { match: p => p.startsWith('/api/tap/'), method: 'POST', handler: handleTap },
  { match: p => p.startsWith('/v/'), handler: handleVial },
  { match: p => p === '/api/dose', method: 'POST', handler: handleDose },
  { match: p => p.startsWith('/api/added/'), method: 'POST', handler: handleAdded },
  { match: p => p.startsWith('/api/ics/'), method: 'POST', handler: handleIcsWrite },
  { match: p => p.startsWith('/ics/'), handler: handleIcsRead },
  { match: p => p.startsWith('/api/state/'), method: 'POST', handler: handleState },
  { match: p => p.startsWith('/api/activate/'), method: 'POST', handler: handleActivate },
  { match: p => p.startsWith('/api/logged/'), handler: handleLogged },
  { match: p => p.startsWith('/api/doses/'), handler: handleDoses },
  { match: p => p === '/api/session', method: 'POST', handler: handleSessionPost },
  { match: p => p === '/api/session', method: 'GET', handler: handleSessionGet },
  { match: p => p === '/api/overview', method: 'GET', handler: handleOverview },
  { match: p => p === '/api/services', handler: handleServices },
  { match: p => p === '/api/cards', method: 'GET', handler: handleCardsGet },
  { match: p => p === '/api/cards', method: 'POST', handler: handleCardsPost },
  { match: p => p.startsWith('/api/cards/'), handler: handleCardItem },
  { match: p => p === '/api/wallet/status', handler: handleWalletStatus },
  { match: p => p.startsWith('/api/wallet/'), handler: handleWallet },
  { match: p => p === '/api/push/key', handler: handlePushKey },
  { match: p => p === '/api/push/subscribe', method: 'POST', handler: handlePushSubscribe },
  { match: p => p === '/api/push/atelier', handler: handlePushAtelier },
  { match: p => p === '/api/push/unsubscribe', method: 'POST', handler: handlePushUnsubscribe },
  { match: p => p === '/api/push/run', method: 'POST', handler: handlePushRun },
  { match: p => p === '/api/push/health', handler: handlePushHealth },
  { match: p => p.startsWith('/api/push/phones/'), handler: handlePushPhones },
  { match: p => p === '/api/push/test', method: 'POST', handler: handlePushTest },
  { match: p => p === '/api/blanks', method: 'POST', handler: handleBlanks },
];

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  for (const entry of ROUTES) {
    if (entry.method && req.method !== entry.method) continue;
    if (entry.match(p)) return entry.handler(req, res, url, p);
  }

  return servePortal(req, res, url, p);
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
