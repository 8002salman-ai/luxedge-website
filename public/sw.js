/* ============================================================================
 * LUXEDGE SERVICE WORKER — conservative by design.
 *
 * What it does:
 *   - Cache-first only for immutable hashed build assets (/assets/*-hash.*).
 *     This is the one truly safe long-lived cache: filenames change per build.
 *   - Network-first for storefront page navigations (HTML), with an offline
 *     fallback to the last cached shell. No stale page is ever served when
 *     the network works.
 *
 * What it deliberately NEVER touches (security / freshness):
 *   - Any /api/* request (checkout, orders, admin endpoints, ai, uploads).
 *   - Any cross-origin request (Supabase REST, image CDNs, ads, analytics).
 *   - Admin pages (/admin/*): always fetched from the network, never cached,
 *     never served offline — auth/session and private data stay live and are
 *     never written into the cache.
 *   - Non-GET requests.
 *
 * This worker is for app-shell installability + fast repeat loads. It makes
 * no assumption that a cached copy is the truth for anything dynamic.
 * ============================================================================
 */
const SHELL_CACHE = 'luxedge-shell-v1';
const ASSET_CACHE = 'luxedge-assets-v1';

self.addEventListener('install', () => {
  // Take control quickly; precaching is avoided so an empty cache can never
  // serve a broken offline shell.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => (k.startsWith('luxedge-') && k !== SHELL_CACHE && k !== ASSET_CACHE))
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never intercept cross-origin traffic (Supabase, CDNs, ads, analytics).
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  // Admin + API + other private/dynamic endpoints: network only, never cached.
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/') || path.startsWith('/admin-manifest')) {
    return; // let the browser fetch normally — no interception, no caching
  }

  // Immutable hashed assets: cache-first (they are versioned by filename).
  if (path.startsWith('/assets/')) {
    event.respondWith(assetStrategy(req));
    return;
  }

  // Page navigations (storefront + everything else same-origin): network-first
  // with an offline fallback to the last good shell. HTML is only cached when
  // the network actually succeeded.
  if (req.mode === 'navigate') {
    event.respondWith(navStrategy(req));
  }
});

async function assetStrategy(req) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return hit || new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function navStrategy(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Offline: try the exact URL, then the root shell. Never reach into
    // /admin (the network-only rule above already excludes those navigations).
    const hit = (await cache.match(req)) || (await cache.match('/'));
    if (hit) return hit;
    return new Response('Offline — please reconnect to view Luxedge.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
