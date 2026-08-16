// PomoQuest service worker — network-first พร้อม cache สำรอง (ไม่แตะ API)
const CACHE = 'pomoquest-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api')) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(e.request);
        if (fresh.ok && url.origin === self.location.origin) {
          cache.put(e.request, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await cache.match(e.request);
        return cached || cache.match('/index.html');
      }
    })
  );
});
