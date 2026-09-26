const CACHE_NAME = 'hub-shell-v2';
const SHELL_ASSETS = ['/', '/index.html', '/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Refresh the copy, or a load while the hub restarts serves the shell from install time.
        if (res.ok && e.request.method === 'GET' && SHELL_ASSETS.includes(new URL(e.request.url).pathname)) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy)));
        }
        return res;
      })
      // respondWith(undefined) throws, so a miss while the server is down must still be a Response.
      .catch(() => caches.match(e.request).then((cached) => cached || Response.error()))
  );
});
