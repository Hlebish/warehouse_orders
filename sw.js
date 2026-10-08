importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js'
);

const SITE_URL = 'https://hlebish.github.io/warehouse_orders/';
const CACHE = 'order-desk-fcm-v36';
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

const shownPushEvents=new Map();

function showPushNotification(data={}){
  const title=String(data.title||'Заказы · Склад');
  const body=String(data.body||'Новое изменение в заказе.');
  const eventId=String(data.eventId||'');
  const link=String(data.link||SITE_URL);
  const now=Date.now();

  for(const [key,time] of shownPushEvents){
    if(now-time>15000)shownPushEvents.delete(key);
  }

  if(eventId&&shownPushEvents.has(eventId))return;
  if(eventId)shownPushEvents.set(eventId,now);

  return self.registration.showNotification(title,{
    body,
    icon:'./amp-logo.png',
    badge:'./amp-logo.png',
    tag:eventId||'warehouse-push',
    renotify:true,
    silent:false,
    vibrate:[200,100,200],
    data:{link,eventId}
  });
}

messaging.onBackgroundMessage(payload=>{
  showPushNotification(payload?.data||payload?.notification||{});
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SHOW_FOREGROUND_NOTIFICATION'){
    event.waitUntil(showPushNotification(event.data));
  }
});


self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({type:'window', includeUncontrolled:true}))
      .then(clientsList => {
        clientsList.forEach(client => client.postMessage({type:'APP_UPDATED'}));
      })
  );
});

// Never cache the application shell. Firebase/Firestore data is always fetched
// by the page directly from the network. The service worker is kept only for FCM.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request, {cache: 'no-store'}));
});
