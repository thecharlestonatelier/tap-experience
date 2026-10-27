/* ==================================================================
   CARD STUDIO — SERVICE WORKER
   ------------------------------------------------------------------
   One job: let the atelier be told when a patient changes her own
   protocol. It caches nothing, for the same reason the patient's worker
   caches nothing — a stale dashboard is a dashboard showing a protocol
   that has since moved.

   The payload carries no patient and no drug. A notification renders on
   a locked screen, and the push services are not under the atelier's
   BAA; see lib/push.js. It says something changed, and the detail is
   behind the tap, which lands on a dashboard behind the passphrase.
   ================================================================== */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  event.waitUntil(self.registration.showNotification(
    data.title || 'The Charleston Atelier',
    {
      body: data.body || 'Something on a card has changed.',
      icon: 'monogram.png',
      badge: 'monogram.png',
      // One tag for the whole class, so three patients in an afternoon
      // leave one notification rather than three to dismiss.
      tag: data.tag || 'studio',
      renotify: true,
      data: { url: data.url || '/studio/' }
    }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/studio/';

  event.waitUntil((async () => {
    const url = new URL(target, self.location.href).href;
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // A dashboard already open is the one to bring forward, and it should
    // reload — the whole point of the tap is to see what changed.
    for (const client of all) {
      if (client.url.startsWith(self.registration.scope)) {
        if ('navigate' in client) await client.navigate(url);
        if ('focus' in client) return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
