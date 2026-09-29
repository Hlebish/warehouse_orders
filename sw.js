const CACHE='order-desk-comments-all-v10';
const ASSETS=['./','./index.html','./styles.css','./app.js','./firebase-config.js','./manifest.webmanifest','./amp-logo.png'];
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
