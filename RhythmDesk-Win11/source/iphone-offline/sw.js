const scope = self.registration.scope;
const prefix = 'rhythmdesk-iphone-offline:' + scope + ':';
const cacheName = prefix + '__BUILD_ID__';
const launch = scope;
const backup = new URL('RhythmDesk-iPhone-Offline.html', scope).href;
const required = new Map(Object.entries(__REQUIRED_DIGESTS__)
  .map(([path, hash]) => [new URL(path, scope).href, hash]));
const optional = ['manifest.webmanifest', 'apple-touch-icon.png', 'app-192.png', 'app-512.png']
  .map(path => new URL(path, scope).href);

async function verified(response, hash) {
  if (!response?.ok) return null;
  const bytes = await response.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  return digest === hash ? bytes : null;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      for (const [url, hash] of required) {
        const source = url === launch ? new URL('offline-shell.html', scope).href : url;
        const response = await fetch(source, {cache: 'reload', credentials: 'same-origin'});
        const bytes = await verified(response, hash);
        if (!bytes) throw new Error('Incomplete offline page');
        // Store a fresh response so a server redirect never becomes an offline navigation redirect.
        await cache.put(url, new Response(bytes, {headers: {'Content-Type': 'text/html; charset=utf-8'}}));
      }
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
    await Promise.allSettled(optional.map(async url => {
      const response = await fetch(url, {cache: 'reload', credentials: 'same-origin'});
      if (response.ok && !response.redirected) await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys())
      .filter(key => key.startsWith(prefix) && key !== cacheName)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const target = url.origin + url.pathname;
  if (target === launch && url.searchParams.get('rhythm-cache-check') === '1') {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const results = await Promise.all(Array.from(required,
        async ([key, hash]) => Boolean(await verified(await cache.match(key), hash))));
      return new Response(JSON.stringify({version: '1.65', ready: results.every(Boolean)}), {
        headers: {'Content-Type': 'application/json', 'X-RhythmDesk-Cache': '__BUILD_ID__'},
      });
    })());
    return;
  }
  const isLaunch = request.mode === 'navigate'
    && (target === launch || target === new URL('index.html', scope).href);
  const key = isLaunch ? launch : request.url;
  if (!required.has(key) && !optional.includes(key)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(cacheName)).match(key);
    if (cached) return cached;
    if (isLaunch && url.searchParams.get('rhythm-offline-test') === '1') {
      return new Response('离线副本未就绪，请联网重新打开。', {
        status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'},
      });
    }
    return fetch(request);
  })());
});
