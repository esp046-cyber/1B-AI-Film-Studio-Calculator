/* 1B AI Film Studio Calculator — service worker */
'use strict';

const CACHE_NAME = '1b-ai-calc-v1';

/* Required: install fails (and the old worker stays) if any of these cannot be fetched. */
const CORE_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './robots.txt',
  './css/styles.css',
  './js/app.js',
  './favicon.svg',
  './apple-touch-icon.svg',
  './icons/og-image.svg',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable-192.svg',
  './icons/icon-maskable-512.svg'
];

/* Optional: PNGs exported from the in-app Asset Exporter. Missing files are skipped. */
const OPTIONAL_ASSETS = [
  './apple-touch-icon.png',
  './icons/og-image.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-16x16.png',
  './icons/favicon-32x32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(CORE_ASSETS);
      await Promise.allSettled(OPTIONAL_ASSETS.map((url) => cache.add(url)));
    })
  );
  /* No automatic skipWaiting: the page shows an update banner and asks us via SKIP_WAITING. */
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME && k.startsWith('1b-ai-calc-')).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isAppShellNavigation(url) {
  const path = url.pathname;
  return path.endsWith('/') || path.endsWith('/index.html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Page navigations: network first, then cached app shell, then offline.html */
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok && isAppShellNavigation(url)) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('./index.html', fresh.clone());
          }
          return fresh;
        } catch (err) {
          const cache = await caches.open(CACHE_NAME);
          if (isAppShellNavigation(url)) {
            const shell = (await cache.match('./index.html')) || (await cache.match('./'));
            if (shell) return shell;
          }
          return (await cache.match('./offline.html')) || Response.error();
        }
      })()
    );
    return;
  }

  /* Static assets: stale-while-revalidate */
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      return res || Response.error();
    })()
  );
});
