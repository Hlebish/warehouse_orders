const fs = require('fs');
const path = require('path');

const root = process.cwd();
function file(p) { return path.join(root, p); }
function read(p) { return fs.readFileSync(file(p), 'utf8'); }
function write(p, s) {
  const target = file(p);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, s, 'utf8');
}
function replaceOnce(p, oldText, newText) {
  const full = read(p);
  const count = full.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`${p}: expected exactly 1 match, found ${count}`);
  }
  write(p, full.replace(oldText, newText));
}

console.log('Applying Firebase push upgrade...');

replaceOnce('app.js',
`async function queuePush(id,title,body,authorId){try{await setDoc(doc(db,'pushQueue',id),{title,body,authorId,createdAt:isoNow(),sentAt:null})}catch(err){console.warn('Push event was not queued',err)}}`,
`async function queuePush(title,body,authorId){try{await setDoc(doc(db,'pushQueue',crypto.randomUUID()),{title:String(title||'Заказы · Склад'),body:String(body||'Новое изменение в заказе.'),authorId,createdAt:isoNow(),sentAt:null})}catch(err){console.warn('Push event was not queued',err)}}`);

replaceOnce('app.js',
"if(!base)await queuePush(`order-${o.id}`,`Новый заказ № ${o.number}`,o.client||'Создан новый заказ',signedInUser.uid);",
"await queuePush(newOrder?`Новый заказ № ${o.number}`:`Заказ № ${o.number} изменён`,newOrder?(o.client||'Создан новый заказ'):`Статус: ${next.status}`,signedInUser.uid);");

replaceOnce('app.js',
"for(const e of o.entries||[]){const cloud=entryToCloud(e),old=oldEntries.get(e.id);if(!old||!equal(cloud,entryToCloud(old))){await setDoc(doc(db,'orders',o.id,'entries',e.id),cloud);if(!old&&e.kind!=='viewed')await queuePush(`entry-${o.id}-${e.id}`,`Заказ № ${o.number}: ${e.author||profileName}`,e.text||e.kind,signedInUser.uid);oldEntries.delete(e.id)}else oldEntries.delete(e.id)}",
"for(const e of o.entries||[]){const cloud=entryToCloud(e),old=oldEntries.get(e.id);if(!old||!equal(cloud,entryToCloud(old))){await setDoc(doc(db,'orders',o.id,'entries',e.id),cloud);if(!newOrder&&e.kind!=='viewed'){const label=e.kind==='decision'?'Решение':e.kind==='defect'?'Дефект':e.kind==='question'?'Вопрос':'Комментарий';const body=e.kind==='decision'&&e.decision?`Решение: ${e.decision}. ${e.decisionText||e.text||''}`:e.text||label;await queuePush(`Заказ № ${o.number}: ${label}`,body,signedInUser.uid)}oldEntries.delete(e.id)}else oldEntries.delete(e.id)}");

replaceOnce('app.js',
"for(const removedId of oldEntries.keys())await deleteDoc(doc(db,'orders',o.id,'entries',removedId));",
"for(const removedId of oldEntries.keys()){await deleteDoc(doc(db,'orders',o.id,'entries',removedId));await queuePush(`Заказ № ${o.number} изменён`,'Запись из истории была удалена директором.',signedInUser.uid)}");

replaceOnce('app.js',
"await deleteDoc(sourceRef);entryUnsubscribes.get(o.id)?.();",
"await queuePush(`Заказ № ${o.number} удалён`,`Заказ удалён администратором ${profileName || 'сотрудником'}.`,signedInUser.uid);await deleteDoc(sourceRef);entryUnsubscribes.get(o.id)?.();");

replaceOnce('app.js',
"onMessage(messaging,payload=>{const n=payload.notification||{};if(n.title)toast(`${n.title}${n.body?`: ${n.body}`:''}`)})",
"onMessage(messaging,payload=>{const n=payload.notification||payload.data||{};if(n.title)toast(`${n.title}${n.body?`: ${n.body}`:''}`)})");

write('sw.js', `importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js','https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');
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
`);

const firebase = JSON.parse(read('firebase.json'));
firebase.functions = { source: 'functions', runtime: 'nodejs22' };
firebase.hosting = firebase.hosting || {};
firebase.hosting.ignore = Array.from(new Set([
  ...(firebase.hosting.ignore || []),
  'functions/**',
  'push-sender.cjs',
  '.github/**'
]));
write('firebase.json', JSON.stringify(firebase, null, 2) + '\n');

let index = read('index.html')
  .replace('styles.css?v=20260929-fcm-key1','styles.css?v=20260929-fcm-key2')
  .replace('app.js?v=20260929-fcm-key1','app.js?v=20260929-fcm-key2');
write('index.html', index);

write('functions/package.json', `{
  "name": "warehouse-orders-functions",
  "private": true,
  "main": "index.js",
  "engines": {
    "node": "22"
  },
  "dependencies": {
    "firebase-admin": "^14.5.0",
    "firebase-functions": "^7.4.0"
  }
}
`);

