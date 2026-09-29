importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js'
);

const SITE_URL = 'https://hlebish.github.io/warehouse_orders/';
const CACHE = 'order-desk-fcm-v19';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './amp-logo.png',
  './app-icon.svg'
];

// Handle notification clicks before FCM hooks.
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const link = event.notification?.data?.FCM_MSG?.data?.link
    || event.notification?.data?.link
    || SITE_URL;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          return client.navigate?.(link);
        }
      }
      return clients.openWindow(link);
    })
  );
});

firebase.initializeApp({
  apiKey: 'AIzaSyD4O2RXzhkuNhbIILsz5saVxmblW1xa4rU',
  authDomain: 'sklad-18f38.firebaseapp.com',
  projectId: 'sklad-18f38',
  storageBucket: 'sklad-18f38.firebasestorage.app',
  messagingSenderId: '329606730319',
  appId: '1:329606730319:web:0235d13ef2f01c71f5503a'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const data = payload?.data || {};
  const title = String(data.title || 'Заказы · Склад');
  const body = String(data.body || 'Новое изменение в заказе.');
  const eventId = String(data.eventId || '');
  const link = data.link || SITE_URL;

  self.registration.showNotification(title, {
    body,
    icon: './amp-logo.png',
    badge: './amp-logo.png',
    tag: eventId || 'warehouse-push',
    renotify: true,
    silent: false,
    vibrate: [200, 100, 200],
    data: {
      link,
      eventId
    }
  });
});


self.addEventListener('install', event =>
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  )
);

self.addEventListener('activate', event =>
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.filter(key => key !== CACHE).map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', event => {
  if (
    event.request.method !== 'GET' ||
    new URL(event.request.url).origin !== location.origin
  ) {
    return;
  }

  const url = new URL(event.request.url);
  const refreshFirst =
    event.request.mode === 'navigate' ||
    /\/(app\.js|firebase-config\.js|styles\.css|sw\.js)$/.test(url.pathname);

  event.respondWith((async () => {
    if (refreshFirst) {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          await caches.open(CACHE).then(cache =>
            cache.put(event.request, response.clone())
          );
        }
        return response;
      } catch {}
    }

    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok) {
        await caches.open(CACHE).then(cache =>
          cache.put(event.request, response.clone())
        );
      }
      return response;
    } catch {
      return caches.match('./index.html');
    }
  })());
});
