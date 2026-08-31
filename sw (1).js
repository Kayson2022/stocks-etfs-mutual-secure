// ═══════════════════════════════════════════════════
//  Stocks & Funds Tracker — Service Worker (sw.js)
//  Caches the app shell for instant offline loading.
//  Live prices still require internet (by design).
//
//  2026-09-01: three fixes.
//   1. The Cloudflare Worker that now serves quotes lives on
//      *.workers.dev, which does not contain "yahoo.com", so it fell
//      through to the cache-first branch and prices were served from
//      cache indefinitely. This is why the phone showed stale prices
//      while a hard-refreshed desktop looked fine.
//   2. index.html was cache-first, so a newly deployed app was never
//      picked up until site data was cleared by hand.
//   3. CACHE_NAME was pinned to v1, so the activate handler never had
//      an old cache to purge.
// ═══════════════════════════════════════════════════
const CACHE_NAME   = 'stocks-tracker-v2';
const CACHE_ASSETS = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@2.2.1/dist/chartjs-plugin-annotation.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
];

// Hosts whose responses must never be cached. Matched on hostname, so a
// new data source has to be added here or its responses go stale.
const LIVE_DATA_HOSTS = [
  'workers.dev',              // the yahoo-proxy Worker: /batch, /raw, /telegram
  'yahoo.com',
  'finnhub.io',
  'corsproxy.io',
  'allorigins.win',
  'alphavantage.co',
  'financialmodelingprep.com',
  'firestore.googleapis.com',
  'firebase',
  'googleapis.com',
  'rss2json.com',
  'api.telegram.org',
];

// ── Install: cache the app shell ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      // Use individual adds so one failure doesn't block the rest
      return Promise.allSettled(
        CACHE_ASSETS.map(url => cache.add(url).catch(e => console.warn('[SW] Failed to cache:', url, e)))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Live data: straight to the network, never cached.
  if (LIVE_DATA_HOSTS.some(h => url.hostname.includes(h))) {
    return;
  }

  // The app itself: network-first, cache only as an offline fallback.
  // Cache-first here meant a deployed update was invisible until site
  // data was cleared manually.
  const isAppDoc = event.request.mode === 'navigate'
                || url.pathname.endsWith('/')
                || url.pathname.endsWith('index.html');

  if (isAppDoc) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Everything else (fonts, chart libraries): cache-first is fine, these
  // are versioned URLs that do not change in place.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── Message: force update from app ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