write('functions/index.js', `const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2/options');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

setGlobalOptions({
  region: 'europe-west1',
  memory: '256MiB',
  timeoutSeconds: 60,
  maxInstances: 1
});

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

async function claimEvent(ref) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;

    const data = snap.data() || {};
    if (data.sentAt) return false;

    if (data.processingAt) {
      const started = data.processingAt instanceof Timestamp
        ? data.processingAt.toMillis()
        : Date.parse(data.processingStartedAt || '');
      if (Number.isFinite(started) && Date.now() - started < 120000) return false;
    }

    tx.update(ref, {
      processingAt: FieldValue.serverTimestamp(),
      processingStartedAt: new Date().toISOString()
    });
    return true;
  });
}

async function markDone(ref, fields) {
  await ref.update({
    ...fields,
    sentAt: FieldValue.serverTimestamp(),
    processingAt: FieldValue.delete(),
    processingStartedAt: FieldValue.delete()
  });
}

async function collectTokens() {
  const users = await db.collection('users').where('active', '==', true).get();
  const tokenGroups = await Promise.all(
    users.docs.map(user => user.ref.collection('pushTokens').get())
  );

  return tokenGroups.flatMap(snapshot => snapshot.docs.map(tokenDoc => ({
    ref: tokenDoc.ref,
    token: tokenDoc.get('token')
  })));
}

exports.sendWarehousePush = onDocumentCreated('pushQueue/{eventId}', async event => {
  const snapshot = event.data;
  if (!snapshot) return;

  const claimed = await claimEvent(snapshot.ref);
  if (!claimed) return;

  const data = snapshot.data() || {};
  const title = String(data.title || 'Заказы · Склад').slice(0, 120);
  const body = String(data.body || 'Новое изменение в заказе.').slice(0, 500);
  const eventId = event.params.eventId;
  const siteUrl = 'https://hlebish.github.io/warehouse_orders/';

  try {
    const tokenDocs = await collectTokens();

    if (!tokenDocs.length) {
      await markDone(snapshot.ref, {
        deliveryStatus: 'no_devices',
        acceptedCount: 0,
        failedCount: 0
      });
      logger.info('Push skipped: no registered devices', { eventId });
      return;
    }

    let accepted = 0;
    let failed = 0;
    const failureCodes = new Map();

    for (let i = 0; i < tokenDocs.length; i += 500) {
      const group = tokenDocs.slice(i, i + 500);

      const response = await messaging.sendEachForMulticast({
        tokens: group.map(item => item.token),
        data: {
          title,
          body,
          eventId,
          link: siteUrl
        },
        webpush: {
          headers: {
            Urgency: 'high',
            TTL: '86400'
          },
          fcmOptions: {
            link: siteUrl
          }
        }
      });

      const removals = [];

      response.responses.forEach((result, index) => {
        if (result.success) {
          accepted++;
          return;
        }

        failed++;
        const code = result.error?.code || 'unknown';
        failureCodes.set(code, (failureCodes.get(code) || 0) + 1);

        if (INVALID_TOKEN_CODES.has(code)) {
          removals.push(group[index].ref.delete());
        }
      });

      await Promise.all(removals);
    }

    const failures = Object.fromEntries(failureCodes);

    if (accepted > 0) {
      await markDone(snapshot.ref, {
        deliveryStatus: failed ? 'partially_accepted' : 'accepted',
        acceptedCount: accepted,
        failedCount: failed,
        failureCodes: failures
      });
      logger.info('Push sent', { eventId, accepted, failed });
      return;
    }

    const onlyInvalidTokens =
      failed > 0 &&
      [...failureCodes.keys()].every(code => INVALID_TOKEN_CODES.has(code));

    if (onlyInvalidTokens) {
      await markDone(snapshot.ref, {
        deliveryStatus: 'no_valid_devices',
        acceptedCount: 0,
        failedCount: failed,
        failureCodes: failures
      });
      logger.warn('Push had no valid devices', { eventId, failed });
      return;
    }

    throw new Error(
      'FCM rejected all device deliveries for ' +
      eventId +
      ': ' +
      JSON.stringify(failures)
    );
  } catch (error) {
    await snapshot.ref.update({
      deliveryStatus: 'retrying',
      lastError: String(error?.message || error),
      processingAt: FieldValue.delete(),
      processingStartedAt: FieldValue.delete()
    });

    logger.error('Push delivery failed', {
      eventId,
      error: String(error?.message || error)
    });

    throw error;
  }
});
`);

let gitignore = fs.existsSync(file('.gitignore')) ? read('.gitignore') : '';
if (!gitignore.split(/\r?\n/).includes('functions/node_modules/')) {
  gitignore = gitignore.replace(/\s*$/, '') + '\nfunctions/node_modules/\n';
  write('.gitignore', gitignore);
}

let readme = read('README.md');
const marker = '### Настроить фоновые push-уведомления';
const at = readme.indexOf(marker);
const section = [
  marker,
  '',
  'Система использует Firebase Cloud Messaging (FCM) и Cloud Functions 2nd gen. Клиент регистрирует FCM-токен каждого устройства в users/{UID}/pushTokens; любое изменение в очереди pushQueue запускает серверную функцию, которая отправляет push на все активные зарегистрированные устройства.',
  '',
  '1. Переведите проект sklad-18f38 на план Blaze.',
  '2. Установите Firebase CLI: npm install -g firebase-tools',
  '3. Выполните: firebase login',
  '4. В корне проекта выполните: firebase deploy --only functions',
  '5. На каждом компьютере/телефоне один раз разрешите уведомления через центр уведомлений приложения.',
  '',
  'Основной путь доставки: Изменение заказа → Firestore → Cloud Function → FCM → телефон/ПК.',
  '',
  'GitHub Actions больше не используется для отправки push, поэтому задержка до 5 минут не нужна.',
  '',
  'Для контроля расходов на Blaze настройте бюджетное уведомление и spend cap для Cloud Functions в Google Cloud/Firebase Console.',
  ''
].join('\n');

if (at >= 0) {
  write('README.md', readme.slice(0, at) + section);
}

for (const oldPath of ['push-sender.cjs', '.github/workflows/push-notifications.yml']) {
  const target = file(oldPath);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

console.log('');
console.log('✅ Push upgrade applied.');
console.log('');
console.log('Next steps:');
console.log('1) npm install -g firebase-tools');
console.log('2) firebase login');
console.log('3) firebase deploy --only functions');
console.log('4) Open the website on each device and enable notifications once.');
