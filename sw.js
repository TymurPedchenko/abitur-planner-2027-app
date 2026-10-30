/* Generated app shell, version d42eea87e80b0cab. User data lives outside this cache. */
const ASSETS = ["./assets/style.css","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon.svg","./icons/maskable-512.png","./index.html","./manifest.webmanifest","./schemas/backup.schema.json.js","./schemas/planning_bundle.schema.json.js","./schemas/week_plan.schema.json.js","./src/main.js","./src/model.js","./src/planning.js","./src/project-config.js","./src/storage.js","./src/types.js","./src/validation.js","./vendor/LICENSE-ajv.txt","./vendor/ajv.js"];
const PREFIX = 'abitur-planner:' + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + 'd42eea87e80b0cab';
const URLS = ASSETS.map(path => new URL(path, self.registration.scope).href);
const INDEX = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(URLS.map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // Deliberately no skipWaiting: existing pages keep their matching asset version.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.postMessage({ type: 'OFFLINE_READY' });
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'CHECK_OFFLINE' || event.data?.type === 'CHECK_OFFLINE') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const ready = (await Promise.all(URLS.map(url => cache.match(url)))).every(Boolean);
      const message = { type: ready ? 'OFFLINE_READY' : 'OFFLINE_UNAVAILABLE' };
      if (event.ports[0]) event.ports[0].postMessage(message);
      else event.source?.postMessage(message);
    })());
  }
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  url.search = '';
  url.hash = '';
  const isNavigation = request.mode === 'navigate';
  if (!isNavigation && !URLS.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(isNavigation ? INDEX : url.href);
    if (cached) return cached;
    // Cache misses can occur after browser eviction. Never cache arbitrary data or external URLs.
    return fetch(request);
  })());
});
