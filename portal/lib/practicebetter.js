/* ==================================================================
   PRACTICE BETTER — the clinical record
   ------------------------------------------------------------------
   A vial tap is an administration: this patient, this vial, this
   moment. Practice Better is where that belongs, so this is the one
   place that talks to it.

   WHY THIS LIVES HERE AND NOT IN A NETLIFY FUNCTION

   There was a Practice Better stub in patients/jessica/netlify/, and it
   could not be used for this. Netlify has signed no BAA. An
   administration record names a patient and a drug, which is PHI, and
   it must not pass through a processor that has not signed. Cloud Run
   sits under the Google Cloud BAA, so the call is made from here and
   the browser never sees the key or the endpoint.

   THE KEY

   Read from the environment at call time and never logged, never
   returned to the browser, never written to the repository. On Cloud
   Run it comes from Secret Manager:

     gcloud secrets create practice-better-key --data-file=-
     gcloud run services update atelier-tap --region us-east1 \
       --set-secrets=PRACTICE_BETTER_API_KEY=practice-better-key:latest

   ------------------------------------------------------------------
   STATUS — three facts are still needed

   Practice Better's developer documentation is not reachable from the
   build environment, so the request below is shaped but not confirmed.
   Everything else in the chain — the tag, the confirmation the patient
   sees, the queue, the retry — is finished and tested. Filling these
   three in is a change to this file alone:

     1. PB_BASE        the API base URL
     2. AUTH_HEADER    the header name and value shape below
     3. NOTE_PATH      the route that writes a note to a client record

   Until they are set, postAdministration() reports 'not_configured'
   and the dose is still recorded and still queued, so nothing is lost
   in the meantime.
   ================================================================== */

const PB_BASE = process.env.PRACTICE_BETTER_API_BASE || '';
const PB_KEY  = process.env.PRACTICE_BETTER_API_KEY  || '';

/* ── 2. confirm against their documentation ── */
function authHeader(key) {
  return { Authorization: `Bearer ${key}` };
}

/* ── 3. confirm against their documentation ── */
function notePath(clientId) {
  return `/clients/${encodeURIComponent(clientId)}/notes`;
}

function configured() {
  return !!(PB_BASE && PB_KEY);
}

/* What the chart should say. Written here rather than at the call site
   so every administration reads the same way in the record. */
function noteBody(dose) {
  const when = new Date(dose.at).toISOString();
  const lot = dose.lot ? ` · lot ${dose.lot}` : '';
  return [
    `${dose.pen}${lot}`,
    `${dose.units} units${dose.mg ? ` (${dose.mg} mg)` : ''}`,
    `Self-administered, confirmed by the patient at ${when}.`,
    'Recorded by tapping the vial label with The Charleston Atelier card.'
  ].join('\n');
}

/* Send one administration to the chart.

   Returns { ok } on success, or { ok: false, reason } — never throws.
   A failed write must not cost the patient her dose record, so the
   caller keeps the queued copy and retries; this only reports. */
async function postAdministration(dose) {
  if (!configured()) return { ok: false, reason: 'not_configured' };
  if (!dose.clientId) return { ok: false, reason: 'no_client_id' };

  try {
    const res = await fetch(`${PB_BASE}${notePath(dose.clientId)}`, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json', Accept: 'application/json' },
        authHeader(PB_KEY)
      ),
      body: JSON.stringify({
        title: `Peptide administration — ${dose.pen}`,
        body: noteBody(dose),
        date: dose.at
      })
    });

    if (!res.ok) {
      // The status is worth keeping; the response body is not, because it
      // may echo patient data into the logs.
      return { ok: false, reason: `http_${res.status}`, retryable: res.status >= 500 || res.status === 429 };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'unreachable', retryable: true };
  }
}

module.exports = { postAdministration, configured };
