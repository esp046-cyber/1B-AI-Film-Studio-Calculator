/* 1B AI Film Studio Calculator — Service Worker */
const CACHE_NAME = '1b-ai-calc-v1';
const OFFLINE_URL = 'offline.html';

const PRECACHE_URLS = [
  './',
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'robots.txt',
  'css/styles.css',
  'js/app.js',
  'favicon.svg',
  'apple-touch-icon.svg',
  'icons/og-image.svg',
  'icons/icon-192.svg',
  'icons/icon-512.svg',
  'icons/icon-maskable-192.svg',
  'icons/icon-maskable-512.svg'
];

/* Optional raster icons: cached if the owner has exported them with the in-app Asset Exporter. */
const OPTIONAL_URLS = [
  'icons/og-image.png',
  'apple-touch-icon.png',
  'icons/apple-touch-icon.png',
  'icons/icon-72.png',
  'icons/icon-96.png',
  'icons/icon-128.png',
  'icons/icon-144.png',
  'icons/icon-152.png',
  'icons/icon-192.png',
  'icons/icon-384.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/favicon-16x16.png',
  'icons/favicon-32x32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(PRECACHE_URLS);
      await Promise.all(
        OPTIONAL_URLS.map((url) => cache.add(url).catch(() => undefined))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match(req, { ignoreSearch: true })) ||
            (await cache.match('index.html')) ||
            (await cache.match(OFFLINE_URL))
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
