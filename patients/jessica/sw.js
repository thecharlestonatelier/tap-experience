/* ==================================================================
   SERVICE WORKER
   ------------------------------------------------------------------
   Its only job is reminders. It does not cache the portal — a cached
   dosing page is a page that can show yesterday's protocol after the
   atelier has changed it, and that is the one failure this whole service
   was built to remove.

   The payload it receives carries no drug, no dose and no name; see
   portal/lib/push.js for why. Everything specific is behind the tap.
   ================================================================== */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || 'The Charleston Atelier';
  const options = {
    body: data.body || 'A dose is due.',
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    // Same tag replaces rather than stacks, so a phone that was off all
    // day wakes to one reminder instead of six.
    tag: data.tag || 'dose',
    renotify: true,
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';

  // Prefer a window already open on this card over opening a second one.
  event.waitUntil((async () => {
    const url = new URL(target, self.location.href).href;
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url === url && 'focus' in client) return client.focus();
    }
    for (const client of all) {
      if (client.url.startsWith(self.registration.scope) && 'navigate' in client) {
        await client.navigate(url);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
