/* ==================================================================
   Practice Better → patient list for Card Studio
   ------------------------------------------------------------------
   THE API KEY LIVES HERE AND ONLY HERE.

   Set it in Netlify:  Site configuration → Environment variables
     Key:    PRACTICE_BETTER_API_KEY
     Secret: yes ("Contains secret values")
     Scopes: All scopes
     Value:  production (at minimum)

   It is read from the environment at request time and never sent to
   the browser. Do not put it in templates.json, studio.html, or any
   file in this repo — the repo is public and the site is unlisted, not
   private.

   ------------------------------------------------------------------
   STATUS: the request below is a placeholder. Practice Better's API
   base URL, auth header and client-list route still need confirming
   against their developer documentation. Everything else — the studio,
   the fallback to typing a name, the JSON shape this returns — is
   finished and working, so wiring this up is a change to the two marked
   lines, not to the app.

   Expected response shape:
     { "patients": [ { "id": "...", "name": "Jessica R.", "email": "..." } ] }
   ================================================================== */

const PB_BASE = process.env.PRACTICE_BETTER_API_BASE || 'https://api.practicebetter.io/v1';

export default async (request) => {
  const key = process.env.PRACTICE_BETTER_API_KEY;

  if (!key) {
    return json({
      error: 'not_configured',
      message: 'PRACTICE_BETTER_API_KEY is not set on this site.'
    }, 503);
  }

  try {
    // ── confirm this route and auth header against Practice Better's docs ──
    const res = await fetch(`${PB_BASE}/clients?limit=500`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      return json({
        error: 'upstream',
        status: res.status,
        message: `Practice Better returned ${res.status}.`
      }, 502);
    }

    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.clients || data.data || []);

    // Only what the studio needs to fill a dropdown — nothing clinical.
    const patients = rows.map(c => ({
      id: c.id || c._id,
      name: [c.firstName || c.first_name, c.lastName || c.last_name].filter(Boolean).join(' ')
            || c.name || c.fullName || 'Unnamed',
      email: c.email || ''
    })).filter(p => p.id);

    return json({ patients }, 200, {
      // A short cache keeps a busy clinic from hammering the API.
      'Cache-Control': 'private, max-age=300'
    });

  } catch (err) {
    return json({ error: 'request_failed', message: String(err) }, 502);
  }
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extra)
  });
}
