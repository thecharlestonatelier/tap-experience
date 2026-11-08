/* ==================================================================
   WHICH ENDPOINTS A PUSH MAY GO TO
   ------------------------------------------------------------------
   A Web Push subscription carries an endpoint chosen by the browser.
   The server must not become a general HTTPS request-sender: a slug
   holder could register any URL and have the reminder sweep POST to it,
   following redirects. Only the real push services are allowed.
   ================================================================== */

const PUSH_HOST_SUFFIXES = [
  '.googleapis.com',              // Chrome / Android (FCM)
  '.push.apple.com',              // Safari
  '.push.services.mozilla.com',   // Firefox
  '.notify.windows.com',          // Edge (WNS)
];

function allowedPushEndpoint(endpoint) {
  try {
    const u = new URL(String(endpoint));
    return u.protocol === 'https:' &&
      PUSH_HOST_SUFFIXES.some(suffix => u.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

module.exports = { allowedPushEndpoint, PUSH_HOST_SUFFIXES };
