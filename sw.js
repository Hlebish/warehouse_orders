importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js','https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyD4O2RXzhkuNhbIILsz5saVxmblW1xa4rU',authDomain:'sklad-18f38.firebaseapp.com',projectId:'sklad-18f38',storageBucket:'sklad-18f38.firebasestorage.app',messagingSenderId:'329606730319',appId:'1:329606730319:web:0235d13ef2f01c71f5503a'});
const messaging=firebase.messaging();
const CACHE='order-desk-fcm-v16';
const SITE_URL='https://hlebish.github.io/warehouse_orders/';
const ASSETS=['./','./index.html','./styles.css','./app.js','./firebase-config.js','./manifest.webmanifest','./amp-logo.png','./app-icon.svg'];

self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
 const url=new URL(event.request.url),refreshFirst=event.request.mode==='navigate'||/\/(app\.js|firebase-config\.js|styles\.css)$/.test(url.pathname);
 event.respondWith((async()=>{
  if(refreshFirst){
   try{const response=await fetch(event.request);if(response.ok)await caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));return response}catch{}
  }
  const cached=await caches.match(event.request);if(cached)return cached;
  try{const response=await fetch(event.request);if(response.ok)await caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));return response}catch{return caches.match('./index.html')}
 })());
});

messaging.onBackgroundMessage(payload=>{
 const data=payload.data||payload.notification||{};
 const title=data.title||'Заказы · Склад';
 const body=data.body||'Новое изменение в заказе.';
 const link=data.link||SITE_URL;
 self.registration.showNotification(title,{body,icon:'./amp-logo.png',badge:'./amp-logo.png',tag:data.eventId||undefined,data:{link}});
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const link=event.notification?.data?.link||SITE_URL;
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(clientList=>{
   for(const client of clientList){
     if('focus' in client){
       client.focus();
       return client.navigate?.(link);
     }
   }
   return clients.openWindow(link);
 }));
});
