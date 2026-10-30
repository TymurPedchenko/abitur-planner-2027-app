/* Generated app shell, version de3c5216cd816df3. User data lives outside this cache. */
const ASSETS = ["./assets/style.css","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon.svg","./icons/maskable-512.png","./index.html","./manifest.webmanifest","./schemas/backup.schema.json.js","./schemas/planning_bundle.schema.json.js","./schemas/week_plan.schema.json.js","./src/chatgpt.js","./src/main.js","./src/model.js","./src/planning.js","./src/project-config.js","./src/storage.js","./src/types.js","./src/validation.js","./vendor/LICENSE-ajv.txt","./vendor/ajv.js"];
const ASSET_HASHES = {"./assets/style.css":"1b481178001d901aa04efdf3a34ee91872b1259f9e4ca4794615d9c469b4e8ab","./icons/apple-touch-icon.png":"8229e2c5d3ee3097e594906341204c305bc665064f53f6146609d091cda4d850","./icons/icon-192.png":"d9604fe44958ff57a4c3f7f445a33f237b571c3df1d820ddc1468e23a5921844","./icons/icon-512.png":"5d7071a3ae9e8c0a38ff9d573c6056ce4a829957f02bbe232bdfd3c004a846b7","./icons/icon.svg":"f0dbf70d89d43f7ce26f9d3f785ea9f8908efa9b9c4e22b1c9a0e0a8bf54a2d4","./icons/maskable-512.png":"5d7071a3ae9e8c0a38ff9d573c6056ce4a829957f02bbe232bdfd3c004a846b7","./index.html":"789dd3e3d6ae4729133802b1bdf889c01f4f96eb8985916c1bae68b7939b9b16","./manifest.webmanifest":"6459943ab121cfccbe3921cf29e4bd65d048aac633a01d1e2e0732e7fa1b08c9","./schemas/backup.schema.json.js":"75a048933dcfe277561b08c3501daebef387940177fce9a45128888f69dc5891","./schemas/planning_bundle.schema.json.js":"a09a04e1ff35e84797ddd1a65d64b33fdfecc36341134ede0665ceb6beb00e5c","./schemas/week_plan.schema.json.js":"7ddda66eddc21b763609792f9606d59152d1ca4e451af07364d3febd741a6a54","./src/chatgpt.js":"4298b6abd135e2eb215087bc59ff9eeee4dd9cf8e0061a78dffd3e774247057c","./src/main.js":"cb8bba1ffc08ad413afd84e6ea50b0ea0ef5298afe062ea9a9bb2562b230e21f","./src/model.js":"61a28f27daafaeadc83656e47b4e468f698cab3cc09d86cdf2ce5043d11dbf4b","./src/planning.js":"c96f451b5413b8aad0cd8326256c7d8d6a5ffea9dcf50fc7d8b783e72568d667","./src/project-config.js":"021b341c4dce496854e1b11c88d4923dbbb7129ec647810f82b7f45ce7e239de","./src/storage.js":"76fe363635360906f41b0d7ceae55d059843d7abdeca5f6dec8700542bfd259a","./src/types.js":"664cf4afd9e2d8c9ff9864a7e98000e540294750e6ab89d7520fc8dc091bbe18","./src/validation.js":"2566878cfb3dc6212c28038207e19508c535651d9abb70257746fc2f1d29b052","./vendor/LICENSE-ajv.txt":"e85e131fa4ed25538ff1f4962ced1fb6f68b079bd9164a790597a0f30b8fd030","./vendor/ajv.js":"897376139ba4a7a9161d0e24ccbb91f2376aaee68a28b61b60e5e3da2db018ca"};
const PREFIX = 'abitur-planner:' + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + 'de3c5216cd816df3';
const URLS = ASSETS.map(path => new URL(path, self.registration.scope).href);
const HASHES = new Map(ASSETS.map((path, index) => [URLS[index], ASSET_HASHES[path]]));
const INDEX = new URL('./index.html', self.registration.scope).href;

async function isExpected(response, url) {
  if (!response || response.status !== 200 || response.redirected
    || (response.url && response.url !== url) || !HASHES.has(url)) return false;
  try {
    const hash = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    return hex === HASHES.get(url);
  } catch {
    return false;
  }
}

async function isComplete(cache) {
  try {
    return (await Promise.all(URLS.map(async url => isExpected(await cache.match(url), url)))).every(Boolean);
  } catch {
    return false;
  }
}

async function fetchExpected(url) {
  const response = await fetch(new Request(url, { cache: 'reload', redirect: 'error' }));
  if (!await isExpected(response, url)) throw new Error('App resource does not match this service worker generation.');
  return response;
}

async function notifyClients(type) {
  // Status notification failure must not turn a verified response into a loading failure.
  try {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.postMessage({ type });
  } catch {
    // No storage or reload side effects are needed to report unavailable offline resources.
  }
}

function unavailableResponse() {
  return new Response('This app resource is unavailable for the current version. Close the planner and reopen it online. Do not clear website data.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const existed = (await caches.keys()).includes(CACHE);
    let cache;
    try {
      if (existed) {
        cache = await caches.open(CACHE);
        if (await isComplete(cache)) return;
      }
      // Stage and verify every response before the first write to this generation's cache.
      const staged = await Promise.allSettled(URLS.map(fetchExpected));
      if (staged.some(result => result.status === 'rejected')) throw new Error('App shell download or integrity check failed.');
      cache ||= await caches.open(CACHE);
      const writes = await Promise.allSettled(URLS.map((url, index) => cache.put(url, staged[index].value)));
      if (writes.some(result => result.status === 'rejected') || !await isComplete(cache)) {
        throw new Error('App shell cache is incomplete.');
      }
    } catch (error) {
      // All puts have settled before cleanup. A failed reinstall never deletes an existing cache.
      if (!existed) await caches.delete(CACHE);
      throw error;
    }
    // No skipWaiting: existing controlled pages retain their current worker until they close.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    let ready = false;
    try { ready = await isComplete(await caches.open(CACHE)); } catch { /* Retain older caches. */ }
    if (!ready) {
      // Retaining older caches is not a rollback of the newly activated worker.
      await notifyClients('OFFLINE_UNAVAILABLE');
      return;
    }
    const keys = await caches.keys();
    await Promise.allSettled(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    // Do not take over an uncontrolled page halfway through its module graph.
    await notifyClients('OFFLINE_READY');
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'CHECK_OFFLINE' || event.data?.type === 'CHECK_OFFLINE') {
    event.waitUntil((async () => {
      let ready = false;
      try { ready = await isComplete(await caches.open(CACHE)); } catch { /* Report unavailable. */ }
      const message = { type: ready ? 'OFFLINE_READY' : 'OFFLINE_UNAVAILABLE' };
      if (event.ports?.[0]) event.ports[0].postMessage(message);
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
  if (!isNavigation && !HASHES.has(url.href)) return;
  const expectedURL = isNavigation ? INDEX : url.href;
  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(CACHE);
      const cached = await cache.match(expectedURL);
      if (await isExpected(cached, expectedURL)) return cached;
    } catch {
      // Cache storage can be unavailable; any network response must still match the pinned bytes.
    }
    try {
      const response = await fetchExpected(expectedURL);
      try {
        cache ||= await caches.open(CACHE);
        await cache.put(expectedURL, response.clone());
      } catch {
        await notifyClients('OFFLINE_UNAVAILABLE');
      }
      return response;
    } catch {
      await notifyClients('OFFLINE_UNAVAILABLE');
      return unavailableResponse();
    }
  })());
});
