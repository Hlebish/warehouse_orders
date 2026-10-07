importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js'
);

const SITE_URL = 'https://hlebish.github.io/warehouse_orders/';
const CACHE = 'order-desk-fcm-v25';
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

  const rawLink =
    event.notification?.data?.link ||
    event.notification?.data?.FCM_MSG?.data?.link ||
    event.notification?.data?.FCM_MSG?.notification?.click_action ||
    SITE_URL;

  let link = SITE_URL;
  try {
    const url = new URL(String(rawLink), SITE_URL);
    // Only allow navigation inside the warehouse app.
    if (url.origin === new URL(SITE_URL).origin) {
      link = url.href;
    }
  } catch {
    link = SITE_URL;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const siteUrl = new URL(SITE_URL);
      const sameSiteClient = clientList.find(client => {
        try {
          const clientUrl = new URL(client.url);
          return clientUrl.origin === siteUrl.origin &&
            (clientUrl.pathname === siteUrl.pathname ||
             clientUrl.pathname.startsWith(siteUrl.pathname));
        } catch {
          return false;
        }
      });

      if (sameSiteClient) {
        return sameSiteClient.focus().then(() => {
          if ('navigate' in sameSiteClient) {
            return sameSiteClient.navigate(link);
          }
          return undefined;
        });
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
        const response = await fetch(event.request, {cache: 'no-store'});
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
