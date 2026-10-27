const CACHE_NAME = 'stagetimer-pfp-v8';
const ASSETS = [
  '/',
  '/index.html',
  '/controller.html',
  '/operator.html',
  '/viewer.html',
  '/lineup.html',
  '/manifest.json',
  '/icon.svg',
  '/css/common.css',
  '/css/controller.css',
  '/css/operator.css',
  '/css/viewer.css',
  '/css/lineup.css',
  '/js/local-sync.js',
  '/js/controller.js',
  '/js/operator.js',
  '/js/viewer.js',
  '/js/lineup.js',
  '/js/auth.js',
  '/js/schedule-importer.js',
  '/js/pwa.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-First strategy: always fetch latest live version when online, fallback to cache if offline
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
