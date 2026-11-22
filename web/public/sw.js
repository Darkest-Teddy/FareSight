const SHELL = 'faresight-shell-v1';
const DEMO = 'faresight-demo-v2';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch('/', { cache: 'reload' });
    await captureShell(response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('faresight-') && key !== SHELL && key !== DEMO) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'warm-demo-cache') event.waitUntil(warmDemoCache());
});

async function warmDemoCache() {
  try {
    const index = await fetch('/assets-demo/cache-list.json');
    if (!index.ok) return;
    const files = (await index.json()).filter((path) =>
      typeof path === 'string' && path.startsWith('/assets-demo/') &&
      !/\/dish-[^/]+\.sog$/i.test(new URL(path, self.location.origin).pathname),
    );
    for (let i = 0; i < files.length; i += 4) {
      await Promise.allSettled(files.slice(i, i + 4)
        .map((path) => cacheFirst(DEMO, new Request(new URL(path, self.location.origin)))));
    }
  } catch { /* Development and older deployments can cache demo files on demand. */ }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET' || request.headers.has('range')) return;
  if (url.pathname.startsWith('/assets-demo/') || url.pathname.toLowerCase().endsWith('.glb')) {
    event.respondWith(networkFirst(DEMO, request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(SHELL, request));
  } else if (request.mode === 'navigate' && url.pathname === '/') {
    const network = fetch(request);
    event.waitUntil(network.then((response) => captureShell(response.clone())).catch(() => {}));
    event.respondWith(network.catch(async () => (await caches.match('/')) ?? Response.error()));
  }
});

async function captureShell(response) {
  if (!response.ok) return;
  const html = await response.clone().text();
  const bundles = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]);
  if (!bundles.length) return;
  const cache = await caches.open(SHELL);
  const existing = await Promise.all(bundles.map((path) => cache.match(path)));
  await cache.addAll(bundles.filter((_, index) => !existing[index]));
  await cache.put('/', response);
}

// Regenerated models keep their file names, so demo assets are always checked against the
// network and the cached copy is only used when the network is unavailable.
async function networkFirst(key, request) {
  try {
    const response = await fetch(request);
    if (response.ok) return store(await caches.open(key), request, response);
  } catch { /* Offline: fall through to the cached copy. */ }
  return cacheFirst(key, request);
}

async function cacheFirst(key, request) {
  const cache = await caches.open(key);
  const hit = await cache.match(request);
  if (hit) return hit;
  return store(cache, request, await fetch(request));
}

async function store(cache, request, response) {
  const contentType = response.headers.get('content-type') ?? '';
  const jsonAsset = new URL(request.url).pathname.endsWith('.json');
  if (response.status === 200 && !contentType.includes('text/html') && (!contentType.includes('application/json') || jsonAsset)) {
    try { await cache.put(request, response.clone()); }
    catch { /* Quota limits should not stop the current view from loading. */ }
  }
  return response;
}
