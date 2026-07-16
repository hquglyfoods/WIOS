// WIOS service worker: push + notification click + app badge. No caching.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'WIOS';
  const options = {
    body: data.body || '',
    tag: data.tag || 'wios',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/', coopId: data.coopId || null },
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    if (typeof data.badgeCount === 'number' && 'setAppBadge' in self.navigator) {
      try { await self.navigator.setAppBadge(data.badgeCount); } catch (e) {}
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const coopId = data.coopId || null;
  const url = data.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        if (coopId) c.postMessage({ type: 'wios-open', coopId });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
