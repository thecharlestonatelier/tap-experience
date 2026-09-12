/* ==================================================================
   PRACTICE BETTER — what the patient is on
   ------------------------------------------------------------------
   WHAT THIS CAN AND CANNOT DO

   The intent was to write each tapped vial into the patient's chart as
   a note. Their OpenAPI spec (v1, 69 paths) says that is not possible:

     /consultant/sessionnotes        GET only — notes cannot be created
     journal entries                 GET only
     nothing anywhere                accepts an administration

   The only endpoint that will take a medication on a client record is

     POST/PUT /consultant/medicalhistory/{recordId}/healthproducts
       required: productName, frequency, startDate
       optional: endDate, notes, id

   which is a medication list, not a dose log. So the split is:

     Practice Better   what she is currently on — one health product per
                       pen, with the dates it runs between, and a notes
                       line saying how many doses have been logged and
                       when the last one was.

     Firestore         the dose-by-dose record, under the Google Cloud
                       BAA. It has to live here because their API has
                       nowhere to put it.

   Posting one health product per injection was the alternative and it
   is wrong: it would bury her medical history under hundreds of
   entries, none of which is a medication she is taking.

   AUTH — OAuth2 client credentials, confirmed in the spec
     tokenUrl  https://api.practicebetter.io/oauth2/token
     scopes    read write
     base      https://api.practicebetter.io

   CREDENTIALS — never in this repository
     gcloud secrets create pb-client-secret --data-file=-
     gcloud run services update atelier-tap --region us-east1 \
       --set-secrets=PRACTICE_BETTER_CLIENT_SECRET=pb-client-secret:latest \
       --set-env-vars=PRACTICE_BETTER_CLIENT_ID=...
   ================================================================== */

const API_BASE  = process.env.PRACTICE_BETTER_API_BASE || 'https://api.practicebetter.io';
const TOKEN_URL = process.env.PRACTICE_BETTER_TOKEN_URL || `${API_BASE}/oauth2/token`;
const CLIENT_ID = process.env.PRACTICE_BETTER_CLIENT_ID || '';
const SECRET    = process.env.PRACTICE_BETTER_CLIENT_SECRET || '';
const SCOPE     = process.env.PRACTICE_BETTER_SCOPE || 'read write';
const STYLE     = process.env.PRACTICE_BETTER_AUTH_STYLE || 'body';   // or 'basic'

function configured() { return !!(CLIENT_ID && SECRET); }

/* ---------- token ----------
   Held in memory, refreshed a minute early. `inFlight` means a burst of
   doses triggers one exchange rather than one each. */
let token = null, inFlight = null;

async function fetchToken() {
  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  if (SCOPE) form.set('scope', SCOPE);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (STYLE === 'basic') {
    headers.Authorization = 'Basic ' + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64');
  } else {
    form.set('client_id', CLIENT_ID);
    form.set('client_secret', SECRET);
  }

  const res = await fetch(TOKEN_URL, { method: 'POST', headers, body: form.toString() });
  // The status matters; the body does not — a failed token response can
  // echo the credential straight back into a log.
  if (!res.ok) throw new Error(`token_http_${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('token_missing');
  const ttl = Number(data.expires_in) || 3600;
  return { value: data.access_token, expires: Date.now() + (ttl - 60) * 1000 };
}

async function accessToken(force) {
  if (!force && token && token.expires > Date.now()) return token.value;
  if (!inFlight) {
    inFlight = fetchToken()
      .then(t => { token = t; return t.value; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/* One call, with a lapsed token retried once rather than costing a dose. */
async function call(method, path, body) {
  const send = async bearer => fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let res = await send(await accessToken(false));
  if (res.status === 401) res = await send(await accessToken(true));
  return res;
}

/* The medication line as it should read in her history. */
function healthProduct(pen, summary, existingId) {
  const p = {
    productName: pen.productName,
    frequency: pen.frequency,
    startDate: pen.startDate,
    notes: summary
  };
  if (pen.endDate) p.endDate = pen.endDate;
  if (existingId) p.id = existingId;
  return p;
}

/* Put the pen on the client's medication list, or bring the existing
   entry up to date. `productId` is what we were given last time; the
   caller stores whatever comes back so the next call updates rather
   than duplicating.

   Returns { ok } or { ok: false, reason, retryable } — never throws. */
async function syncPen({ clientId, pen, summary, productId }) {
  if (!configured()) return { ok: false, reason: 'not_configured' };
  if (!clientId) return { ok: false, reason: 'no_client_id' };

  const path = `/consultant/medicalhistory/${encodeURIComponent(clientId)}/healthproducts`;
  try {
    const res = await call(productId ? 'PUT' : 'POST', path,
                           healthProduct(pen, summary, productId));
    if (!res.ok) {
      return {
        ok: false,
        reason: `http_${res.status}`,
        retryable: res.status >= 500 || res.status === 429
      };
    }
    // The spec documents no response body, so keep the id we already had.
    let id = productId || null;
    try {
      const data = await res.json();
      id = (data && (data.id || data._id)) || id;
    } catch { /* empty body is expected */ }
    return { ok: true, productId: id };
  } catch (err) {
    return { ok: false, reason: err.message || 'unreachable', retryable: true };
  }
}

/* Find a client record by name, so a card can be matched to a chart
   without anyone copying an id by hand. Read scope only. */
async function findRecord(name) {
  if (!configured()) return { ok: false, reason: 'not_configured' };
  try {
    const res = await call('GET', `/consultant/records?client=${encodeURIComponent(name)}&limit=20`);
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.data || data.records || []);
    return { ok: true, records: rows.map(r => ({ id: r.id || r._id, name: r.fullName || r.name || '' })) };
  } catch (err) {
    return { ok: false, reason: err.message || 'unreachable' };
  }
}

function _resetToken() { token = null; inFlight = null; }

module.exports = { syncPen, findRecord, configured, _resetToken };
