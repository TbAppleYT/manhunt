/* manhunt. service worker: offline app shell + cached static assets (map imagery, audio, icons).
   Game API calls are never cached — they must always come from the server. */
const VERSION = 'mh-v1';
const PRECACHE = ['/', '/join', '/settings', '/rules', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/map/town-center-satellite.jpg',
  '/photo-examples/GOOD_storefront_sign.thumb.jpg', '/photo-examples/BAD_parking_garage.thumb.jpg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const isStatic = /^\/(audio|map|icons|photo-examples|_next\/static)\//.test(url.pathname) || url.pathname === '/favicon.svg';
  if (isStatic) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; })));
  } else if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))));
  }
});

self.addEventListener('push', (e) => {
  let data = { title: 'manhunt.', body: 'Something happened in your game.' };
  try { data = { ...data, ...e.data.json() }; } catch { /* default text */ }
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: 'manhunt-game', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('/'))));
});
