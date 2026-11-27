importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js'
);

const SITE_URL = 'https://hlebish.github.io/warehouse_orders/';
const CACHE = 'order-desk-static-v157-integrity';
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
  const notificationTag=String(data.notificationTag||eventId||'warehouse-push').slice(0,64);
  const link=String(data.link||SITE_URL);
  const now=Date.now();
  // Drop stale queued pushes instead of replaying a backlog when the browser reopens.
  const createdAt=Date.parse(String(data.createdAt||''));
  const expiresAt=Number(data.expiresAt);
  if(Number.isFinite(expiresAt)&&expiresAt>0){if(now>expiresAt)return;}
  else if(!Number.isFinite(createdAt)||createdAt>now+30000||now-createdAt>90000)return;

  for(const [key,time] of shownPushEvents){
    if(now-time>15000)shownPushEvents.delete(key);
  }

  if(eventId&&shownPushEvents.has(eventId))return;
  if(eventId)shownPushEvents.set(eventId,now);

  return self.registration.showNotification(title,{
    body,
    icon:'./assets/notification-amp.png?v=20261112-amp',
    badge:'./assets/notification-amp.png?v=20261112-amp',
    tag:notificationTag,
    renotify:false,
    // Foreground pages play the bundled site sound themselves; background
    // push notifications keep the normal Windows/browser notification sound.
    silent:data.silent===true,
    vibrate:[200,100,200],
    data:{link,eventId,notificationTag}
  });
}

messaging.onBackgroundMessage(payload=>{
  // FCM awaits this promise to keep the push event alive until display completes.
  return showPushNotification(payload?.data||payload?.notification||{});
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
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE &&
      (key.startsWith('order-desk-fcm-') || key.startsWith('order-desk-static-'))).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Only immutable, explicitly versioned same-origin scripts/styles are cached.
// HTML, API calls, unversioned files and all Firestore traffic remain network-only.
self.addEventListener('fetch', event => {
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==location.origin)return;
  const scope=new URL(self.registration.scope);
  const versioned=url.pathname.startsWith(scope.pathname)&&url.searchParams.has('v')&&
    ['script','style'].includes(request.destination)&&/\.(?:m?js|css)$/.test(url.pathname);
  if(!versioned){event.respondWith(fetch(request,{cache:'no-store'}));return;}
  event.respondWith((async()=>{
    let cache;try{cache=await caches.open(CACHE);const hit=await cache.match(request);if(hit)return hit;}catch{}
    const response=await fetch(request,{cache:'no-store'});
    if(cache&&response.ok&&response.type==='basic')try{await cache.put(request,response.clone());}catch{}
    return response;
  })());
});
