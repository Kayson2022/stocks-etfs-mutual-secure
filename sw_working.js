// ═══════════════════════════════════════════════════
//  Stocks & Funds Tracker — Service Worker (sw.js)
//  Caches the app shell for instant offline loading.
//  Live prices still require internet (by design).
// ═══════════════════════════════════════════════════

const CACHE_NAME   = 'stocks-tracker-v1';
const CACHE_ASSETS = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@2.2.1/dist/chartjs-plugin-annotation.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
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

// ── Fetch: network-first for API calls, cache-first for app shell ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network-first for live data APIs — never serve stale prices
  const isApiCall =
    url.hostname.includes('yahoo.com')       ||
    url.hostname.includes('finnhub.io')      ||
    url.hostname.includes('corsproxy.io')    ||
    url.hostname.includes('allorigins.win')  ||
    url.hostname.includes('alphavantage.co') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('rss2json.com');

  if (isApiCall) {
    // Network-only for live data — fall through to network, no caching
    return;
  }

  // Cache-first for app shell (HTML, JS libraries, fonts)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful GET responses for app assets
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve index.html for navigation requests
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
