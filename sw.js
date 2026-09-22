const CACHE_NAME = 'stundenzettel-v11';
const ASSETS = [
  './',
  './index.html',
  './config.js',
  './app.js',
  './manifest.json',
  './assets/template.pdf',
  './assets/logo.jpg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/pdf-lib.min.js',
  './vendor/fontkit.umd.min.js',
  './vendor/patrick-hand.ttf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then((resp) => {
      try {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      } catch (e) { /* ignore */ }
      return resp;
    }).catch(() => caches.match(event.request))
  );
});
