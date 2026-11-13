const CACHE_NAME = 'stagetimer-pfp-v108';
const ASSETS = [
  './',
  './index.html',
  './controller.html',
  './operator.html',
  './viewer.html',
  './lineup.html',
  './regies.html',
  './dc.html',
  './cue-station.html',
  './master.html',
  './manifest.json',
  './icon.svg',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32x32.png',
  './css/common.css',
  './css/controller.css',
  './css/operator.css',
  './css/viewer.css',
  './css/lineup.css',
  './css/regies.css',
  './css/dc.css',
  './css/cue-station.css',
  './css/master.css',
  './js/local-sync.js',
  './js/notifications.js',
  './js/controller.js',
  './js/operator.js',
  './js/viewer.js',
  './js/lineup.js',
  './js/regies.js',
  './js/dc.js',
  './js/cue-station.js',
  './js/master.js',
  './js/auth.js',
  './js/schedule-importer.js',
  './js/theatre-importer.js',
  './js/pwa.js'
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

// Push Notifications Listener (Background Mobile Wake & Alerts)
self.addEventListener('push', (event) => {
  let data = {
    title: 'StageTimer PFP',
    body: 'Alerta de Palco',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'stagetimer-alert',
    vibrate: [200, 100, 200, 100, 200],
    data: { url: './' }
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = Object.assign(data, parsed);
    } catch (_) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    vibrate: data.vibrate || [200, 100, 200, 100, 200],
    tag: data.tag || 'stagetimer-alert',
    renotify: true,
    data: data.data || { url: './' }
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification Click Handler (Brings the active app or tab to foreground)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
