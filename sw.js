// WIOS service worker: push + notification click + app badge + fast-open cache.
const CACHE = 'wios-v1';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.26.4/babel.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Cache-first for the shell + big CDN libs (the slow part of first paint).
// Everything else (Supabase API, Netlify functions) goes straight to network.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isShell =
    url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html' ||
      url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icons/'));
  const isLib =
    url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isShell && !isLib) return;   // don't touch API/data requests
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => cached);
    return cached || network;   // serve cache instantly, refresh in background
  })());
});

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
