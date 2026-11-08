/* ==================================================================
   AUTH-HELPER PROXY HEADERS
   ------------------------------------------------------------------
   The Firebase auth helper is proxied through this service so the whole
   sign-in round trip is same-origin. The helper needs the browser's
   request, but it does not need the clinician's studio session or an
   arbitrary Authorization header: either would hand a credential to the
   auth host and its logs.
   ================================================================== */

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'te', 'trailer', 'proxy-authenticate', 'proxy-authorization',
  'content-length',
]);

/* Remove only the studio cookie; other cookies (Firebase's own) remain. */
function stripClinicianCookie(cookie) {
  if (!cookie) return '';
  return String(cookie)
    .split(';')
    .map(part => part.trim())
    .filter(part => part && !/^ca_studio=/i.test(part))
    .join('; ');
}

function authProxyHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const name = String(k).toLowerCase();
    if (HOP_BY_HOP.has(name) || name === 'host') continue;
    // The clinician session and any bearer credential stay here.
    if (name === 'authorization') continue;
    if (name === 'cookie') {
      const kept = stripClinicianCookie(v);
      if (kept) out[k] = kept;
      continue;
    }
    out[k] = v;
  }
  return out;
}

module.exports = { authProxyHeaders, stripClinicianCookie, HOP_BY_HOP };
