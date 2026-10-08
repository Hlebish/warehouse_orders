import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential, GoogleAuthProvider, signInWithPopup, linkWithCredential } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, getDoc, updateDoc, writeBatch, serverTimestamp, query, orderBy, limit, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import { getMessaging, getToken, deleteToken, onMessage } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';
import { firebaseConfig, vapidKey } from './firebase-config.js';
const firebaseApp=initializeApp(firebaseConfig),auth=getAuth(firebaseApp),db=getFirestore(firebaseApp),messaging=getMessaging(firebaseApp),storage=getStorage(firebaseApp),staffAuth=getAuth(initializeApp(firebaseConfig,'amp-staff-provisioner'));
let signedInUser=null,profileName='',canManageUsers=false,profileUnsubscribe=null,ordersUnsubscribe=null,chatUnsubscribe=null,chatBadgeUnsubscribe=null,notificationsUnsubscribe=null,serverCache=new Map(),entryUnsubscribes=new Map(),pendingWrites=new Set(),pendingOrderData=new Map(),initialCloudLoad=true;
const roles={warehouse:'Кладовщик',manager:'Менеджер',chief_accountant:'Главный бухгалтер',accountant:'Бухгалтер',director:'Директор'};
const isManagerRole=()=>['manager','chief_accountant','accountant'].includes(state.role);
const isShipmentLocked=o=>o?.status==='Отгружен кладовщиком'&&!canManageUsers;
const canEditOrder=o=>!!o&&!isShipmentLocked(o);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isoNow=()=>new Date().toISOString();
const asDate=d=>{if(!d)return null;if(typeof d.toDate==='function')return d.toDate();if(typeof d.toMillis==='function')return new Date(d.toMillis());if(d instanceof Date)return d;const out=new Date(d);return Number.isNaN(out.getTime())?null:out};
const fmtDate=d=>{const date=asDate(d);return date?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric'}).format(date):'—'};
const fmtDateTime=d=>{const date=asDate(d);return date?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):'—'};
let state={orders:[],notices:[],role:'warehouse',seen:{},notificationSettings:{chat:true,replies:true,likes:true,orders:true}};
let activeFilter='all', selectedId=null, pendingDefectId=null, pendingNotificationOrderId='', pendingNotificationChat=false, chatReplyTo=null, chatUnread=false, chatFilterText='', chatFilterMode='all';
const notificationParams=new URLSearchParams(location.search);
pendingNotificationOrderId=notificationParams.get('order')||'';
pendingNotificationChat=notificationParams.get('chat')==='1';
const $=id=>document.getElementById(id), modal=$('modalBackdrop');
const savedTheme=localStorage.getItem('ampTheme')||'light';
function applyTheme(theme){
  const next=theme==='dark'?'dark':'light';
  document.body.classList.toggle('dark-theme',next==='dark');
  localStorage.setItem('ampTheme',next);
  return next;
}
applyTheme(savedTheme);

function watchNotifications(){
  notificationsUnsubscribe?.();
  if(!signedInUser)return;
  const q=query(collection(db,'users',signedInUser.uid,'notifications'),orderBy('createdAt','desc'),limit(100));
  notificationsUnsubscribe=onSnapshot(q,snap=>{
    state.notices=snap.docs.map(d=>({id:d.id,...d.data(),at:d.data().createdAt||d.data().at||isoNow()}));
    paintNotices();
  },err=>console.error('Не удалось загрузить историю уведомлений',err));
}
function watchChatBadge(){
  chatBadgeUnsubscribe?.();
  if(!signedInUser)return;
  const q=query(collection(db,'chatMessages'),orderBy('createdAt','desc'),limit(100));
  chatBadgeUnsubscribe=onSnapshot(q,snap=>{
    chatUnread=snap.docs.some(d=>{
      const m=d.data()||{};
      return m.authorId!==signedInUser.uid && Array.isArray(m.readBy) && !m.readBy.includes(signedInUser.uid);
    });
    paintChatBadge();
  },err=>console.error('Не удалось проверить непрочитанный чат',err));
}
function paintChatBadge(){$('chatSidebarButton')?.classList.toggle('has-unread-chat',chatUnread)}
async function markChatMessagesRead(messages=[]){
  if(!signedInUser)return;
  const unread=messages.filter(m=>m.authorId!==signedInUser.uid && Array.isArray(m.readBy) && !m.readBy.includes(signedInUser.uid));
  if(!unread.length){chatUnread=false;paintChatBadge();return;}
  await Promise.all(unread.map(m=>updateDoc(doc(db,'chatMessages',m.id),{readBy:arrayUnion(signedInUser.uid)}).catch(err=>console.warn('Не удалось отметить чат прочитанным',err))));
  chatUnread=false;paintChatBadge();
}
async function markNotificationItemsRead(items=[],showToast=false){
  if(!signedInUser)return {total:0,failed:0};
  const unread=items.filter(n=>n&&!n.read);
  if(!unread.length)return {total:0,failed:0};
  const results=await Promise.all(unread.map(async n=>{
    try{
      await updateDoc(doc(db,'users',signedInUser.uid,'notifications',n.id),{read:true});
      n.read=true;
      return true;
    }catch(err){
      console.warn('Не удалось отметить уведомление',n.id,err);
      return false;
    }
  }));
  const failed=results.filter(ok=>!ok).length;
  paintNotices();
  if(showToast){
    if(failed===0)toast('Все уведомления отмечены прочитанными.');
    else toast('Не удалось отметить '+failed+' уведомлен'+(failed===1?'ие':'ия')+'. Проверьте доступ и повторите попытку.');
  }
  return {total:unread.length,failed};
}
async function markNotificationsRead(){
  if(!signedInUser)return;
  const unread=state.notices.filter(n=>!n.read);
  if(!unread.length){toast('Новых уведомлений нет.');return;}
  await markNotificationItemsRead(unread,true);
}

function showAuth(message='Войдите с рабочей учётной записью.'){ $('authGate').hidden=false;document.querySelector('.app-shell').hidden=true;$('authMessage').textContent=message }
function hideAuth(){ $('authGate').hidden=true;document.querySelector('.app-shell').hidden=false }
function entryToCloud(e){
  const out={
    kind:e.kind,
    article:e.article||'',
    text:e.text||'',
    authorId:e.authorId||auth.currentUser.uid,
    authorName:e.author||profileName,
    createdAt:e.createdAt,
    photos:Array.isArray(e.photos)?e.photos.filter(p=>typeof p==='string'):[]
  };
  for(const k of ['decision','decisionText','decidedBy','decidedByName','decidedAt']){
    if(e[k]!==undefined)out[k]=e[k];
  }
  return out;
}function entryFromCloud(id,d){return{id,kind:d.kind,article:d.article||'',text:d.text||'',authorId:d.authorId,author:d.authorName||'Сотрудник',createdAt:d.createdAt,photos:d.photos||[],...Object.fromEntries(['decision','decisionText','decidedBy','decidedByName','decidedAt'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]]))}}
function orderToCloud(o,isNew=false){return{number:o.number,client:o.client||'',status:o.status,articles:Array.isArray(o.articles)?o.articles.map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1),collected:x.collected===true,shipmentChecked:x.shipmentChecked===true})).filter(x=>x.article):[],createdAt:o.createdAt,createdBy:o.createdBy||auth.currentUser.uid,createdByName:o.author||profileName,updatedAt:o.updatedAt||o.createdAt,...(!isNew&&o.updatedBy?{updatedBy:o.updatedBy,updatedByName:o.updatedByName}:{}),...(o.transferredAt?{transferredAt:o.transferredAt}:{}),...(o.resumedAt?{resumedAt:o.resumedAt}:{}),...(o.assembledAt?{assembledAt:o.assembledAt}:{}),...(o.shippedAt?{shippedAt:o.shippedAt}:{} )}}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b)}
async function writeAudit(action,details='',orderId='',meta={}){if(!signedInUser)return;try{await setDoc(doc(db,'auditLog',crypto.randomUUID()),{action:String(action||'Действие'),details:String(details||''),orderId:String(orderId||''),actorId:signedInUser.uid,actorName:profileName||roles[state.role]||'Сотрудник',actorRole:state.role,createdAt:isoNow(),...meta});}catch(err){console.warn('Аудит не записан',err);}}
async function save(){
 if(!signedInUser)return;
 try{
 const currentIds=new Set(state.orders.map(o=>o.id));
 for(const o of state.orders){
   const base=serverCache.get(o.id),newOrder=!base;
   const next=orderToCloud(o,newOrder),prev=base?orderToCloud(base):null;
   const articlesChanged=!!base&&!articlesContentEqual(base.articles||[],o.articles||[]);
   if(!base||!equal(next,prev)){
     if(base){next.updatedAt=isoNow();next.updatedBy=signedInUser.uid;next.updatedByName=profileName;o.updatedAt=next.updatedAt;o.updatedBy=next.updatedBy;o.updatedByName=profileName}
     pendingWrites.add(o.id);pendingOrderData.set(o.id,{...o,number:next.number,client:next.client,status:next.status,articles:next.articles||[]});await (newOrder?setDoc(doc(db,'orders',o.id),next):updateDoc(doc(db,'orders',o.id),next));serverCache.set(o.id,{...o,...next,entries:[...(o.entries||[])]});pendingWrites.delete(o.id);
     const articleBody=normalizeArticles(o.articles||[]).length?normalizeArticles(o.articles||[]).map(x=>`${x.article} × ${x.quantity}`).join(', '):'Все артикулы удалены.';
     const newOrderBody=newOrder?(o.articles?.length?`${o.client||'Создан новый заказ'} · ${articleBody}`:(o.client||'Создан новый заказ')):articlesChanged?articleBody:`Статус: ${next.status}`;
     await queuePush(newOrder?`Новый заказ № ${o.number}`:articlesChanged?`Артикулы заказа № ${o.number} изменены`:`Заказ № ${o.number} изменён`,newOrderBody,signedInUser.uid,o.id);
     serverCache.set(o.id,{...o,...next,articles:next.articles||[],entries:base?.entries||[]});
   }
   const oldEntries=new Map((base?.entries||[]).map(e=>[e.id,e]));
   for(const e of o.entries||[]){const cloud=entryToCloud(e),old=oldEntries.get(e.id);if(!old||!equal(cloud,entryToCloud(old))){await setDoc(doc(db,'orders',o.id,'entries',e.id),cloud);if(!newOrder&&e.kind!=='viewed'&&e.kind!=='system'){const label=e.kind==='decision'?'Решение':e.kind==='defect'?'Дефект':e.kind==='question'?'Вопрос':'Комментарий';const body=e.kind==='decision'&&e.decision?`Решение: ${e.decision}. ${e.decisionText||e.text||''}`:e.text||label;await queuePush(`Заказ № ${o.number}: ${label}`,body,signedInUser.uid,o.id)}oldEntries.delete(e.id)}else oldEntries.delete(e.id)}
   if(state.role==='director'||canManageUsers){for(const removedId of oldEntries.keys()){await deleteDoc(doc(db,'orders',o.id,'entries',removedId));await queuePush(`Заказ № ${o.number} изменён`,'Запись из истории была удалена директором.',signedInUser.uid,o.id)}}
   serverCache.set(o.id,{...(serverCache.get(o.id)||o),...o,articles:normalizeArticles(o.articles||[]),entries:[...(o.entries||[])]});
 }
 for(const [id,old] of serverCache){if(!currentIds.has(id)&&state.role==='director'){for(const e of old.entries||[])await deleteDoc(doc(db,'orders',id,'entries',e.id));await deleteDoc(doc(db,'orders',id));serverCache.delete(id)}}
 }catch(err){
  console.error('Ошибка сохранения заказа:',err);
  const code=String(err?.code||'').trim();
  const message=String(err?.message||'').trim();
  const details=code?code.replace(/^.*?\//,''):message;
  toast(details?'Не удалось сохранить: '+details:'Не удалось сохранить изменения. Проверьте доступ и соединение.');
  throw err;
}
}
async function queuePush(title,body,authorId,orderId='',target='site',category='',recipientUserId=''){
  try{
    const normalizedCategory=category||(target==='chat'?'chat':'orders');
    await setDoc(doc(db,'pushQueue',crypto.randomUUID()),{
      title:String(title||'Заказы · Склад'),
      body:String(body||'Новое изменение в заказе.'),
      authorId,
      orderId:String(orderId||''),
      target:target==='chat'?'chat':'site',
      category:normalizedCategory,
      recipientUserId:String(recipientUserId||''),
      createdAt:isoNow(),
      sentAt:null
    });
    return true;
  }catch(err){
    console.error('Push event was not queued',err);
    return false;
  }
}
async function registerNativePushToken(token,installationId='') {
  if (!signedInUser || !token) return;
  try {
    const tokenRef=doc(db,'users',signedInUser.uid,'pushTokens',encodeURIComponent(String(token)));
    await setDoc(tokenRef,{
      token:String(token),
      installationId:String(installationId||''),
      updatedAt:isoNow(),
      userAgent:navigator.userAgent,
      appId:'warehouse_orders_android',
      platform:'android'
    },{merge:true});
  } catch(err) {
    console.warn('Не удалось зарегистрировать Android push-токен',err);
  }
}
window.registerNativePushToken=registerNativePushToken;

async function syncPushToken(requestPermission=false){
  if(!('Notification' in window)||!('serviceWorker' in navigator)){
    if(requestPermission)toast('Этот браузер не поддерживает push-уведомления.');
    return;
  }

  if(!vapidKey||vapidKey.includes('ADD_WEB_PUSH')){
    if(requestPermission)toast('Push ещё не настроен: администратору нужно добавить VAPID-ключ Firebase.');
    return;
  }

  try{
    let permission=Notification.permission;

    if(permission!=='granted'){
      if(!requestPermission)return;
      permission=await Notification.requestPermission();
    }

    if(permission!=='granted'){
      if(requestPermission)toast('Разрешение на уведомления не предоставлено.');
      return;
    }

    const registration=await navigator.serviceWorker.ready;
    const token=await getToken(messaging,{
      vapidKey,
      serviceWorkerRegistration:registration
    });

    if(!token)throw new Error('FCM token unavailable');

    const storageKey='ampPushInstallationId';
    let installationId=localStorage.getItem(storageKey);

    if(!installationId){
      installationId=crypto.randomUUID();
      localStorage.setItem(storageKey,installationId);
    }

    const tokensRef=collection(db,'users',signedInUser.uid,'pushTokens');
    const existing=await getDocs(tokensRef);
    const batch=writeBatch(db);

    for(const tokenDoc of existing.docs){
      const data=tokenDoc.data()||{};

      if(
        data.userAgent===navigator.userAgent &&
        data.token!==token &&
        data.installationId!==installationId
      ){
        batch.delete(tokenDoc.ref);
      }
    }

    const tokenRef=doc(tokensRef,encodeURIComponent(token));

    batch.set(tokenRef,{
      token,
      installationId,
      updatedAt:isoNow(),
      userAgent:navigator.userAgent,
      appId:'warehouse_orders',
      platform:'web'
    },{merge:true});

    await batch.commit();

    if(requestPermission){
      toast('Push-уведомления включены на этом устройстве.');
    }
  }catch(err){
    console.error('Не удалось синхронизировать push-токен',err);

    if(requestPermission){
      toast('Не удалось включить push. Проверьте настройки Firebase и разрешения браузера.');
    }
  }
}

async function enablePush(){
  await syncPushToken(true);
}
async function showForegroundPushNotification(data={}){
  if(!('Notification' in window)||Notification.permission!=='granted'||!('serviceWorker' in navigator))return;
  try{
    const registration=await navigator.serviceWorker.ready;
    registration.active?.postMessage({
      type:'SHOW_FOREGROUND_NOTIFICATION',
      title:String(data.title||'Заказы · Склад'),
      body:String(data.body||'Новое изменение.'),
      eventId:String(data.eventId||''),
      link:String(data.link||location.href)
    });
  }catch(err){
    console.warn('Не удалось показать системное push-уведомление',err);
  }
}
const recentPushEvents=new Map();
onMessage(messaging,payload=>{
  const n=payload.data||payload.notification||{};
  const orderId=String(n.orderId||'');
  const target=String(n.target||'site');
  if(n.title){
    const message=`${n.title}${n.body?`: ${n.body}`:''}`;
    const eventId=String(n.eventId||'');
    const category=String(n.category||'');
    const signature=`${target}|${category}|${orderId}|${message}`;
    const now=Date.now();
    for(const [key,time] of recentPushEvents){if(now-time>10000)recentPushEvents.delete(key)}
    if((eventId&&recentPushEvents.has(`event:${eventId}`))||recentPushEvents.has(`msg:${signature}`))return;
    if(eventId)recentPushEvents.set(`event:${eventId}`,now);
    recentPushEvents.set(`msg:${signature}`,now);
    showForegroundPushNotification(n);
    notify(message,orderId,target,target==='chat'?'chat':'orders');
    const t=toast(message,orderId);
    if(target==='chat'&&!orderId)t.addEventListener('click',()=>openChat());
  }
});
function stopCloud(){profileUnsubscribe?.();ordersUnsubscribe?.();chatUnsubscribe?.();chatBadgeUnsubscribe?.();notificationsUnsubscribe?.();profileUnsubscribe=ordersUnsubscribe=chatUnsubscribe=chatBadgeUnsubscribe=notificationsUnsubscribe=null;for(const stop of entryUnsubscribes.values())stop();entryUnsubscribes.clear();serverCache.clear();state.orders=[]}
function watchOrders(){
 ordersUnsubscribe?.();
 ordersUnsubscribe=onSnapshot(collection(db,'orders'),snap=>{
   const oldIds=new Set(state.orders.map(o=>o.id)),remoteIds=new Set();
   for(const d of snap.docs){remoteIds.add(d.id);const data=d.data(),prior=serverCache.get(d.id),pending=pendingOrderData.get(d.id);const order={id:d.id,number:pending?.number??data.number,client:pending?.client??(data.client||''),status:pending?.status??data.status,articles:pending?.articles??(Array.isArray(data.articles)?data.articles:[]),createdAt:data.createdAt,updatedAt:data.updatedAt,transferredAt:data.transferredAt,resumedAt:data.resumedAt,assembledAt:data.assembledAt,shippedAt:data.shippedAt,author:data.createdByName||'Сотрудник',createdBy:data.createdBy,updatedBy:data.updatedBy,updatedByName:data.updatedByName,entries:prior?.entries||[]};
     const at=state.orders.findIndex(o=>o.id===d.id);if(at<0)state.orders.push(order);else state.orders[at]={...order,entries:state.orders[at].entries||[]};serverCache.set(d.id,{...order,articles:(order.articles||[]).map(x=>({...x})),entries:(prior?.entries||[]).map(x=>({...x}))});
     if(!entryUnsubscribes.has(d.id)){let firstEntries=true;entryUnsubscribes.set(d.id,onSnapshot(collection(db,'orders',d.id,'entries'),es=>{const entries=es.docs.map(x=>entryFromCloud(x.id,x.data())).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));const item=state.orders.find(o=>o.id===d.id);if(!item)return;const before=JSON.stringify(item.entries||[]);item.entries=entries;serverCache.set(d.id,{...serverCache.get(d.id),entries:entries.map(x=>({...x}))});const entriesChanged=before!==JSON.stringify(entries);
if(!initialCloudLoad&&!firstEntries&&entriesChanged){const last=entries.at(-1);if(last?.kind!=='system')toast(`Обновлён заказ № ${item.number}${last?`: ${last.author} добавил запись`:''}`);}
const wasFirstEntries=firstEntries;
firstEntries=false;
render();
// A notification can open the order before its subcollection of entries
// has arrived. Refresh the already-open card once that initial history
// snapshot is available so comments, decisions, defects and photos appear.
if(wasFirstEntries&&selectedId===d.id&&!modal.hidden&&modal.dataset.orderDetail===d.id)openOrder(d.id)}));}
     if(!initialCloudLoad&&!oldIds.has(d.id)){const message=`Поступил заказ № ${order.number}`;toast(message);notify(message,d.id)}
     if(pending && data.number===pending.number && data.client===pending.client && data.status===pending.status){pendingOrderData.delete(d.id);}
   }
   for(const o of [...state.orders])if(!remoteIds.has(o.id)&&!pendingWrites.has(o.id)){state.orders=state.orders.filter(x=>x.id!==o.id);entryUnsubscribes.get(o.id)?.();entryUnsubscribes.delete(o.id);serverCache.delete(o.id)}
   initialCloudLoad=false;render();if(pendingNotificationOrderId){const target=pendingNotificationOrderId;pendingNotificationOrderId='';history.replaceState({},'',location.pathname+location.hash);if(state.orders.some(o=>o.id===target))openOrder(target);}
 },err=>{console.error(err);toast('Не удалось загрузить общую историю. Проверьте доступ к Firestore.')});
}
onAuthStateChanged(auth,user=>{
 stopCloud();signedInUser=user;initialCloudLoad=true;
 if(!user){function saveUiState(){
  try{
    sessionStorage.setItem('warehouseUiState',JSON.stringify({
      scrollX:window.scrollX||0,
      scrollY:window.scrollY||0,
      activeFilter,
      search:$('searchInput')?.value||'',
      dateFrom:$('dateFromFilter')?.value||'',dateTo:$('dateToFilter')?.value||''
    }));
  }catch{}
}
function restoreUiState(){
  try{
    const raw=sessionStorage.getItem('warehouseUiState');
    if(!raw)return;
    const saved=JSON.parse(raw);
    if(saved.activeFilter)activeFilter=saved.activeFilter;
    if($('searchInput')&&typeof saved.search==='string')$('searchInput').value=saved.search;
    if($('dateFromFilter')&&typeof saved.dateFrom==='string')$('dateFromFilter').value=saved.dateFrom;if($('dateToFilter')&&typeof saved.dateTo==='string')$('dateToFilter').value=saved.dateTo;
    render();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      window.scrollTo(Number(saved.scrollX)||0,Number(saved.scrollY)||0);
    }));
  }catch{}
}
let lastUiSave=0;
window.addEventListener('scroll',()=>{
  const now=Date.now();
  if(now-lastUiSave<150)return;
  lastUiSave=now;
  saveUiState();
},{passive:true});
window.addEventListener('pagehide',saveUiState);
window.addEventListener('beforeunload',saveUiState);
window.addEventListener('pageshow',e=>{
  if(e.persisted)requestAnimationFrame(restoreUiState);
});

showAuth();return}
 showAuth('Проверяем доступ…');
 profileUnsubscribe=onSnapshot(doc(db,'users',user.uid),snap=>{
   if(!snap.exists()){showAuth('Учётная запись создана, но профиль не найден. Обратитесь к администратору.');$('authError').textContent=`UID: ${user.uid}`;return}
   const profile=snap.data();if(profile.active!==true||!roles[profile.role]){showAuth('Доступ отключён или роль не назначена. Обратитесь к администратору.');return}
   state.role=profile.role;canManageUsers=profile.admin===true||profile.role==='director';profileName=profile.displayName||user.email||roles[profile.role];state.notificationSettings={chat:profile.notificationSettings?.chat!==false,replies:profile.notificationSettings?.replies!==false,likes:profile.notificationSettings?.likes!==false,orders:profile.notificationSettings?.orders!==false};$('userName').textContent=profileName;$('userRole').textContent=canManageUsers?`Администратор · ${roles[profile.role]}`:roles[profile.role];hideAuth();watchOrders();watchNotifications();watchChatBadge();render();syncPushToken(false);if(window.AndroidWarehouse?.requestNativePushToken){window.AndroidWarehouse.requestNativePushToken();}if(pendingNotificationChat){pendingNotificationChat=false;history.replaceState({},'',location.pathname+location.hash);setTimeout(()=>openChat(),0);}
 },err=>{console.error(err);showAuth('Не удалось проверить профиль сотрудника. Проверьте правила доступа Firestore.')});
});
 $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('authError').textContent='';try{await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value)}catch(err){$('authError').textContent=err.code==='auth/invalid-credential'?'Неверная почта или пароль.':err.code==='auth/too-many-requests'?'Слишком много попыток. Попробуйте позже.':'Не удалось войти. Проверьте почту и пароль.'}});
 $('googleLoginButton').addEventListener('click',async()=>{ $('authError').textContent='';try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(err){console.error(err);$('authError').textContent=err.code==='auth/popup-closed-by-user'?'Окно входа закрыто.':'Не удалось войти через Google.'}});
function initials(name){return String(name).split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}
function notify(){paintNotices()}
function statusClass(s){return({'Собран':'status-assembled','Отгружен кладовщиком':'status-shipped','Ожидает оплаты':'status-payment','Под вопросом':'status-question','Дефект':'status-question','На согласовании':'status-approval','Одобрен на отгрузку клиенту':'status-ready','Ожидает самовывоза':'status-pickup-waiting','Клиент забрал самовывозом':'status-pickup-done','Самовывоз':'status-pickup-waiting','Перенесен':'status-transferred','Отменён':'status-cancel'})[s]||'status-neutral'}
function statusPill(s){return `<span class="status-pill ${statusClass(s)}">${esc(s)}</span>`}
function entriesCount(o){return(o.entries||[]).length}
const statOrderConfig={
  'Собран':{title:'Собранные заказы',hint:'Заказы со статусом «Собран»'},
  'Создан':{title:'Созданные заказы',hint:'Заказы со статусом «Создан»'},
  attention:{title:'Заказы требуют внимания',hint:'Заказы с вопросами и дефектами'},
  'На согласовании':{title:'Заказы на согласовании',hint:'Ожидают решения менеджера'},
  'Одобрен на отгрузку клиенту':{title:'Одобренные к отгрузке',hint:'Можно отгружать клиенту'},
  'Ожидает оплаты':{title:'Ожидающие оплаты',hint:'Оплата ещё не получена'},
  'Ожидает самовывоза':{title:'Ожидающие самовывоза',hint:'Клиент должен забрать заказ'},
  'Перенесен':{title:'Перенесённые заказы',hint:'Висят сверху списка независимо от даты'}
};
function statOrderMatches(o,key){
  if(key==='attention')return o.status==='Под вопросом'||o.status==='Дефект';
  return o.status===key;
}
function openStatOrders(key){
  const config=statOrderConfig[key];
  if(!config)return;
  const orders=state.orders.filter(o=>statOrderMatches(o,key)).sort((a,b)=>{
    const aTransferred=a.status==='Перенесен',bTransferred=b.status==='Перенесен';
    if(aTransferred!==bTransferred)return aTransferred?-1:1;
    return new Date(orderDisplayDate(b)||0)-new Date(orderDisplayDate(a)||0);
  });
  const rows=orders.map(o=>{
    const articleCount=Array.isArray(o.articles)?o.articles.length:0;
    return `<button type="button" class="stat-order-item" data-open="${esc(o.id)}">
      <span class="stat-order-main">
        <b>№ ${esc(o.number)}</b>
        <span>${esc(o.client||'Без клиента')}</span>
      </span>
      <span class="stat-order-meta">
        ${statusPill(o.status)}
        <small>${fmtDateTime(orderDisplayDate(o))} · ${articleCount} ${plural(articleCount,'позиция','позиции','позиций')}</small>
      </span>
    </button>`;
  }).join('');
  const body=orders.length
    ? `<p class="stat-modal-hint">${esc(config.hint)} · найдено: <b>${orders.length}</b></p><div class="stat-order-list">${rows}</div>`
    : `<div class="danger-note">Сейчас здесь нет заказов.</div>`;
  showModal(config.title,body,[button('Закрыть','close')],'СПИСОК ЗАКАЗОВ');
}
function localDateKey(value){const d=asDate(value);if(!d)return '';return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function orderDisplayDate(o){if(o?.status==='Отгружен кладовщиком')return o.shippedAt||o.updatedAt||o.resumedAt||o.createdAt;if(o?.status==='Собран')return o.assembledAt||o.createdAt;return o?.status==='Перенесен'?(o.transferredAt||o.updatedAt||o.createdAt):(o?.resumedAt||o?.createdAt)}
function isDateInRange(o,dateFrom,dateTo){if(o?.status==='Перенесен')return true;const day=localDateKey(orderDisplayDate(o));if(dateFrom&&day<dateFrom)return false;if(dateTo&&day>dateTo)return false;return true}
function formatDuration(ms){
  if(!Number.isFinite(ms)||ms<0)return '—';
  const mins=Math.round(ms/60000);
  if(mins<60)return mins+' мин';
  const hours=Math.floor(mins/60),rest=mins%60;
  if(hours<24)return hours+' ч'+(rest?' '+rest+' мин':'');
  const days=Math.floor(hours/24),h=hours%24;
  return days+' д'+(h?' '+h+' ч':'');
}
function showWarehouseAnalytics(){
  const now=Date.now(),todayKey=localDateKey(new Date()),weekStart=new Date();weekStart.setDate(weekStart.getDate()-6);
  const orders=state.orders.filter(Boolean);
  const today=orders.filter(o=>localDateKey(orderDisplayDate(o))===todayKey);
  const week=orders.filter(o=>{const d=asDate(orderDisplayDate(o));return d&&d>=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate());});
  const assembled=orders.filter(o=>o.assembledAt);
  const shipped=orders.filter(o=>o.shippedAt);
  const cycle=assembled.map(o=>{const a=asDate(o.createdAt),b=asDate(o.assembledAt);return a&&b?b-a:null}).filter(Number.isFinite);
  const shipmentCycle=shipped.map(o=>{const a=asDate(o.createdAt),b=asDate(o.shippedAt);return a&&b?b-a:null}).filter(Number.isFinite);
  const stuck=orders.filter(o=>['Создан','На согласовании','Ожидает оплаты','Ожидает самовывоза','Перенесен'].includes(o.status));
  const byStatus=new Map();
  orders.forEach(o=>byStatus.set(o.status,(byStatus.get(o.status)||0)+1));
  const statusRows=[...byStatus.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([s,n])=>'<div class="analytics-status-row"><span>'+statusPill(s)+'</span><b>'+n+'</b></div>').join('');
  const body='<div class="analytics-grid">'+
    '<div class="analytics-kpi"><span>Заказов сегодня</span><b>'+today.length+'</b><small>за текущую дату</small></div>'+
    '<div class="analytics-kpi"><span>Заказов за 7 дней</span><b>'+week.length+'</b><small>по дате обработки</small></div>'+
    '<div class="analytics-kpi"><span>Средняя сборка</span><b>'+formatDuration(cycle.reduce((a,b)=>a+b,0)/(cycle.length||1))+'</b><small>'+cycle.length+' завершённых</small></div>'+
    '<div class="analytics-kpi"><span>Средняя отгрузка</span><b>'+formatDuration(shipmentCycle.reduce((a,b)=>a+b,0)/(shipmentCycle.length||1))+'</b><small>'+shipmentCycle.length+' отгруженных</small></div>'+
    '</div>'+
    '<div class="analytics-columns"><section class="analytics-panel"><h3>Статусы сейчас</h3>'+
    (statusRows||'<div class="danger-note">Нет данных.</div>')+
    '</section><section class="analytics-panel"><h3>Где сейчас застряли</h3>'+
    '<div class="analytics-highlight"><b>'+stuck.length+'</b><span>заказов требуют ожидания или дальнейшего действия</span></div>'+
    '<div class="analytics-highlight"><b>'+orders.filter(o=>o.status==='Под вопросом'||o.status==='Дефект').length+'</b><span>заказов с вопросами или дефектами</span></div>'+
    '<div class="analytics-highlight"><b>'+orders.filter(o=>o.status==='Перенесен').length+'</b><span>перенесённых заказов</span></div>'+
    '</section></div>';
  showModal('Статистика работы склада',body,[button('Закрыть','close')],'АНАЛИТИКА');
}
function renderWorkInsights(){
  const box=$('workInsights');if(!box)return;
  const now=Date.now(),items=[];
  const add=(tone,title,text,orderId='')=>items.push({tone,title,text,orderId});
  const transferred=state.orders.filter(o=>o.status==='Перенесен');
  const defects=state.orders.filter(o=>o.status==='Под вопросом'||o.status==='Дефект');
  const approval=state.orders.filter(o=>o.status==='На согласовании');
  const oldCreated=state.orders.filter(o=>o.status==='Создан'&&now-(asDate(o.createdAt)?.getTime()||now)>24*60*60*1000);
  transferred.slice(0,2).forEach(o=>add('violet','Перенесённый заказ № '+o.number,'Проверьте, не пора ли вернуть его в работу.',o.id));
  defects.slice(0,2).forEach(o=>add('red','Нужна проверка заказа № '+o.number,'Есть вопрос или нерассмотренный дефект.',o.id));
  approval.slice(0,2).forEach(o=>add('amber','Ждёт согласования № '+o.number,'Заказ ожидает решения менеджера.',o.id));
  oldCreated.slice(0,2).forEach(o=>add('blue','Заказ № '+o.number+' задержался','Статус «Создан» держится больше суток.',o.id));
  if(!items.length){box.hidden=true;box.innerHTML='';return;}
  box.hidden=false;
  box.innerHTML='<div class="insights-head"><div><b>🧠 Требует внимания</b><span>Автоматические подсказки по текущим заказам</span></div><button type="button" class="insights-count">'+items.length+'</button></div><div class="insights-list">'+items.slice(0,6).map(x=>'<button type="button" class="insight-item insight-'+x.tone+'" '+(x.orderId?'data-open="'+esc(x.orderId)+'"':'')+'><span class="insight-dot"></span><span><b>'+esc(x.title)+'</b><small>'+esc(x.text)+'</small></span><span class="insight-arrow">›</span></button>').join('')+'</div>';
}
function notificationTone(n){
  const cat=n.category||(n.target==='chat'?'chat':'orders');
  return cat==='chat'?'blue':cat==='replies'?'violet':cat==='likes'?'pink':'green';
}
function render(){const search=$('searchInput').value.toLocaleLowerCase('ru');const dateFrom=$('dateFromFilter')?.value||'';const dateTo=$('dateToFilter')?.value||'';let orders=[...state.orders].sort((a,b)=>{const aTransferred=a.status==='Перенесен',bTransferred=b.status==='Перенесен';if(aTransferred!==bTransferred)return aTransferred?-1:1;return new Date(orderDisplayDate(b)||0)-new Date(orderDisplayDate(a)||0)});if(activeFilter!=='all')orders=orders.filter(o=>o.status===activeFilter);if(search)orders=orders.filter(o=>{const basic=(o.number+' '+o.client).toLocaleLowerCase('ru');const articles=(Array.isArray(o.articles)?o.articles:[]).map(x=>String(x?.article||x||'').toLocaleLowerCase('ru')).join(' ');return basic.includes(search)||articles.includes(search)});if(dateFrom||dateTo)orders=orders.filter(o=>isDateInRange(o,dateFrom,dateTo));const hasDateFilter=!!(dateFrom||dateTo);$('clearDateButton').hidden=!hasDateFilter;let previousDate='';const rows=[];for(const o of orders){const displayDate=orderDisplayDate(o);const day=localDateKey(displayDate);if(day!==previousDate){rows.push(`<tr class="date-separator"><td colspan="6"><span>${esc(fmtDate(displayDate))}</span></td></tr>`);previousDate=day}rows.push(`<tr data-order="${esc(o.id)}"><td><a class="order-number" href="#" data-open="${esc(o.id)}">№ ${esc(o.number)}</a><span class="client-sub">создал ${esc(o.author||'Кладовщик')}</span></td><td><a class="client-name client-open" href="#" data-open="${esc(o.id)}">${esc(o.client)}</a><span class="client-sub">${fmtDateTime(displayDate)}</span></td><td><button type="button" class="row-open-status" data-open="${esc(o.id)}" title="Открыть заказ">${statusPill(o.status)}</button></td><td><button type="button" class="row-open-comments" data-open="${esc(o.id)}" title="Открыть заказ"><span class="comment-icon">💬</span><span class="entry-count">${entriesCount(o)}</span></button></td><td class="time-cell">${fmtDate(displayDate)}</td><td><button class="row-menu" title="Открыть карточку" data-open="${esc(o.id)}">···</button></td></tr>`)}$('ordersBody').innerHTML=rows.join('');const empty=orders.length===0;$('emptyState').classList.toggle('visible',empty);$('ordersBody').style.display=empty?'none':'';$('statTotal').textContent=state.orders.filter(o=>o.status==='Собран').length;$('statCreated').textContent=state.orders.filter(o=>o.status==='Создан').length;$('statQuestions').textContent=state.orders.filter(o=>o.status==='Под вопросом').length;$('statApproval').textContent=state.orders.filter(o=>o.status==='На согласовании').length;$('statReady').textContent=state.orders.filter(o=>o.status==='Одобрен на отгрузку клиенту').length;$('statPayment').textContent=state.orders.filter(o=>o.status==='Ожидает оплаты').length;$('statPickup').textContent=state.orders.filter(o=>o.status==='Ожидает самовывоза').length;$('statTransferred').textContent=state.orders.filter(o=>o.status==='Перенесен').length;$('listSummary').textContent=`${orders.length} ${plural(orders.length,'заказ','заказа','заказов')}`;$('userName').textContent=profileName||roles[state.role];$('userRole').textContent=canManageUsers?`Администратор · ${roles[state.role]}`:roles[state.role];$('modeLabel').textContent='Вы онлайн';$('modeSub').textContent='Подключено к облаку';$('today').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'long'}).format(new Date());document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.filter===activeFilter));paintNotices();renderWorkInsights()}
function plural(n,a,b,c){n=Math.abs(n)%100;const d=n%10;return n>10&&n<20?c:d>1&&d<5?b:d===1?a:c}
function toast(msg,orderId=''){const t=document.createElement('div');t.className='toast'+(orderId?' toast-clickable':'');t.textContent=msg;if(orderId)t.addEventListener('click',()=>{t.remove();openOrder(orderId)});$('toastStack').append(t);setTimeout(()=>t.remove(),3500);return t}
let modalHistoryEntry=false;
function showModal(title,body,buttons=[],eyebrow='КАРТОЧКА ЗАКАЗА'){
  const wasOpen=!modal.hidden;
  $('modalTitle').textContent=title;
  $('modalEyebrow').textContent=eyebrow;
  $('modalBody').innerHTML=body;
  $('modalFoot').innerHTML=buttons.join('');
  modal.hidden=false;
  document.body.style.overflow='hidden';
  // Every modal gets one browser-history entry. Opening another modal while
  // one is already open keeps the same entry, so Back still closes the UI.
  if(!wasOpen&&!modalHistoryEntry){
    history.pushState({modal:true},'',location.href);
    modalHistoryEntry=true;
  }
}
function closeModal(fromPop=false){
  chatUnsubscribe?.();
  chatUnsubscribe=null;
  if(modal.hidden)return;
  modal.hidden=true;
  document.body.style.overflow='';
  if(modalHistoryEntry){
    modalHistoryEntry=false;
    if(!fromPop)history.back();
  }
}
function button(label,action,cls='small-button'){return `<button class="${cls}" data-action="${action}">${label}</button>`}
function articleRowHtml(item={article:'',quantity:1,collected:false}){return `<div class="order-article-row"><input class="order-article-input" value="${esc(item.article||'')}" placeholder="Артикул" autocomplete="off"><input class="order-article-qty" type="number" min="1" step="1" value="${Math.max(1,Number(item.quantity)||1)}" aria-label="Количество"><button type="button" class="small-button danger article-remove" data-action="remove-order-article" title="Удалить">×</button></div>`}
function articlesEditorHtml(items=[]){return `<div class="article-editor" id="orderArticlesEditor"><div class="article-editor-head"><span>Артикул</span><span>Количество</span><span></span></div><div id="orderArticlesRows">${items.map(articleRowHtml).join('')}</div><button type="button" class="secondary-button article-add" data-action="add-order-article">＋ Добавить артикул</button></div>`}
function readArticles(){return [...document.querySelectorAll('#orderArticlesRows .order-article-row')].map(row=>({article:row.querySelector('.order-article-input')?.value.trim()||'',quantity:Math.max(1,Number(row.querySelector('.order-article-qty')?.value)||1)})).filter(x=>x.article)}
function normalizeArticles(items=[]){return items.map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1),collected:x.collected===true,shipmentChecked:x.shipmentChecked===true})).filter(x=>x.article)}
const hasPendingDefect=o=>Array.isArray(o?.entries)&&o.entries.some(e=>e.kind==='defect'&&!e.decision);
function articlesEqual(a=[],b=[]){return JSON.stringify(normalizeArticles(a).map(x=>({article:x.article,quantity:x.quantity})))===JSON.stringify(normalizeArticles(b).map(x=>({article:x.article,quantity:x.quantity})))}
function articlesContentEqual(a=[],b=[]){return JSON.stringify((a||[]).map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1)})).filter(x=>x.article))===JSON.stringify((b||[]).map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1)})).filter(x=>x.article))}
function openNewOrder(){if(!['warehouse','manager','chief_accountant','accountant'].includes(state.role)&&!canManageUsers){toast('Создавать карточки может только кладовщик, менеджер или администратор.');return}
const managerCreate=isManagerRole()&&!canManageUsers;
const statusOptions=managerCreate?'<option>Создан</option><option>Под вопросом</option>':'<option>Собран</option><option>Создан</option><option>Под вопросом</option>';
const statusHint=managerCreate?'Менеджер создаёт заказ со статусом «Создан». Кладовщик позже отметит его как «Собран».':'Можно сразу отметить заказ как «Собран», если он уже собран.';
showModal('Добавить заказ',`<form id="newOrderForm"><div class="form-grid"><div class="field"><label for="orderNumber">Номер заказа *</label><input id="orderNumber" required placeholder="Например, ЗК-18472" autocomplete="off"></div><div class="field"><label for="clientName">Имя клиента *</label><input id="clientName" required placeholder="Имя или название компании"></div></div><div class="field"><label>Артикулы заказа</label>${articlesEditorHtml([{article:'',quantity:1}])}<span class="field-hint">Для каждого артикула укажите количество. Можно добавлять и удалять позиции.</span></div><div class="field"><label for="startStatus">Начальный статус</label><select id="startStatus">${statusOptions}</select><span class="field-hint">${statusHint}</span></div><div class="field"><label for="initialComment">Комментарий (необязательно)</label><textarea id="initialComment" placeholder="Короткая заметка по заказу"></textarea></div></form>`,[button('Отмена','close'),button('Создать карточку','create-order','primary-button')],'НОВЫЙ ЗАКАЗ')}
function openOrder(id){const o=state.orders.find(x=>x.id===id);if(!o)return;selectedId=id;const isManager=isManagerRole()||canManageUsers,isDirector=state.role==='director',hasOpenDefect=hasPendingDefect(o),shipmentLocked=isShipmentLocked(o);let actions=button('＋ Добавить комментарий','add-comment','small-button primary-soft');if(!hasOpenDefect&&!shipmentLocked){actions+=button('⚠ Дефект','add-defect','small-button danger');actions+=button('✎ Редактировать данные','edit-order-info','small-button primary-soft');actions+=button('✎ Редактировать артикулы','edit-articles','small-button primary-soft');actions+=button('📦 Кладовщик','open-warehouse-actions','small-button action-category warehouse-category');actions+=button('📋 Менеджер','open-manager-actions','small-button action-category manager-category');if(canManageUsers)actions+=button('🗑 Удалить карточку','delete-order','small-button danger');}else if(shipmentLocked){actions+='<div class="danger-note">🔒 После статуса «Отгружен кладовщиком» менеджер, бухгалтер и главный бухгалтер больше не могут редактировать, отменять или удалять заказ.</div>';}else{actions='<div class="danger-note">⚠ В заказе есть нерассмотренный дефект. Редактирование и смена статуса заблокированы до вынесения решения. Комментарии по дефекту разрешены.</div>'}let articlesHtml=`<div class="detail-section-title">Артикулы заказа · ${(o.articles||[]).length}</div>${(o.articles||[]).length?`<div class="order-articles-list">${o.articles.map((x,i)=>`<div class="order-article-view ${x.collected?'article-collected':''}"><span class="article-main"><b>${esc(x.article)}</b><small>${x.collected?'Собрано':'Не собрано'}</small></span><span style="display:flex;align-items:center;gap:8px"><span>${Number(x.quantity)||1} шт.</span>${(!shipmentLocked&&(state.role==='warehouse'||isManagerRole()||canManageUsers))?button(x.collected?'✓ Собрано':'☐ Собрано','toggle-collected:'+i,'small-button '+(x.collected?'good':'primary-soft')):`<span class="article-collected-state">${x.collected?'✓ Собрано':'☐ Не собрано'}</span>`}<button type="button" class="small-button primary-soft" data-action="show-on-map" data-map-article="${esc(String(x.article||''))}">🗺️ На карте</button></span></div>`).join('')}</div>`:'<div class="danger-note">Артикулы не указаны.</div>'}`;let entries=(o.entries||[]).map(e=>{const decisionLabel=e.decision==='Подтверждён'?'Подтверждено':e.decision==='Отменён'?'Отменено':'Ожидает решения';const decidedBy=e.decidedByName||e.decidedBy||'';return `<article class="timeline-item"><div class="timeline-top"><span><b>${esc(e.author)}</b> · ${fmtDateTime(e.createdAt)}</span><span style="display:flex;align-items:center;gap:7px"><span class="timeline-type">${esc(({defect:'ДЕФЕКТ',question:'ВОПРОС',decision:'РЕШЕНИЕ',comment:'КОММЕНТАРИЙ',viewed:'ПРОСМОТРЕНО',system:'СИСТЕМА'})[e.kind]||'ЗАПИСЬ')}</span>${isDirector?`<button class="row-menu" title="Удалить запись (директор)" data-action="delete-entry:${e.id}">×</button>`:''}</span></div>${e.article?`<div class="timeline-article">Артикул: ${esc(e.article)}</div>`:''}<div class="timeline-text">${esc(e.text)}</div>${e.photos?.length?`<div class="photo-grid">${e.photos.map(p=>`<img src="${p}" alt="Фото к записи" data-photo="${p}">`).join('')}</div>`:''}${e.kind==='defect'?(e.decision?`<div class="decision-row"><span>Решение по дефекту: <b>${esc(decisionLabel)}</b>${decidedBy?`<br>Решение вынес: <b>${esc(decidedBy)}</b>`:''}${e.decidedAt?`<br>${fmtDateTime(e.decidedAt)}`:''}${e.decisionText?`<br>${esc(e.decisionText)}`:''}</span></div>`:(isManager?`<div class="decision-row"><span>Решение по дефекту: <b>ожидает ответа</b></span><span class="decision-actions">${button('Подтвердить','defect-confirm:'+e.id,'small-button good')}${button('Отменить','defect-cancel:'+e.id,'small-button danger')}</span></div>`:'')):''}</article>`}).join('');const reviewed=(o.entries||[]).some(e=>e.kind==='viewed');let badge=reviewed?'<span class="status-pill status-neutral">Просмотрен менеджером</span>':'';showModal(`Заказ № ${o.number}`,`<div class="order-detail-head"><div><div class="detail-number">${esc(o.client)}</div><div class="detail-client">Заказ № ${esc(o.number)}</div><div class="detail-meta"><div>Создан: ${fmtDateTime(o.createdAt)}</div>${o.transferredAt?`<div>Перенесен: ${fmtDateTime(o.transferredAt)}</div>`:""}${o.assembledAt?`<div>Собран: ${fmtDateTime(o.assembledAt)}</div>`:""}${o.shippedAt?`<div>Отгружен: ${fmtDateTime(o.shippedAt)}</div>`:""}<div>${esc(o.author||"Кладовщик")}</div><div class="detail-history-mini">${(o.entries||[]).slice(-3).reverse().map(e=>esc(e.author||'Сотрудник')+' · '+fmtDateTime(e.createdAt)+' · '+esc(e.text||'Действие')).join('<br>')}</div></div></div><div>${statusPill(o.status)}<div style="margin-top:6px">${badge}</div></div></div><div class="detail-actions">${actions}</div>${articlesHtml}<div class="detail-section-title">История · ${entriesCount(o)} ${plural(entriesCount(o),'запись','записи','записей')}</div><div class="timeline">${entries||'<div class="danger-note">Записей пока нет. Добавьте комментарий или описание дефекта.</div>'}</div>`,[button('Закрыть','close')],'КАРТОЧКА ЗАКАЗА');modal.dataset.orderDetail=id}

function openOrderActionCategory(category){const o=state.orders.find(x=>x.id===selectedId);if(o&&hasPendingDefect(o)){toast('Пока дефект не рассмотрен, другие действия с заказом недоступны.');return;}const isManager=isManagerRole()||canManageUsers;const warehouseActions=[button('Отгружен кладовщиком','set-status:Отгружен кладовщиком','small-button shipped'),button('Под вопросом','set-status:Под вопросом','small-button'),button('Ожидает самовывоза','set-status:Ожидает самовывоза','small-button'),button('Клиент забрал самовывозом','set-status:Клиент забрал самовывозом','small-button')];const managerActions=[button('Создан','set-status:Создан','small-button'),button('На согласовании','set-status:На согласовании','small-button'),button('Одобрен на отгрузку клиенту','set-status:Одобрен на отгрузку клиенту','small-button'),button('Перенесен','set-status:Перенесен','small-button'),button('Отменён','set-status:Отменён','small-button'),button('Ожидает оплаты','set-status:Ожидает оплаты','small-button payment-status')];if(isManager)managerActions.push(button('✓ Отметить просмотренным','mark-seen','small-button primary-soft'));const title=category==='warehouse'?'Действия кладовщика':'Действия менеджера';const list=category==='warehouse'?warehouseActions:managerActions;showModal(title,`<div class="order-action-menu"><div class="order-action-menu-hint">${category==='warehouse'?'Статусы сборки и выдачи заказа.':'Статусы согласования и работы менеджера.'}</div><div class="order-action-menu-list">${list.join('')}</div></div>`,[button('Назад к заказу','back-detail')],category==='warehouse'?'КЛАДОВЩИК':'МЕНЕДЖЕР')}
function editOrderInfo(){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}if(hasPendingDefect(o)){toast('Редактирование заблокировано до решения по дефекту.');return;}showModal('Редактировать данные заказа',`<form id="editOrderInfoForm"><div class="field"><label for="editOrderNumber">Номер заказа *</label><input id="editOrderNumber" required autocomplete="off" value="${esc(o.number)}"></div><div class="field"><label for="editClientName">Имя клиента *</label><input id="editClientName" required autocomplete="off" value="${esc(o.client)}"></div><span class="field-hint">Изменения сохранятся в карточке заказа и будут видны всем сотрудникам.</span></form>`,[button('Назад','back-detail'),button('Сохранить изменения','save-order-info','primary-button')],'ДАННЫЕ ЗАКАЗА')}
async function saveOrderInfo(){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(hasPendingDefect(o)){toast('Редактирование заблокировано до решения по дефекту.');return;}const number=$("editOrderNumber").value.trim(),client=$("editClientName").value.trim();if(!number||!client){toast('Укажите номер заказа и имя клиента.');return}const duplicate=state.orders.find(x=>x.id!==o.id&&String(x.number).trim().toLowerCase()===number.toLowerCase());if(duplicate){toast('Карточка с таким номером уже существует.');return}const oldNumber=o.number,oldClient=o.client;o.number=number;o.client=client;o.entries.push({id:crypto.randomUUID(),kind:'system',text:`Данные заказа изменены: ${oldNumber} → ${number}; клиент: ${oldClient} → ${client}`,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:isoNow(),photos:[]});await save();closeModal();render();toast('Данные заказа сохранены.');notify('Данные заказа изменены',o.id);openOrder(o.id)}
function editArticles(){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}if(hasPendingDefect(o)){toast('Редактирование заблокировано до решения по дефекту.');return;}showModal(`Артикулы заказа № ${o.number}`,`<div class="field"><label>Состав заказа</label>${articlesEditorHtml(o.articles||[])}<span class="field-hint">Добавляйте новые позиции, меняйте количество или удаляйте ненужные.</span></div>`,[button('Назад','back-detail'),button('Сохранить артикулы','save-articles','primary-button')],'СОСТАВ ЗАКАЗА')}
async function toggleArticleCollected(index){
  const o=state.orders.find(x=>x.id===selectedId);
  if(!o||!(state.role==='warehouse'||isManagerRole()||canManageUsers)||hasPendingDefect(o)||!Number.isInteger(index))return;
  const item=o.articles?.[index];
  if(!item)return;

  const previousCollected=item.collected===true;
  const previousStatus=o.status;
  const previousAssembledAt=o.assembledAt;

  item.collected=!previousCollected;

  const articles=Array.isArray(o.articles)?o.articles.filter(x=>String(x?.article||'').trim()):[];
  const allCollected=articles.length>0&&articles.every(x=>x.collected===true);

  if(allCollected){
    o.status='Собран';
    o.assembledAt=isoNow();
  }else if(previousStatus==='Собран'){
    o.status='Создан';
  }

  try{
    await save();
    render();
    openOrder(o.id);
  }catch(err){
    item.collected=previousCollected;
    o.status=previousStatus;
    o.assembledAt=previousAssembledAt;
    console.error('Не удалось изменить отметку сборки',err);
    toast('Не удалось изменить отметку сборки.');
  }
}
async function saveArticles(){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}if(hasPendingDefect(o)){toast('Редактирование заблокировано до решения по дефекту.');return;}const next=normalizeArticles(readArticles());
const previous=normalizeArticles(o.articles||[]);if(articlesEqual(previous,next)){backDetail();return}o.articles=next;o.entries.push({id:crypto.randomUUID(),kind:'system',text:`Состав заказа изменён: ${next.length?next.map(x=>`${x.article} × ${x.quantity}`).join(', '):'артикулы удалены'}`,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:isoNow(),photos:[]});await save();closeModal();render();toast('Артикулы заказа сохранены.');notify(`Артикулы заказа № ${o.number} изменены`,o.id);openOrder(o.id)}
function addComment(){showModal('Добавить комментарий',`<form id="entryForm"><div class="field"><label for="entryText">Сообщение *</label><textarea id="entryText" required placeholder="Напишите комментарий"></textarea></div><div class="field"><label for="entryPhotos">Фото (необязательно)</label><div class="upload-box">Прикрепить фотографии<input id="entryPhotos" type="file" accept="image/*" multiple></div><span class="field-hint">Можно отправить обычный текст без артикула и фотографий.</span></div></form>`,[button('Назад','back-detail'),button('Отправить','save-entry','primary-button')],'КОММЕНТАРИЙ');$('entryKind')?.remove()}
function addDefect(){const o=state.orders.find(x=>x.id===selectedId);if(o&&!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}if(o&&hasPendingDefect(o)){toast('У заказа уже есть нерассмотренный дефект.');return;}showModal('Добавить дефект',`<form id="entryForm"><input id="entryKind" type="hidden" value="defect"><div class="field"><label for="article">Артикул детали *</label><input id="article" placeholder="Например, APVW0802" autocomplete="off"></div><div class="field"><label for="entryText">Описание дефекта *</label><textarea id="entryText" required placeholder="Опишите, что не так с деталью"></textarea></div><div class="field"><label for="entryPhotos">Фото дефекта (необязательно)</label><div class="upload-box">Прикрепить фотографии<input id="entryPhotos" type="file" accept="image/*" multiple></div><span class="field-hint">Фото помогут менеджеру оценить дефект.</span></div></form>`,[button('Назад','back-detail'),button('Добавить дефект','save-entry','primary-button')],'ДЕФЕКТ ДЕТАЛИ')}
async function saveOrder(){const n=$('orderNumber').value.trim(),client=$('clientName').value.trim();if(!n||!client){toast('Укажите номер заказа и имя клиента.');return}if(state.orders.some(o=>o.number.toLowerCase()===n.toLowerCase())){toast('Карточка с таким номером уже есть.');return}const articles=readArticles();const status=$('startStatus').value,comment=$('initialComment').value.trim();const o={id:crypto.randomUUID(),number:n,client,status,articles,createdAt:isoNow(),author:profileName||roles[state.role],createdBy:signedInUser.uid,entries:[]};if(comment)o.entries.push({id:crypto.randomUUID(),kind:'comment',text:comment,author:profileName||roles[state.role],createdAt:isoNow(),photos:[]});state.orders.unshift(o);await save();closeModal();render();toast('Карточка заказа создана.');notify(`Создан заказ № ${n}`,o.id)}
async function readPhotos(files){
  if(files.length>5)throw new Error('К одной записи можно прикрепить не более пяти фото.');

  const out=[];

  for(const file of [...files]){
    if(!file.type.startsWith('image/'))
      throw new Error('Можно прикреплять только изображения.');

    const image=await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const img=new Image();

      img.onload=()=>{
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror=()=>{
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось открыть фото'));
      };

      img.src=url;
    });

    const scale=Math.min(1,1600/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');

    canvas.width=Math.round(image.width*scale);
    canvas.height=Math.round(image.height*scale);

    canvas.getContext('2d').drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const blob=await new Promise(resolve=>{
      canvas.toBlob(resolve,'image/jpeg',.78);
    });

    if(!blob)
      throw new Error('Не удалось подготовить фото.');

    out.push(blob);
  }

  return out;
}
async function uploadPhotos(orderId,entryId,blobs){
  const urls=[];

  for(let i=0;i<blobs.length;i++){
    const path=`orders/${orderId}/${entryId}/photo-${i+1}-${crypto.randomUUID()}.jpg`;
    const fileRef=storageRef(storage,path);

    await uploadBytes(fileRef,blobs[i],{
      contentType:'image/jpeg'
    });

    urls.push(await getDownloadURL(fileRef));
  }

  return urls;
}
async function saveEntry(){const kind=$('entryKind')?.value||'comment',text=$('entryText').value.trim(),article=$('article')?.value.trim()||'';if(!text){toast('Напишите сообщение.');return}if(kind==='defect'&&!article){toast('Для дефекта укажите артикул детали.');return}
const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(kind!=='comment'&&!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}if(hasPendingDefect(o)&&kind!=='comment'){toast('Пока дефект не рассмотрен, можно добавлять только комментарии.');return}try{const photoBlobs=await readPhotos($('entryPhotos').files);
const entryId=crypto.randomUUID();
const photos=await uploadPhotos(o.id,entryId,photoBlobs);
o.entries.push({id:entryId,kind,article:kind==='defect'?article:'',text,author:profileName||roles[state.role],createdAt:isoNow(),photos});if(kind==='defect')o.status='Дефект';await save();await writeAudit(kind==='defect'?'Добавлен дефект':'Добавлен комментарий',text,o.id,{entryId});closeModal();render();toast('Запись добавлена в историю заказа.');notify(`${kind==='defect'?'Дефект':'Комментарий'} к заказу № ${o.number}`,o.id);openOrder(o.id)}catch(e){toast(e.message)}}
async function setStatus(status,text,kind='system'){const o=state.orders.find(x=>x.id===selectedId);if(!o||!signedInUser)return;if(!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}if(hasPendingDefect(o)){toast('Пока есть нерассмотренный дефект, другие изменения заказа заблокированы.');return;}const previous=o.status;const previousTransferredAt=o.transferredAt;const previousResumedAt=o.resumedAt;const previousAssembledAt=o.assembledAt;const previousShippedAt=o.shippedAt;const now=isoNow();const entry={id:crypto.randomUUID(),kind,text,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:now,photos:[]};const statusUpdate={status,updatedAt:now,updatedBy:signedInUser.uid,updatedByName:profileName||roles[state.role]};if(status==='Собран'){o.assembledAt=now;statusUpdate.assembledAt=now;}if(status==='Отгружен кладовщиком'){o.shippedAt=now;statusUpdate.shippedAt=now;}if(status==='Перенесен'){o.transferredAt=now;}if(previous==='Перенесен'&&status!=='Перенесен'){o.resumedAt=now;statusUpdate.resumedAt=now;}try{o.status=status;await updateDoc(doc(db,'orders',o.id),statusUpdate);await setDoc(doc(db,'orders',o.id,'entries',entry.id),entryToCloud(entry));o.entries.push(entry);serverCache.set(o.id,{...serverCache.get(o.id),...o});await writeAudit('Изменён статус заказа',text,o.id,{previousStatus:previous,newStatus:status});await queuePush(`Заказ № ${o.number}: ${status}`,text,signedInUser.uid,o.id);render();notify(`Заказ № ${o.number}: ${status}`,o.id);openOrder(o.id)}catch(err){o.status=previous;o.transferredAt=previousTransferredAt;o.resumedAt=previousResumedAt;o.assembledAt=previousAssembledAt;o.shippedAt=previousShippedAt;console.error('Ошибка изменения статуса заказа',err);toast('Не удалось изменить статус: '+(err?.message||'нет доступа'));}}
function cancelOrder(){const o=state.orders.find(x=>x.id===selectedId);if(o&&!canEditOrder(o)){toast('После отгрузки заказ нельзя отменить этой ролью.');return;}showModal('Отменить заказ',`<p style="font-size:12px;color:#697382;margin:0 0 14px">Укажите причину отмены заказа № ${esc(o.number)}. Причина сохранится в истории.</p><div class="field"><label for="cancelReason">Причина отмены *</label><textarea id="cancelReason" required placeholder="Почему заказ отменён?"></textarea></div>`,[button('Назад','back-detail'),button('Отменить заказ','confirm-cancel','small-button danger')],'РЕШЕНИЕ МЕНЕДЖЕРА')}
function approveOrder(){showModal('Одобрить на отгрузку',`<p style="font-size:12px;color:#697382;margin:0 0 12px">Заказ № ${esc(state.orders.find(x=>x.id===selectedId)?.number||'')} будет отмечен как одобренный к отгрузке клиенту.</p><div class="field"><label for="approvalComment">Комментарий менеджера (необязательно)</label><textarea id="approvalComment" placeholder="Добавьте пояснение для кладовщика"></textarea></div>`,[button('Назад','back-detail'),button('Одобрить','confirm-approve','small-button good')],'РЕШЕНИЕ МЕНЕДЖЕРА')}
function confirmApprove(){const note=$('approvalComment').value.trim()||'Согласовано к отгрузке клиенту.';setStatus('Одобрен на отгрузку клиенту',note,'decision')}
function confirmCancel(){const reason=$('cancelReason').value.trim();if(!reason){toast('Напишите причину отмены.');return}setStatus('Отменён',reason,'decision')}
function markViewed(){const o=state.orders.find(x=>x.id===selectedId);if(o.entries.some(e=>e.kind==='viewed'&&e.authorId===signedInUser.uid)){toast('Вы уже отмечали этот заказ просмотренным.');return}o.entries.push({id:crypto.randomUUID(),kind:'viewed',text:`${profileName||roles[state.role]} отметил(а), что увидел(а) собранный заказ.`,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:isoNow(),photos:[]});save();render();notify(`Менеджер ${profileName||''} просмотрел заказ № ${o.number}`,o.id);openOrder(o.id)}
function decideDefect(entryId,decision){const o=state.orders.find(x=>x.id===selectedId),e=o?.entries.find(x=>x.id===entryId);if(!o||!e||e.kind!=='defect'||e.decision||!(isManagerRole()||canManageUsers)){toast('Этот дефект уже рассмотрен или у вас нет прав на решение.');return}if(decision==='Отменён'){showModal('Отменить заказ',`<p style="font-size:12px;color:#697382;margin:0 0 12px">Напишите причину отмены заказа № ${esc(o.number)} по дефекту артикула ${esc(e.article)}.</p><div class="field"><label for="defectReason">Причина отмены *</label><textarea id="defectReason" required placeholder="Почему заказ отменён?"></textarea></div>`,[button('Назад','back-detail'),button('Отменить заказ','confirm-defect-cancel','small-button danger')],'ОТМЕНА ЗАКАЗА');return}e.decision='Подтверждён';e.decisionText=`Дефект подтверждён сотрудником ${profileName||roles[state.role]}.`;e.decidedBy=profileName||roles[state.role];e.decidedByName=profileName||roles[state.role];e.decidedAt=isoNow();const defects=o.entries.filter(x=>x.kind==='defect');if(defects.every(x=>x.decision==='Подтверждён'))o.status='Одобрен на отгрузку клиенту';save();render();notify(`Дефект артикула ${e.article} по заказу № ${o.number} подтверждён${o.status==='Одобрен на отгрузку клиенту'?' — заказ одобрен к отгрузке':''}`,o.id);openOrder(o.id)}
function confirmDefectCancel(){const reason=$('defectReason').value.trim();if(!reason){toast('Укажите причину решения.');return}const o=state.orders.find(x=>x.id===selectedId),e=o.entries.find(x=>x.id===pendingDefectId);if(!e)return;e.decision='Отменён';e.decisionText=reason;e.decidedBy=profileName||roles[state.role];e.decidedByName=profileName||roles[state.role];e.decidedAt=isoNow();o.status='Отменён';pendingDefectId=null;save();render();notify(`Заказ № ${o.number} отменён по дефекту артикула ${e.article}: ${reason}`,o.id);toast('Кладовщик получит уведомление об отмене заказа.');openOrder(o.id)}
function deleteOrder(){if(!canManageUsers)return;const current=state.orders.find(x=>x.id===selectedId);if(current&&hasPendingDefect(current)){toast('Нельзя удалить заказ, пока не рассмотрен дефект.');return;}const o=state.orders.find(x=>x.id===selectedId);if(!o)return;showModal('Удалить карточку?',`<div class="danger-note">Заказ № ${esc(o.number)} и его записи сначала сохранятся в отдельной истории удалённых заказов, а затем исчезнут из общего списка.</div>`,[button('Назад','back-detail'),button('Удалить карточку','confirm-delete','small-button danger')],'УДАЛЕНИЕ ЗАКАЗА')}
function deleteEntry(entryId){const o=state.orders.find(x=>x.id===selectedId),entry=o.entries.find(x=>x.id===entryId);if(!entry||state.role!=='director')return;showModal('Удалить запись?',`<div class="danger-note">Комментарий и прикреплённые к нему фото будут удалены. Действие попадёт в журнал директора.</div>`,[button('Назад','back-detail'),button('Удалить запись','confirm-delete-entry:'+entryId,'small-button danger')],'ДЕЙСТВИЕ ДИРЕКТОРА')}
function confirmDeleteEntry(entryId){const o=state.orders.find(x=>x.id===selectedId),entry=o.entries.find(x=>x.id===entryId);if(!entry)return;const label=entry.article?`дефект артикула ${entry.article}`:({comment:'комментарий',question:'вопрос',decision:'решение',viewed:'отметку о просмотре'})[entry.kind]||'запись';o.entries=o.entries.filter(x=>x.id!==entryId);state.notices.unshift({id:crypto.randomUUID(),message:`Директор удалил ${label} из заказа № ${o.number}`,orderId:null,at:isoNow(),read:false,kind:'audit'});save();render();toast('Удаление внесено в журнал действий.');openOrder(o.id)}
async function confirmDelete(){if(!canManageUsers)return;const o=state.orders.find(x=>x.id===selectedId);if(!o)return;let archived=false;try{const sourceRef=doc(db,'orders',o.id),sourceSnap=await getDoc(sourceRef);if(!sourceSnap.exists()){toast('Заказ уже удалён или недоступен.');return}const sourceEntries=await getDocs(collection(db,'orders',o.id,'entries')),archiveRef=doc(db,'deletedOrders',o.id),archiveSnap=await getDoc(archiveRef);if(!archiveSnap.exists()||archiveSnap.data().complete!==true){if(!archiveSnap.exists()){const data=sourceSnap.data();await setDoc(archiveRef,{sourceOrderId:o.id,number:data.number||o.number,client:data.client||o.client||'',status:data.status||o.status,createdAt:data.createdAt||o.createdAt,createdBy:data.createdBy||'',createdByName:data.createdByName||o.author||'',entriesCount:sourceEntries.size,deletedAt:isoNow(),deletedBy:signedInUser.uid,deletedByName:profileName,deletedByEmail:signedInUser.email||'',complete:false})}for(let i=0;i<sourceEntries.docs.length;i+=450){const batch=writeBatch(db);for(const entrySnap of sourceEntries.docs.slice(i,i+450)){const entry=entryFromCloud(entrySnap.id,entrySnap.data());batch.set(doc(db,'deletedOrders',o.id,'entries',entrySnap.id),entryToCloud(entry))}await batch.commit()}await updateDoc(archiveRef,{complete:true})}archived=true;for(let i=0;i<sourceEntries.docs.length;i+=450){const batch=writeBatch(db);for(const entrySnap of sourceEntries.docs.slice(i,i+450))batch.delete(entrySnap.ref);await batch.commit()}await writeAudit('Удалён заказ',`Заказ № ${o.number}; статус: ${o.status}`,o.id);await queuePush(`Заказ № ${o.number} удалён`,`Заказ удалён администратором ${profileName || 'сотрудником'}.`,signedInUser.uid,o.id);await deleteDoc(sourceRef);entryUnsubscribes.get(o.id)?.();entryUnsubscribes.delete(o.id);serverCache.delete(o.id);state.orders=state.orders.filter(x=>x.id!==o.id);state.notices.unshift({id:crypto.randomUUID(),message:`Администратор ${profileName} удалил заказ № ${o.number}`,orderId:null,at:isoNow(),read:false,kind:'audit'});closeModal();render();toast('Заказ удалён и сохранён в истории.')}catch(err){console.error('Не удалось удалить заказ с архивированием',err);toast(archived?'Заказ сохранён в истории, но оригинал удалить не удалось. Повторите операцию позже.':'Не удалось заархивировать заказ. Оригинал сохранён. Проверьте правила Firestore и повторите попытку.')}}
async function showDeletedOrders(){if(!canManageUsers)return;try{const snap=await getDocs(collection(db,'deletedOrders')),archives=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.complete===true).sort((a,b)=>String(b.deletedAt||'').localeCompare(String(a.deletedAt||'')));const rows=archives.map(a=>`<div class="notice-item"><b>Заказ № ${esc(a.number||'—')} · ${esc(a.client||'без клиента')}</b><small>${esc(a.status||'')} · удалил ${esc(a.deletedByName||a.deletedByEmail||'администратор')} · ${fmtDateTime(a.deletedAt)} · записей: ${Number(a.entriesCount)||0}</small>${button('Открыть историю','view-deleted-order:'+esc(a.id),'small-button primary-soft')}</div>`).join('');showModal('История удалённых заказов',`<div class="notice-list">${rows||'<div class="danger-note">Удалённых заказов пока нет.</div>'}</div>`,[button('Назад','back-profile'),button('Закрыть','close')],'АРХИВ');}catch(err){console.error('Не удалось загрузить архив заказов',err);toast('Не удалось загрузить историю. Проверьте опубликованные правила Firestore.')}}
async function showDeletedOrder(id){if(!canManageUsers)return;try{const archiveSnap=await getDoc(doc(db,'deletedOrders',id));if(!archiveSnap.exists()||archiveSnap.data().complete!==true){toast('Запись истории не найдена.');showDeletedOrders();return}const a=archiveSnap.data(),entriesSnap=await getDocs(collection(db,'deletedOrders',id,'entries')),entries=entriesSnap.docs.map(d=>({id:d.id,...entryFromCloud(d.id,d.data())})).sort((x,y)=>new Date(x.createdAt)-new Date(y.createdAt)),timeline=entries.map(e=>`<article class="timeline-item"><div class="timeline-top"><span><b>${esc(e.author||'Сотрудник')}</b> · ${fmtDateTime(e.createdAt)}</span><span class="timeline-type">${esc(({defect:'ДЕФЕКТ',question:'ВОПРОС',decision:'РЕШЕНИЕ',comment:'КОММЕНТАРИЙ',viewed:'ПРОСМОТРЕНО',system:'СИСТЕМА'})[e.kind]||'ЗАПИСЬ')}</span></div>${e.article?`<div class="timeline-article">Артикул: ${esc(e.article)}</div>`:''}<div class="timeline-text">${esc(e.text||'')}</div>${e.photos?.length?`<div class="photo-grid">${e.photos.map(p=>`<img src="${esc(p)}" alt="Фото из удалённого заказа" data-photo="${esc(p)}">`).join('')}</div>`:''}</article>`).join('');showModal(`Архив · заказ № ${a.number||'—'}`,`<div class="order-detail-head"><div><div class="detail-number">${esc(a.client||'')}</div><div class="detail-meta">Создан ${fmtDateTime(a.createdAt)} · удалил ${esc(a.deletedByName||a.deletedByEmail||'администратор')} · ${fmtDateTime(a.deletedAt)}</div></div><div>${statusPill(a.status||'Удалён')}</div></div><div class="timeline">${timeline||'<div class="danger-note">У заказа не было записей.</div>'}</div>`,[button('Назад к архиву','deleted-orders'),button('Закрыть','close')],'ИСТОРИЯ УДАЛЁННЫХ ЗАКАЗОВ')}catch(err){console.error('Не удалось открыть архивный заказ',err);toast('Не удалось открыть заказ из истории.')}}
function paintNotices(){const unread=state.notices.some(n=>!n.read&&state.notificationSettings[n.category||(n.target==='chat'?'chat':'orders')]!==false);$('notificationButton').classList.toggle('has-notice',unread);paintChatBadge()}
async function disablePush(){try{if(!signedInUser)throw new Error('User is not signed in');const installationId=localStorage.getItem('ampPushInstallationId');const tokensRef=collection(db,'users',signedInUser.uid,'pushTokens');const snap=await getDocs(tokensRef);const batch=writeBatch(db);for(const tokenDoc of snap.docs){const data=tokenDoc.data()||{};if(installationId&&data.installationId===installationId)batch.delete(tokenDoc.ref)}await batch.commit();await deleteToken(messaging).catch(()=>{});toast('Push-уведомления выключены на этом устройстве.')}catch(err){console.error('Не удалось выключить push',err);toast('Не удалось выключить уведомления. Попробуйте ещё раз.')}}
async function toggleNotificationSetting(category){if(!signedInUser||!['chat','replies','likes','orders'].includes(category))return;const next=state.notificationSettings[category]===false;try{state.notificationSettings[category]=next;await updateDoc(doc(db,'users',signedInUser.uid),{notificationSettings:state.notificationSettings});toast(next?'Уведомления включены.':'Уведомления выключены.');showNotifications()}catch(err){console.error('Не удалось изменить настройку уведомлений',err);state.notificationSettings[category]=!next;toast('Не удалось сохранить настройку уведомлений.')}}

let chatMessages=[];

function startChatReply(messageId){
  const message=chatMessages.find(m=>m.id===messageId);
  if(!message)return;
  chatReplyTo=message;
  const preview=$('chatReplyPreview');
  if(preview){
    preview.innerHTML='<div><b>Ответ для '+esc(message.authorName||'Сотрудника')+'</b><span>'+esc(message.text||'📷 Фото')+'</span></div><button type="button" class="chat-reply-cancel" data-action="cancel-chat-reply">×</button>';
    preview.hidden=false;
  }
  $('chatInput')?.focus();
}

function cancelChatReply(){
  chatReplyTo=null;
  const preview=$('chatReplyPreview');
  if(preview){preview.hidden=true;preview.innerHTML='';}
}

function chatMentionToken(name){
  return String(name||'').trim().split(/\s+/)[0].replace(/[^\p{L}\p{N}_-]/gu,'');
}
function renderChatText(text){
  let out=esc(text||'');
  out=out.replace(/(^|[\s])(@[\p{L}\p{N}_-]{2,})/gu,'$1<span class="chat-mention">$2</span>');
  return out;
}
function chatMentionSuggestions(){
  const input=$('chatInput'), list=$('chatMentionSuggestions');
  if(!input||!list)return;
  const value=input.value.slice(0,input.selectionStart??input.value.length);
  const match=value.match(/(?:^|[\s])@([\p{L}\p{N}_-]*)$/u);
  if(!match){list.hidden=true;list.innerHTML='';return;}
  const needle=match[1].toLocaleLowerCase('ru');
  const people=[...new Map(chatMessages.filter(m=>m.authorId&&m.authorName).map(m=>[m.authorId,{id:m.authorId,name:m.authorName}])).values()]
    .filter(p=>p.id!==signedInUser?.uid)
    .filter(p=>chatMentionToken(p.name).toLocaleLowerCase('ru').startsWith(needle))
    .slice(0,6);
  if(!people.length){list.hidden=true;list.innerHTML='';return;}
  list.innerHTML=people.map(p=>'<button type="button" data-chat-mention="'+esc(chatMentionToken(p.name))+'">@'+esc(chatMentionToken(p.name))+' <small>'+esc(p.name)+'</small></button>').join('');
  list.hidden=false;
}
function insertChatMention(token){
  const input=$('chatInput');
  if(!input)return;
  const start=input.selectionStart??input.value.length;
  const before=input.value.slice(0,start).replace(/@[\p{L}\p{N}_-]*$/u,'@'+token);
  input.value=before+input.value.slice(start);
  const pos=before.length;
  input.setSelectionRange(pos,pos);
  input.focus();
  chatMentionSuggestions();
}
async function toggleChatLike(messageId){
  if(!signedInUser||!messageId)return;
  const message=chatMessages.find(m=>m.id===messageId);
  if(!message)return;
  const likes=Array.isArray(message.likes)?message.likes:[];
  const liked=likes.includes(signedInUser.uid);
  try{
    await updateDoc(doc(db,'chatMessages',messageId),{likes:liked?arrayRemove(signedInUser.uid):arrayUnion(signedInUser.uid)});
    if(!liked&&message.authorId&&message.authorId!==signedInUser.uid){
      await queuePush('Вам поставили лайк',profileName+' понравилось ваше сообщение: '+((message.text||'📷 Фото').slice(0,160)),signedInUser.uid,'','chat','likes',message.authorId);
    }
  }catch(err){
    console.error('Не удалось изменить реакцию',err);
    toast('Не удалось поставить реакцию.');
  }
}
function renderChatMessages(){
  const box=$('chatMessages');
  if(!box)return;
  const queryText=chatFilterText.toLocaleLowerCase('ru');
  const visibleMessages=chatMessages.filter(m=>{
    const hay=(String(m.authorName||'')+' '+String(m.text||'')+' '+String(m.replyToText||'')).toLocaleLowerCase('ru');
    if(queryText&&!hay.includes(queryText))return false;
    if(chatFilterMode==='mine'&&m.authorId!==signedInUser?.uid)return false;
    if(chatFilterMode==='photos'&&!(Array.isArray(m.photos)&&m.photos.length))return false;
    if(chatFilterMode==='replies'&&!m.replyToId)return false;
    return true;
  });
  if(!visibleMessages.length){
    box.innerHTML='<div class="chat-empty">Пока никто ничего не написал. Будьте первым 🙂</div>';
  }else{
    box.innerHTML=visibleMessages.map(m=>{
      const mine=m.authorId===signedInUser?.uid;
      const photos=Array.isArray(m.photos)?m.photos:[];
      const likes=Array.isArray(m.likes)?m.likes:[];
      const liked=likes.includes(signedInUser?.uid);
      const photoHtml=photos.length?'<div class="chat-photo-grid">'+photos.map(p=>'<a href="'+esc(p)+'" target="_blank" rel="noopener"><img src="'+esc(p)+'" alt="Фото из общего чата" loading="lazy"></a>').join('')+'</div>':'';
      const replyHtml=m.replyToId?'<div class="chat-reply-quote"><b>Ответ на '+esc(m.replyToAuthorName||'сообщение')+'</b><span>'+esc(m.replyToText||'📷 Фото')+'</span></div>':'';
      const likeHtml='<button type="button" class="chat-like-button '+(liked?'active':'')+'" data-action="toggle-chat-like:'+esc(m.id)+'" aria-label="Нравится">👍 <span>'+likes.length+'</span></button>'; const readBy=Array.isArray(m.readBy)?m.readBy:[]; const receipt=mine?'<span class="chat-read-receipt" title="'+(readBy.some(id=>id!==signedInUser?.uid)?'Прочитано':'Отправлено')+'">'+(readBy.some(id=>id!==signedInUser?.uid)?'✓✓':'✓')+'</span>':'';
      return '<article class="chat-message '+(mine?'mine':'')+'"><div class="chat-message-head"><b>'+esc(m.authorName||'Сотрудник')+'</b><time>'+esc(fmtDateTime(m.createdAt))+'</time></div>'+replyHtml+'<div class="chat-message-text">'+renderChatText(m.text)+'</div>'+photoHtml+'<div class="chat-message-actions">'+likeHtml+'<button type="button" class="chat-reply-button" data-action="reply-chat:'+esc(m.id)+'">↩ Ответить</button>'+receipt+'</div></article>';
    }).join('');
    box.scrollTop=box.scrollHeight;
  }
}

function sendChatMessage(){ $('chatForm')?.requestSubmit(); }
function openChat(){
  if(!signedInUser)return;
  chatUnsubscribe?.();
  chatMessages=[];chatReplyTo=null;
  showModal('Общий чат','<div class="chat-shell"><div class="chat-toolbar"><label class="search-box"><span>⌕</span><input id="chatSearch" type="search" placeholder="Поиск по чату"></label><select id="chatFilter"><option value="all">Все сообщения</option><option value="mine">Мои</option><option value="replies">С ответами</option><option value="photos">С фото</option></select></div><div class="chat-messages" id="chatMessages"><div class="chat-empty">Загрузка сообщений…</div></div><form id="chatForm" class="chat-form"><div id="chatReplyPreview" class="chat-reply-preview" hidden></div><div class="chat-input-wrap"><textarea id="chatInput" maxlength="1000" rows="2" placeholder="Напишите сообщение… Используйте @ для упоминания" autocomplete="off" required></textarea><div id="chatMentionSuggestions" class="chat-mention-suggestions" hidden></div></div><div class="chat-attach-row"><label class="chat-attach-button">📎 Фото<input id="chatPhotoInput" type="file" accept="image/*" multiple hidden></label><span id="chatPhotoHint">До 5 фото, по 8 МБ</span></div><div id="chatUploadProgress" class="chat-upload-progress" hidden><div class="chat-upload-progress-track"><div id="chatUploadProgressBar" class="chat-upload-progress-bar"></div></div><span id="chatUploadProgressText">Загрузка…</span></div><div id="chatPhotoPreview" class="chat-photo-preview"></div></form></div>',[button('Закрыть','close'),button('Отправить','send-chat','primary-button')],'ОБЩИЙ ЧАТ');
  const chatQuery=query(collection(db,'chatMessages'),orderBy('createdAt','desc'),limit(100));
  chatUnsubscribe=onSnapshot(chatQuery,snap=>{
    chatMessages=snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.text||Array.isArray(m.photos)&&m.photos.length).sort((x,y)=>{const tx=x.createdAt?.toMillis?x.createdAt.toMillis():new Date(x.createdAt||0).getTime();const ty=y.createdAt?.toMillis?y.createdAt.toMillis():new Date(y.createdAt||0).getTime();return tx-ty||String(x.id).localeCompare(String(y.id));});
    renderChatMessages();
    markChatMessagesRead(chatMessages);
  },err=>{
    console.error('Не удалось загрузить общий чат',err);
    const box=$('chatMessages');
    if(box)box.innerHTML='<div class="danger-note">Не удалось загрузить сообщения.<br><small>Скорее всего, правила Firestore ещё не опубликованы.</small></div>';
    toast('Чат не имеет доступа к Firestore. Опубликуйте firestore.rules.');
  });
  $('chatInput').addEventListener('input',chatMentionSuggestions);$('chatSearch')?.addEventListener('input',e=>{chatFilterText=e.target.value||'';renderChatMessages();});$('chatFilter')?.addEventListener('change',e=>{chatFilterMode=e.target.value||'all';renderChatMessages();});
  $('chatInput').addEventListener('keyup',chatMentionSuggestions);
  $('chatForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const input=$('chatInput');
    const text=input.value.trim();
    const photoInput=$('chatPhotoInput');
    const files=Array.from(photoInput?.files||[]).slice(0,5);
    if(!text&&!files.length||!signedInUser)return;
    if(files.some(file=>!file.type.startsWith('image/')||file.size>8*1024*1024)){toast('Фото должны быть изображениями до 8 МБ каждое.');return}
    input.disabled=true;
    if(photoInput)photoInput.disabled=true;
    const sendButton=document.querySelector('[data-action="send-chat"]');
    const attachButton=document.querySelector('.chat-attach-button');
    const progressWrap=$('chatUploadProgress');
    const progressBar=$('chatUploadProgressBar');
    const progressText=$('chatUploadProgressText');
    if(sendButton)sendButton.disabled=true;
    if(attachButton)attachButton.classList.add('disabled');
    if(progressWrap)progressWrap.hidden=false;
    if(progressBar)progressBar.style.width='0%';
    if(progressText)progressText.textContent=files.length?'Подготовка загрузки…':'Отправка…';
    try{
      const createdAt=serverTimestamp();
      const photos=[];
      const totalBytes=files.reduce((sum,file)=>sum+file.size,0);
      let uploadedBytes=0;
      for(const file of files){
        const path=`chat/${signedInUser.uid}/${Date.now()}-${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        const photoRef=storageRef(storage,path);
        await new Promise((resolve,reject)=>{
          const task=uploadBytesResumable(photoRef,file,{contentType:file.type});
          task.on('state_changed',snap=>{
            const current=totalBytes?Math.min(100,((uploadedBytes+snap.bytesTransferred)/totalBytes)*100):0;
            if(progressBar)progressBar.style.width=current.toFixed(1)+'%';
            if(progressText)progressText.textContent=`Загрузка фото… ${Math.round(current)}%`;
          },reject,async()=>{
            uploadedBytes+=file.size;
            photos.push(await getDownloadURL(photoRef));
            resolve();
          });
        });
      }
      if(progressBar)progressBar.style.width='100%';
      if(progressText)progressText.textContent='Отправка сообщения…';
      await setDoc(doc(db,'chatMessages',crypto.randomUUID()),{
        text:text.slice(0,1000),
        authorId:signedInUser.uid,
        authorName:profileName,
        createdAt,
        photos,
        likes:[],
        readBy:[signedInUser.uid],
        ...(chatReplyTo?{replyToId:chatReplyTo.id,replyToAuthorId:chatReplyTo.authorId,replyToAuthorName:chatReplyTo.authorName||'Сотрудник',replyToText:(chatReplyTo.text||'📷 Фото').slice(0,300)}:{})
      });
      if(chatReplyTo){await queuePush('Ответ в общем чате',profileName+': '+(text?text.slice(0,160):'📷 Фото'),signedInUser.uid,'','chat','replies',chatReplyTo.authorId);}else{await queuePush('Общий чат',profileName+': '+(text?text.slice(0,160):'📷 Фото'),signedInUser.uid,'','chat','chat');}
      const mentionedTokens=[...text.matchAll(/(^|[\s])@([\p{L}\p{N}_-]{2,})/gu)].map(x=>x[2].toLocaleLowerCase('ru'));
      const mentionedUsers=[...new Map(chatMessages.map(m=>[m.authorId,{id:m.authorId,name:m.authorName}])).values()]
        .filter(p=>p.id&&p.id!==signedInUser.uid&&mentionedTokens.includes(chatMentionToken(p.name).toLocaleLowerCase('ru')));
      for(const person of mentionedUsers){
        await queuePush('Вас упомянули в общем чате',profileName+': '+(text?text.slice(0,160):'📷 Фото'),signedInUser.uid,'','chat','replies',person.id);
      }
      input.value='';
      cancelChatReply();
      if(photoInput){photoInput.value='';photoInput.disabled=false;}
      const preview=$('chatPhotoPreview');if(preview)preview.innerHTML='';
      input.focus();
    }catch(err){
      console.error('Не удалось отправить сообщение в чат',err);
      toast(err?.code==='permission-denied'?'Нет доступа к chatMessages. Сначала опубликуйте firestore.rules.':'Не удалось отправить сообщение.');
    }finally{
      input.disabled=false;
      if(photoInput)photoInput.disabled=false;
      if(sendButton)sendButton.disabled=false;
      if(attachButton)attachButton.classList.remove('disabled');
      if(progressWrap){progressWrap.hidden=true;progressBar.style.width='0%';}
    }
  });
  $('chatPhotoInput').addEventListener('change',e=>{const files=Array.from(e.target.files||[]).slice(0,5);const preview=$('chatPhotoPreview');if(!preview)return;preview.innerHTML=files.map(file=>{const url=URL.createObjectURL(file);return `<span><img src="${url}" alt="Предпросмотр"><b>${esc(file.name)}</b></span>`}).join('');});
  $('chatInput').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){
      e.preventDefault();
      $('chatForm')?.requestSubmit();
    }
  });
  setTimeout(()=>$('chatInput')?.focus(),50);
}

const SHIPMENT_CATEGORY_IDS=['Амортизатор','Бампер','Втулка','Датчик','Дверь','Зеркало','Капот','Клапан','Крыло','Крышка','Молдинг','Накладка','Наконечник','Насос','Опора','Подкрылок','Поршень','Прокладка','Прочее','Пружина','Радиатор','Решётка','Ролик','Сайлентблок','Спойлер','Стекло','Тормозные колодки','Тяга','Фара','Фонарь'];
const SHIPMENT_CATEGORY_DATA='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';
let shipmentCategoryMap=null;
let shipmentCategoryPromise=null;

async function loadShipmentCategoryMap(){
  if(shipmentCategoryMap) return shipmentCategoryMap;
  if(shipmentCategoryPromise) return shipmentCategoryPromise;
  shipmentCategoryPromise=(async()=>{
    try{
      const bytes=Uint8Array.from(atob(SHIPMENT_CATEGORY_DATA),c=>c.charCodeAt(0));
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const json=JSON.parse(await new Response(stream).text());

      // В карте категорий хранится чистый артикул, а в заказах он иногда
      // приходит вместе с описанием: "APCT0101C КРЫЛО ЛЕВОЕ CITROEN...".
      // Нормализуем ключи, чтобы категория находилась независимо от регистра.
      shipmentCategoryMap=Object.fromEntries(
        Object.entries(json).map(([article,id])=>[
          String(article||'').trim().split(/\s+/)[0].toUpperCase(),
          SHIPMENT_CATEGORY_IDS[id]||'Прочее'
        ])
      );
    }catch(err){
      console.warn('Не удалось загрузить категории склада',err);
      shipmentCategoryMap={};
    }
    return shipmentCategoryMap;
  })();
  return shipmentCategoryPromise;
}

function shipmentArticleKey(article){
  return String(article||'').trim().split(/\s+/)[0].toUpperCase();
}
function shipmentTextCategory(article){
  const s=String(article||'').toLocaleLowerCase('ru').replace(/[()_,;:/\\-]+/g,' ').replace(/\s+/g,' ').trim();
  const has=(...p)=>p.some(x=>x.test(s));
  if(has(/крыл[оі]\s+(лів|лев)/,/\b(лів|лев)\w*\s+крыл/))return 'Левое крыло';
  if(has(/крыл[оі]\s+(прав|пра)\w*/,/\b(прав|пра)\w*\s+крыл/))return 'Правое крыло';
  if(/\bкапот\b/.test(s))return 'Капот';
  if(/реш[іи]тк\w*.*бампер|реш[её]тк\w*.*бампер/.test(s))return 'Решётка бампера';
  if(/реш[іи]тк\w*.*радіатор|реш[её]тк\w*.*радиатор/.test(s))return 'Решётка радиатора';
  if(/\bмолдинг\b|\bмолд[іi]нг\b/.test(s))return 'Молдинг';
  if(/підкрил|подкрыл/.test(s))return 'Подкрылок';
  if(/дзеркал|зеркал/.test(s))return 'Зеркало';
  if(/\bфара\b|противотуманн.*фара|протитуманн.*фара/.test(s))return 'Фара';
  if(/ліхтар|фонар/.test(s))return 'Фонарь';
  if(/скло.*фар|стекл.*фар/.test(s))return 'Стекло фары';
  if(has(/бампер.*перед/,/перед.*бампер/))return 'Передний бампер';
  if(has(/бампер.*зад/,/зад.*бампер/))return 'Задний бампер';
  if(/\bбампер\b/.test(s))return 'Бампер';
  if(/абсорбер.*бампер|поглинач.*бампер/.test(s))return 'Абсорбер бампера';
  if(/підсил.*бампер|усилит.*бампер/.test(s))return 'Усилитель бампера';
  if(/панел\w*/.test(s))return 'Панель';
  if(/накладк\w*.*бампер|спойлер.*бампер/.test(s))return 'Накладка/спойлер бампера';
  if(/\bспойлер\b/.test(s))return 'Спойлер';
  if(/кронштейн.*бампер|креплен.*бампер|кронштейн/.test(s))return 'Крепление/кронштейн';
  if(/заглушк.*бампер|заглушк.*буксир/.test(s))return 'Заглушка';
  if(/двер[ьи]|дверн\w*/.test(s))return 'Дверь';
  if(/багажник|кришк.*багаж|крышк.*багаж/.test(s))return 'Крышка багажника';
  if(/порог/.test(s))return 'Порог';
  if(/\bарка\b/.test(s))return 'Арка';
  if(/стекл\w*.*(лобов|боков|задн)|скло.*(лобов|боков|задн)/.test(s))return 'Стекло';
  if(/світлоповертач|светоотражател|відбивач|отражател|указател.*поворот|вказівник.*поворот/.test(s))return 'Свет/сигнализация';
  if(/провод|датчик|сенсор|ламп|блок\s+керув|блок\s+управ|моторчик|электр|електр/.test(s))return 'Электрика';
  if(/фільтр|филтр|фильтр/.test(s))return 'Фильтр';
  if(/радіатор\s+охолод|радиатор\s+охлаж|конденсатор\s+кондиц|інтеркулер|интеркулер|вентилятор\s+радіатора|вентилятор\s+радиатора/.test(s))return 'Охлаждение/кондиционер';
  if(/термостат|помпа|водян\w*\s+насос|водяной\s+насос/.test(s))return 'Охлаждение/кондиционер';
  if(/гальм|тормоз|суппорт|колодк|диск.*торм|диск.*гальм|гальмівн.*шланг|тормозн.*шланг/.test(s))return 'Тормоза';
  if(/рульов|рулев|наконечник.*тяги|тяга.*руль|рейка\s+руль|кермов/.test(s))return 'Рулевое';
  if(/амортизатор|стійк.*стабіліз|стойк.*стабилиз|стабілізатор|стабилизатор|пружин|важіл|важіль|рычаг|кульов|шаров.*опор|шарова\s+опора|втулк.*важел|опора\s+амортиз|підшипник\s+опори|підшипник.*ступиц|ступиц|сайлент|сайлентблок|відбійник\s+амортиз|отбойник\s+амортиз|пильовик\s+амортиз|пыльник\s+амортиз/.test(s))return 'Подвеска';
  if(/поршень|поршн|кільц\w*\s+порш|кольц\w*\s+порш|прокладк.*двиг|прокладк.*голов|головк.*блок|клапан|масл\w*\s+насос|цепь\s+грм|ремень\s+грм|ремінь\s+грм|натяжител.*грм|сальник/.test(s))return 'Двигатель';
  if(/сцеплен|зчеплен|коробк.*передач|трансмис|привод.*колес|шрус|гранат|полуось|кардан/.test(s))return 'Трансмиссия';
  if(/палив|топлив|бензонасос|форсунк|інжектор|инжектор/.test(s))return 'Топливная система';
  if(/глушител|выхлоп|вихлоп|катализатор|сажев|dpf/.test(s))return 'Выхлоп';
  if(/склоочищ|стеклоочист|двірник|дворник|поводок.*двор|поводок.*склооч/.test(s))return 'Стеклоочистители';
  if(/салон|сидень|сидін|панель.*прибор|приборн.*панел|ручка.*двер/.test(s))return 'Салон';
  return '';
}
function shipmentPartType(article){
  const textCategory=shipmentTextCategory(article);
  if(textCategory)return textCategory;
  const key=shipmentArticleKey(article);
  const ap=key.match(/^AP[A-Z]{2}(\d{4})[A-Z]*$/);
  if(ap){
    const code=ap[1].slice(-1);
    if(code==='1')return 'Левое крыло';
    if(code==='2')return 'Правое крыло';
    if(code==='3')return 'Капот';
    if(code==='4')return 'Панель';
    if(code==='6')return 'Передний бампер';
    if(code==='7')return 'Задний бампер';
  }
  if(/^SMBT|^WA-|^HY-|^AU-|^TB-|^TS-|^SBM/i.test(key))return 'Подвеска';
  return 'Прочее';
}
const shipmentCategoryOrder=['Левое крыло','Правое крыло','Капот','Передний бампер','Задний бампер','Решётка бампера','Решётка радиатора','Бампер','Абсорбер бампера','Усилитель бампера','Панель','Молдинг','Накладка/спойлер бампера','Спойлер','Подкрылок','Крепление/кронштейн','Заглушка','Зеркало','Фара','Фонарь','Стекло фары','Стекло','Дверь','Крышка багажника','Порог','Арка','Фильтр','Подвеска','Тормоза','Рулевое','Охлаждение/кондиционер','Двигатель','Трансмиссия','Топливная система','Выхлоп','Электрика','Свет/сигнализация','Стеклоочистители','Салон','Прочее'];
function shipmentOrderDateKey(o){
  // Новые заказы имеют точную дату отгрузки.
  if(o?.shippedAt)return localDateKey(o.shippedAt);
  // Старые заказы могли быть отгружены до появления shippedAt.
  // Для них используем дату сборки, а если её нет — дату последнего изменения.
  // Это позволяет не потерять старые позиции во вкладке «Отгрузка».
  return localDateKey(o?.assembledAt||o?.updatedAt||o?.createdAt);
}
function shipmentItemsForDate(dateKey,categoryFilter=''){
  const map=new Map();
  for(const o of state.orders){
    if(o.status!=='Отгружен кладовщиком'||shipmentOrderDateKey(o)!==dateKey)continue;
    for(const item of normalizeArticles(o.articles||[])){
      const key=String(item.article||'').trim().toUpperCase();
      if(!key)continue;
      const current=map.get(key)||{article:key,quantity:0,type:shipmentPartType(key),orders:[]};
      current.quantity+=Number(item.quantity)||1;
      if(!current.orders.includes(o.number))current.orders.push(o.number);
      map.set(key,current);
    }
  }
  const items=[...map.values()].sort((a,b)=>{
    const ai=shipmentCategoryOrder.indexOf(a.type),bi=shipmentCategoryOrder.indexOf(b.type);
    return (ai-bi)||a.article.localeCompare(b.article,'ru');
  });
  return categoryFilter ? items.filter(item=>item.type===categoryFilter) : items;
}
async function showAuditLog(){
  try{
    const snap=await getDocs(query(collection(db,'auditLog'),orderBy('createdAt','desc'),limit(500)));
    const auditRows=snap.docs.map(d=>({id:d.id,...d.data()}));
    const actionOptions=[...new Set(auditRows.map(a=>String(a.action||'Действие')))].sort((a,b)=>a.localeCompare(b,'ru'));
    const roleOptions=[...new Set(auditRows.map(a=>String(roles[a.actorRole]||a.actorRole||'Сотрудник')))].sort((a,b)=>a.localeCompare(b,'ru'));
    const controls='<div class="history-controls"><label class="search-box"><span>⌕</span><input id="auditSearch" type="search" placeholder="Сотрудник, заказ или действие"></label><select id="auditActionFilter"><option value="">Все действия</option>'+actionOptions.map(x=>'<option>'+esc(x)+'</option>').join('')+'</select><select id="auditRoleFilter"><option value="">Все роли</option>'+roleOptions.map(x=>'<option>'+esc(x)+'</option>').join('')+'</select><input id="auditDateFilter" type="date" title="Дата"></div><div id="auditList" class="timeline"></div>';
    showModal('История действий по сайту',controls,[button('Закрыть','close')],'АУДИТ СИСТЕМЫ');
    const paint=()=>{
      const q=String($('auditSearch')?.value||'').toLocaleLowerCase('ru'),action=$('auditActionFilter')?.value||'',role=$('auditRoleFilter')?.value||'',date=$('auditDateFilter')?.value||'';
      const filtered=auditRows.filter(a=>{
        const hay=(String(a.actorName||'')+' '+String(a.orderId||'')+' '+String(a.action||'')+' '+String(a.details||'')).toLocaleLowerCase('ru');
        if(q&&!hay.includes(q))return false;
        if(action&&String(a.action||'Действие')!==action)return false;
        if(role&&(roles[a.actorRole]||a.actorRole||'Сотрудник')!==role)return false;
        if(date&&localDateKey(a.createdAt)!==date)return false;
        return true;
      });
      const list=$('auditList');if(!list)return;
      list.innerHTML=filtered.length?filtered.map(a=>{
        const raw=String(a.action||'Действие'),lower=raw.toLocaleLowerCase('ru');
        const tone=lower.includes('удал')||lower.includes('отмен')||lower.includes('дефект')?'red':lower.includes('статус')||lower.includes('одобр')?'blue':lower.includes('добав')||lower.includes('созда')?'green':lower.includes('отгруз')||lower.includes('провер')?'violet':'neutral';
        return '<article class="history-entry history-'+tone+'"><div class="history-entry-bar"></div><div class="timeline-top"><span><b>'+esc(a.actorName||'Сотрудник')+'</b> · '+fmtDateTime(a.createdAt)+'</span><span class="timeline-type">'+esc(roles[a.actorRole]||a.actorRole||'Действие')+'</span></div>'+(a.orderId?'<div class="timeline-article">Заказ: '+esc(a.orderId)+'</div>':'')+'<div class="timeline-text"><b>'+esc(raw)+'</b>'+(a.details?'<br>'+esc(a.details):'')+'</div></article>';
      }).join(''):'<div class="danger-note">По выбранным фильтрам записей нет.</div>';
    };
    ['auditSearch','auditActionFilter','auditRoleFilter','auditDateFilter'].forEach(id=>$(id)?.addEventListener('input',paint));
    ['auditActionFilter','auditRoleFilter','auditDateFilter'].forEach(id=>$(id)?.addEventListener('change',paint));
    paint();
  }catch(err){console.error(err);toast('Не удалось загрузить общую историю действий.');}
}
function shiftShipmentDate(dateKey,days){
  const date=new Date(String(dateKey||localDateKey(new Date()))+'T12:00:00');
  date.setDate(date.getDate()+Number(days||0));
  return localDateKey(date);
}
async function openShipmentDayOffset(days){
  const current=$('shipmentDate')?.value||localDateKey(new Date());
  await openShipmentManifest(shiftShipmentDate(current,days));
}
async function toggleShipmentItemChecked(dateKey,article){
  if(!(canManageUsers||state.role==='warehouse')){toast('Отметить проверку может только кладовщик или администратор.');return;}
  const key=String(article||'').trim().toUpperCase();
  if(!key)return;
  try{
    const ref=doc(db,'shipmentDays',dateKey);
    const snap=await getDoc(ref);
    const data=snap.exists()?snap.data():{};
    const checked=new Set(Array.isArray(data.checkedArticles)?data.checkedArticles.map(x=>String(x).trim().toUpperCase()).filter(Boolean):[]);
    const nextChecked=!checked.has(key);
    if(nextChecked)checked.add(key);else checked.delete(key);
    await setDoc(ref,{
      date:dateKey,
      checkedArticles:[...checked]
    },{merge:true});
    await writeAudit(
      nextChecked?'Проверена позиция на отгрузке':'Снята проверка позиции на отгрузке',
      'Дата: '+dateKey+'; артикул: '+key
    );
    openShipmentManifest(dateKey);
  }catch(err){
    console.error('Не удалось сохранить отметку проверки отгрузки',err);
    toast('Не удалось сохранить отметку проверки.');
  }
}
async function openShipmentManifest(dateKey=localDateKey(new Date()),categoryFilter=''){
  await loadShipmentCategoryMap();
  let confirmation=null;
  try{const snap=await getDoc(doc(db,'shipmentDays',dateKey));if(snap.exists())confirmation=snap.data();}catch(err){console.warn(err);}
  const shipmentDaySnap=await getDoc(doc(db,'shipmentDays',dateKey)).catch(()=>null);
  const checkedArticles=new Set(shipmentDaySnap?.exists()&&Array.isArray(shipmentDaySnap.data()?.checkedArticles)?shipmentDaySnap.data().checkedArticles.map(x=>String(x).trim().toUpperCase()).filter(Boolean):[]);
  const allItems=shipmentItemsForDate(dateKey);
  const items=shipmentItemsForDate(dateKey,categoryFilter).map(x=>({...x,checked:checkedArticles.has(String(x.article||'').trim().toUpperCase())})),groups=new Map();
  const categoryOptions=[...new Set(allItems.map(item=>item.type))].sort((a,b)=>a.localeCompare(b,'ru'));
  for(const item of items){if(!groups.has(item.type))groups.set(item.type,[]);groups.get(item.type).push(item);}
  const categoryTotals=new Map();
  for(const item of items)categoryTotals.set(item.type,(categoryTotals.get(item.type)||0)+item.quantity);
  const orderedGroups=shipmentCategoryOrder.filter(type=>groups.has(type)).map(type=>[type,groups.get(type)]);
  let html='<div class="shipment-day-picker"><button type="button" class="shipment-day-nav" data-action="shipment-day-prev" aria-label="Предыдущий день">‹</button><div class="shipment-day-current"><label for="shipmentDate">День отгрузки</label><input id="shipmentDate" type="date" value="'+esc(dateKey)+'"></div><button type="button" class="shipment-day-nav" data-action="shipment-day-next" aria-label="Следующий день">›</button></div><div class="shipment-day-quick"><button type="button" class="small-button primary-soft" data-action="shipment-day-today">Сегодня</button><button type="button" class="small-button" data-action="shipment-day-prev">← Предыдущий</button><button type="button" class="small-button" data-action="shipment-day-next">Следующий →</button></div>';  html+='<div class="field" style="margin:0 0 10px"><label for="shipmentCategoryFilter">Категория деталей</label><select id="shipmentCategoryFilter"><option value="">Все категории</option>'+categoryOptions.map(type=>'<option value="'+esc(type)+'"'+(type===categoryFilter?' selected':'')+'>'+esc(type)+'</option>').join('')+'</select></div>';
  const orderCount=new Set(items.flatMap(x=>x.orders)).size,itemCount=items.reduce((sum,x)=>sum+x.quantity,0);
  html+='<p class="stat-modal-hint">Заказов: <b>'+orderCount+'</b> · деталей: <b>'+itemCount+'</b> · артикулов: <b>'+items.length+'</b>'+(categoryFilter?' · категория: <b>'+esc(categoryFilter)+'</b>':'')+'</p>';
  if(items.length){
    html+='<div class="shipment-category-summary">'+shipmentCategoryOrder.filter(type=>categoryTotals.has(type)).map(type=>'<div class="shipment-category-card"><span>'+esc(type)+'</span><strong>'+categoryTotals.get(type)+' шт.</strong></div>').join('')+'</div>';
  }
  for(const [type,list] of orderedGroups){
    html+='<div class="manifest-group"><h3><span>'+esc(type)+'</span><b>'+categoryTotals.get(type)+' шт.</b></h3>';
    for(const x of list){
      const checkControl=(canManageUsers||state.role==='warehouse')
        ? '<button type="button" class="small-button '+(x.checked?'good':'primary-soft')+'" data-action="toggle-shipment-checked:'+dateKey+'|'+encodeURIComponent(x.article)+'">'+(x.checked?'✓ Проверено':'☐ Проверил кладовщик')+'</button>'
        : '<span class="article-collected-state">'+(x.checked?'✓ Проверено':'☐ Не проверено')+'</span>';
      html+='<div class="manifest-row"><span><b>'+esc(x.article)+'</b><small>'+x.orders.length+' заказ(ов)</small></span><span style="display:flex;align-items:center;gap:8px"><strong>'+x.quantity+' шт.</strong>'+checkControl+'</span></div>';
    }
    html+='</div>';
  }
  if(!items.length)html+='<div class="danger-note">На этот день нет заказов со статусом «Отгружен кладовщиком».</div>';
  if(confirmation?.confirmed){
    html+='<div class="danger-note">✓ Список подтверждён: '+esc(confirmation.confirmedByName||'Сотрудник')+' · '+fmtDateTime(confirmation.confirmedAt)+'</div>';
    if(canManageUsers||state.role==='warehouse'||state.role==='manager'){
      html+=button('↶ Снять подтверждение','revoke-shipment:'+dateKey,'small-button danger');
    }
  }else if(confirmation?.revokedAt){
    html+='<div class="danger-note shipment-revoked">↶ Подтверждение снято: '+esc(confirmation.revokedByName||'Сотрудник')+' · '+fmtDateTime(confirmation.revokedAt)+'</div>';
    if(canManageUsers||state.role==='warehouse'||state.role==='manager'){
      html+=button('✓ Подтвердить список снова','confirm-shipment:'+dateKey,'small-button good');
    }
  }else if(canManageUsers||state.role==='warehouse'||state.role==='manager')html+=button('✓ Подтвердить список на отгрузку','confirm-shipment:'+dateKey,'small-button good');
  else html+='<div class="field-hint">Подтвердить список может кладовщик, менеджер или администратор.</div>';
  showModal('Список деталей на отгрузку',html,[button('Показать день','shipment-date','small-button primary-soft'),button('Закрыть','close')],'ОТГРУЗКА ПО ДНЯМ');
}
async function confirmShipmentManifest(dateKey){
  if(!(canManageUsers||state.role==='warehouse'||state.role==='manager')){toast('У вас нет права подтверждать список.');return;}
  const items=shipmentItemsForDate(dateKey);
  if(!items.length){toast('На выбранный день нет деталей на отгрузку.');return;}
  const orderCount=new Set(items.flatMap(x=>x.orders)).size,itemCount=items.reduce((s,x)=>s+x.quantity,0);
  await setDoc(doc(db,'shipmentDays',dateKey),{date:dateKey,confirmed:true,confirmedBy:signedInUser.uid,confirmedByName:profileName||roles[state.role],confirmedAt:isoNow(),orderCount,itemCount,revokedBy:'',revokedByName:'',revokedAt:''},{merge:true});
  await writeAudit('Подтверждён список на отгрузку','Дата: '+dateKey+'; заказов: '+orderCount+'; деталей: '+itemCount);
  toast('Список на отгрузку подтверждён.');
  openShipmentManifest(dateKey);
}
async function revokeShipmentManifest(dateKey){
  if(!(canManageUsers||state.role==='warehouse')){toast('Снять подтверждение может только кладовщик или администратор.');return;}
  const snap=await getDoc(doc(db,'shipmentDays',dateKey));
  if(!snap.exists()||snap.data()?.confirmed!==true){toast('Подтверждение уже снято или отсутствует.');return;}
  const current=snap.data()||{};
  await setDoc(doc(db,'shipmentDays',dateKey),{
    confirmed:false,
    revokedBy:signedInUser.uid,
    revokedByName:profileName||roles[state.role],
    revokedAt:isoNow()
  },{merge:true});
  await writeAudit(
    'Снято подтверждение списка на отгрузку',
    'Дата: '+dateKey+'; первоначально подтвердил: '+String(current.confirmedByName||'Сотрудник')
  );
  toast('Подтверждение списка снято.');
  openShipmentManifest(dateKey);
}
function showNotifications(){
  const render=()=>{
    const q=String($('notificationSearch')?.value||'').toLocaleLowerCase('ru');
    const cat=$('notificationFilter')?.value||'';
    const list=state.notices.filter(n=>{
      const hay=(String(n.title||'')+' '+String(n.message||'')+' '+String(n.body||'')).toLocaleLowerCase('ru');
      return (!q||hay.includes(q))&&(!cat||(n.category||(n.target==='chat'?'chat':'orders'))===cat);
    });
    const rows=list.map(n=>{
      const tone=notificationTone(n),category=n.category||(n.target==='chat'?'chat':'orders');
      return '<article class="notification-entry notification-'+tone+' '+(n.read?'':'unread')+'"><span class="notification-dot"></span><div><b>'+esc(n.title||'Уведомление')+'</b><p>'+esc(n.message||n.body||'Новое событие')+'</p><small>'+fmtDateTime(n.createdAt||n.at)+'</small></div>'+(n.orderId?'<button type="button" class="small-button primary-soft" data-open="'+esc(n.orderId)+'">Открыть</button>':'')+'</article>';
    }).join('');
    const listEl=$('notificationList');if(listEl)listEl.innerHTML=rows||'<div class="danger-note">Уведомлений по фильтрам нет.</div>';
    // Everything rendered in the notification center is considered seen.
    // The explicit "Прочитать всё" button remains available for unread
    // notifications that are not currently visible because of filters/search.
    markNotificationItemsRead(list).then(()=>{
      // Update only the unread counter; do not call render() here,
      // because render() would reopen this renderer and create a loop.
      const summary=document.querySelector('.notification-summary b');
      if(summary)summary.textContent=String(state.notices.filter(n=>!n.read).length);
    });
  };
  const unread=state.notices.filter(n=>!n.read).length;
  const pushGranted=typeof Notification!=='undefined'&&Notification.permission==='granted';
  const pushControls='<div class="push-device-controls"><div><b>Системные push-уведомления</b><small>'+((pushGranted)?'Разрешены в браузере':'Можно включить на этом устройстве')+'</small></div><div class="push-device-buttons"><button type="button" class="small-button good" data-action="enable-notifications">🔔 Включить уведомления</button><button type="button" class="small-button danger" data-action="disable-notifications">🔕 Отключить уведомления</button></div></div>';
  const body=pushControls+'<div class="notification-toolbar"><label class="search-box"><span>⌕</span><input id="notificationSearch" type="search" placeholder="Поиск уведомлений"></label><select id="notificationFilter"><option value="">Все</option><option value="orders">Заказы</option><option value="chat">Общий чат</option><option value="replies">Ответы и упоминания</option><option value="likes">Лайки</option></select></div><div class="notification-settings-grid">'+['chat','replies','likes','orders'].map(k=>'<button type="button" class="notification-setting '+(state.notificationSettings[k]?'enabled':'disabled')+'" data-action="toggle-notification:'+k+'"><b>'+({chat:'💬 Чат',replies:'↩ Ответы',likes:'👍 Лайки',orders:'📦 Заказы'}[k])+'</b><small>'+(state.notificationSettings[k]?'Включены':'Выключены')+'</small></button>').join('')+'</div><div class="notification-summary"><b>'+unread+'</b> непрочитанных уведомлений</div><div id="notificationList" class="notification-list"></div>';
  showModal('Уведомления',body,[button('Прочитать всё','mark-notifications-read','small-button good'),button('Закрыть','close')],'ЦЕНТР УВЕДОМЛЕНИЙ');
  $('notificationSearch')?.addEventListener('input',render);$('notificationFilter')?.addEventListener('change',render);render();
}
function profileMenu(){const themeAction=button(document.body.classList.contains('dark-theme')?'☀️ Светлая тема':'🌙 Тёмная тема','toggle-theme','small-button primary-soft'),adminAction=canManageUsers?button('Учётные записи сотрудников','open-staff','small-button primary-soft'):'',historyAction=canManageUsers?button('История удалённых заказов','deleted-orders','small-button'):'',hasPassword=signedInUser?.providerData.some(p=>p.providerId==='password');showModal('Учётная запись',`<p style="font-size:13px;color:#52635a;margin:0 0 6px"><b>${esc(profileName)}</b><br>${esc(signedInUser?.email||'')} · ${esc(roles[state.role])}${canManageUsers?' · администратор':''}</p>`,[themeAction,adminAction,historyAction,...(!hasPassword?[button('Задать пароль для входа','set-login-password','small-button')]:[button('Сменить пароль','change-password','small-button')]),button('Выйти','sign-out','small-button danger'),button('Закрыть','close')],'ПРОФИЛЬ СОТРУДНИКА')}
function setLoginPassword(){showModal('Задать пароль для входа',`<p class="field-hint">Это подключит вход по почте и паролю к этой учётной записи. Текущий вход Google продолжит работать.</p><div class="field"><label for="linkPassword">Новый пароль *</label><input id="linkPassword" type="password" minlength="6" autocomplete="new-password" required></div>`,[button('Назад','back-profile'),button('Задать пароль','save-login-password','primary-button')],'БЕЗОПАСНОСТЬ')}
async function saveLoginPassword(){const password=$('linkPassword').value;if(password.length<6){toast('Пароль должен содержать минимум 6 символов.');return}try{await linkWithCredential(signedInUser,EmailAuthProvider.credential(signedInUser.email,password));toast('Вход по почте и паролю подключён.');profileMenu()}catch(err){console.error('Не удалось подключить пароль',err);toast(err.code==='auth/credential-already-in-use'?'Эта почта уже связана с другой учётной записью.':'Не удалось задать пароль. Выйдите и войдите через Google заново.') }}
function changePassword(){showModal('Сменить пароль',`<form id="changePasswordForm"><div class="field"><label for="currentPassword">Текущий пароль *</label><input id="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label for="newPassword">Новый пароль *</label><input id="newPassword" type="password" minlength="6" autocomplete="new-password" required><span class="field-hint">Не менее 6 символов.</span></div><div class="field"><label for="confirmPassword">Повторите новый пароль *</label><input id="confirmPassword" type="password" minlength="6" autocomplete="new-password" required></div></form>`,[button('Назад','back-profile'),button('Сохранить пароль','save-password','primary-button')],'БЕЗОПАСНОСТЬ')}
async function savePassword(){const current=$('currentPassword').value,next=$('newPassword').value,confirm=$('confirmPassword').value;if(!signedInUser.providerData.some(p=>p.providerId==='password')){toast('Сначала задайте пароль для входа в меню профиля.');return}if(next.length<6){toast('Новый пароль должен содержать минимум 6 символов.');return}if(next!==confirm){toast('Новые пароли не совпадают.');return}try{await reauthenticateWithCredential(signedInUser,EmailAuthProvider.credential(signedInUser.email,current));await updatePassword(signedInUser,next);closeModal();toast('Пароль успешно изменён.')}catch(err){console.error('Не удалось сменить пароль',err);toast(err.code==='auth/invalid-credential'||err.code==='auth/wrong-password'?'Текущий пароль указан неверно.':err.code==='auth/weak-password'?'Пароль слишком простой.':err.code==='auth/requires-recent-login'?'Войдите заново и повторите смену пароля.':'Не удалось сменить пароль. Проверьте текущий пароль и соединение.')}}
async function showStaff(){if(!canManageUsers)return;try{const snap=await getDocs(collection(db,'users'));const people=snap.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>String(a.displayName||'').localeCompare(String(b.displayName||''),'ru'));const rows=people.map(p=>`<div class="notice-item"><b>${esc(p.displayName||'Без имени')}</b><small>${esc(p.email||'')} · ${esc(roles[p.role]||'роль не задана')} · ${p.active?'Активен':'Отключён'}${p.admin?' · Администратор':''}</small>${p.uid!==signedInUser.uid?`<div class="staff-actions"><select id="staff-role-${esc(p.uid)}" aria-label="Роль сотрудника ${esc(p.displayName||p.email||'')}"><option value="warehouse" ${p.role==='warehouse'?'selected':''}>Кладовщик</option><option value="manager" ${p.role==='manager'?'selected':''}>Менеджер</option><option value="chief_accountant" ${p.role==='chief_accountant'?'selected':''}>Главный бухгалтер</option><option value="accountant" ${p.role==='accountant'?'selected':''}>Бухгалтер</option><option value="director" ${p.role==='director'?'selected':''}>Директор</option></select><button class="small-button primary-soft" data-action="save-role:${esc(p.uid)}">Сохранить роль</button><button class="small-button ${p.active?'danger':'good'}" data-action="toggle-user:${esc(p.uid)}:${p.active?'off':'on'}">${p.active?'Отключить':'Включить'}</button></div>`:''}</div>`).join('');showModal('Учётные записи сотрудников',`<div class="notice-list">${rows||'<div class="danger-note">Пока нет сотрудников.</div>'}</div>`,[button('Назад','back-profile'),button('＋ Добавить сотрудника','new-staff','primary-button')],'АДМИНИСТРИРОВАНИЕ') }catch(err){console.error(err);toast('Не удалось загрузить список сотрудников.')}}
function newStaff(){if(!canManageUsers)return;const rolesOptions=`<option value="warehouse">Кладовщик</option><option value="manager">Менеджер</option><option value="chief_accountant">Главный бухгалтер</option><option value="accountant">Бухгалтер</option><option value="director">Директор</option>`;showModal('Добавить сотрудника',`<form id="staffForm"><div class="field"><label for="staffName">Имя сотрудника *</label><input id="staffName" required autocomplete="off"></div><div class="field"><label for="staffEmail">Почта *</label><input id="staffEmail" type="email" required autocomplete="email"></div><div class="field"><label for="staffPassword">Пароль *</label><input id="staffPassword" type="password" minlength="6" autocomplete="new-password" required><span class="field-hint">Минимум 6 символов. Сотрудник сможет сменить пароль после входа.</span></div><div class="field"><label for="staffRole">Роль</label><select id="staffRole">${rolesOptions}</select></div></form>`,[button('Назад','open-staff'),button('Добавить сотрудника','create-staff','primary-button')],'НОВЫЙ СОТРУДНИК')}
async function createStaff(){const displayName=$('staffName').value.trim(),email=$('staffEmail').value.trim().toLowerCase(),password=$('staffPassword').value,role=$('staffRole').value;if(!displayName||!email||!password){toast('Заполните имя, почту и пароль.');return}if(password.length<6){toast('Пароль должен содержать минимум 6 символов.');return}if(!canManageUsers){toast('У вас нет прав назначить эту роль.');return}let createdUser=null;try{const result=await createUserWithEmailAndPassword(staffAuth,email,password);createdUser=result.user;await setDoc(doc(db,'users',createdUser.uid),{displayName,email,role,active:true,admin:role==='director'});toast('Сотрудник добавлен. Можно войти с указанными почтой и паролем.');showStaff()}catch(err){console.error('Не удалось добавить сотрудника',err);toast(createdUser?'Аккаунт создан, но профиль не сохранился. Проверьте правила Firestore и удалите аккаунт в Firebase Console.':err.code==='auth/email-already-in-use'?'Эта почта уже зарегистрирована. Удалите старый аккаунт в Firebase Console → Authentication → Users.':err.code==='auth/weak-password'?'Пароль слишком простой. Используйте не менее 6 символов.':`Не удалось добавить сотрудника: ${err.code||err.message||'ошибка'}`)}finally{if(staffAuth.currentUser)await signOut(staffAuth).catch(()=>{})}}
function backProfile(){closeModal();profileMenu()}
async function toggleStaff(uid,active){if(!canManageUsers||uid===signedInUser.uid)return;try{await updateDoc(doc(db,'users',uid),{active});toast(active?'Доступ сотрудника включён.':'Доступ сотрудника отключён.');showStaff()}catch(err){console.error(err);toast('Не удалось изменить доступ сотрудника.')}}
async function changeStaffRole(uid){if(!canManageUsers||uid===signedInUser.uid)return;const role=$(`staff-role-${uid}`)?.value;if(!roles[role])return;try{await updateDoc(doc(db,'users',uid),{role});toast(`Роль изменена: ${roles[role]}.`);showStaff()}catch(err){console.error(err);toast('Не удалось изменить роль. Проверьте права администратора и правила Firestore.')}}
function backDetail(){if(selectedId)openOrder(selectedId);}
document.addEventListener('click',e=>{
  const statCard=e.target.closest('[data-stat-key]');
  if(statCard){e.preventDefault();openStatOrders(statCard.dataset.statKey||'');return;}
  const mention=e.target.closest('[data-chat-mention]');
  if(mention){e.preventDefault();insertChatMention(mention.dataset.chatMention||'');return;}
  const like=e.target.closest('[data-action^="toggle-chat-like:"]');
  if(like){e.preventDefault();toggleChatLike(like.dataset.action.split(':').slice(1).join(':'));return;}
const notice=e.target.closest('[data-open-notification]');if(notice){const id=notice.dataset.openNotification,target=notice.dataset.notificationTarget;if(target==='chat'){closeModal();openChat();}else if(id)openOrder(id);return}const open=e.target.closest('[data-open]');if(open){e.preventDefault();openOrder(open.dataset.open);return}const nav=e.target.closest('.nav-item');if(nav){activeFilter=nav.dataset.filter;render();closeSidebar();return}if(e.target===$('sidebarBackdrop')){closeSidebar();return}if(e.target===$('imageViewer')||e.target===$('closeImageViewer')){$('imageViewer').hidden=true;$('imageViewerImage').removeAttribute('src');return}const act=e.target.closest('[data-action]')?.dataset.action;if(act){if(act==='close')closeModal();else if(act==='send-chat')sendChatMessage();else if(act==='create-order')saveOrder();else if(act==='add-order-article'){const rows=$('orderArticlesRows');if(rows)rows.insertAdjacentHTML('beforeend',articleRowHtml());}else if(act==='remove-order-article'){e.target.closest('.order-article-row')?.remove();}else if(act.startsWith('toggle-collected:')){toggleArticleCollected(Number(act.slice(17)));}else if(act==='edit-articles')editArticles();else if(act==='edit-order-info')editOrderInfo();else if(act==='open-warehouse-actions')openOrderActionCategory('warehouse');else if(act==='open-manager-actions')openOrderActionCategory('manager');else if(act==='save-order-info')saveOrderInfo();else if(act==='save-articles')saveArticles();else if(act==='add-comment')addComment();else if(act==='add-defect')addDefect();else if(act==='back-detail')backDetail();else if(act==='save-entry')saveEntry();else if(act==='set-assembled'){setStatus('Собран','Кладовщик отметил заказ как собран.');}else if(act==='set-shipped'){setStatus('Отгружен кладовщиком','Кладовщик отметил заказ как отгруженный.');}else if(act.startsWith('toggle-shipment-checked:')){const raw=act.slice(24),sep=raw.indexOf('|');if(sep>0){const dateKey=raw.slice(0,sep),article=decodeURIComponent(raw.slice(sep+1));toggleShipmentItemChecked(dateKey,article);}}else if(act.startsWith('set-status:')){const status=act.slice(11);setStatus(status,`Статус заказа изменён на «${status}».`)}else if(act==='show-on-map'){let article=e.target.closest('[data-map-article]')?.dataset.mapArticle||'';article=article.trim().split(/\s+/)[0];if(article)window.open('https://hlebish.github.io/warehouse-map/?article='+encodeURIComponent(article),'warehouseMap')}else if(act==='set-created'){setStatus('Создан','Кладовщик вернул заказ в статус «Создан».');}else if(act==='set-pickup-waiting'){if(isManagerRole()||canManageUsers){setStatus('Ожидает самовывоза','Менеджер отметил заказ как ожидающий самовывоза.');}}else if(act==='set-pickup-done'){if(isManagerRole()||canManageUsers){setStatus('Клиент забрал самовывозом','Клиент забрал заказ самовывозом.');}}else if(act==='set-transferred'){if(isManagerRole()||canManageUsers){setStatus('Перенесен','Заказ перенесен.');}}else if(act==='set-approval')setStatus('На согласовании','Начал согласование заказа с клиентом.');else if(act==='approve-order')approveOrder();else if(act==='confirm-approve')confirmApprove();else if(act==='cancel-order')cancelOrder();else if(act==='confirm-cancel')confirmCancel();else if(act==='mark-seen')markViewed();else if(act==='delete-order')deleteOrder();else if(act==='confirm-delete')confirmDelete();else if(act.startsWith('delete-entry:'))deleteEntry(act.split(':')[1]);else if(act.startsWith('confirm-delete-entry:'))confirmDeleteEntry(act.split(':')[1]);else if(act==='confirm-defect-cancel')confirmDefectCancel();else if(act==='sign-out'){closeModal();signOut(auth)}else if(act==='open-staff')showStaff();else if(act==='new-staff')newStaff();else if(act==='create-staff')createStaff();else if(act==='back-profile')backProfile();else if(act==='change-password')changePassword();else if(act==='save-password')savePassword();else if(act==='set-login-password')setLoginPassword();else if(act==='save-login-password')saveLoginPassword();else if(act==='deleted-orders')showDeletedOrders();else if(act==='site-history')showAuditLog();else if(act==='analytics')showWarehouseAnalytics();else if(act==='shipment-manifest')openShipmentManifest();else if(act==='shipment-date'){openShipmentManifest($('shipmentDate')?.value||localDateKey(new Date()));}else if(act==='shipment-day-prev'){openShipmentDayOffset(-1);}else if(act==='shipment-day-next'){openShipmentDayOffset(1);}else if(act==='shipment-day-today'){openShipmentManifest(localDateKey(new Date()));}else if(act.startsWith('confirm-shipment:'))confirmShipmentManifest(act.slice(17));else if(act.startsWith('revoke-shipment:'))revokeShipmentManifest(act.slice(16));else if(act==='toggle-theme'){applyTheme(document.body.classList.contains('dark-theme')?'light':'dark');profileMenu();}else if(act.startsWith('view-deleted-order:'))showDeletedOrder(act.slice('view-deleted-order:'.length));else if(act.startsWith('save-role:'))changeStaffRole(act.slice('save-role:'.length));else if(act.startsWith('toggle-user:')){const[,uid,mode]=act.split(':');toggleStaff(uid,mode==='on')}else if(act==='enable-notifications'){enablePush()}else if(act==='disable-notifications'){disablePush()}else if(act==='mark-notifications-read'){markNotificationsRead()}else if(act.startsWith('toggle-notification:')){toggleNotificationSetting(act.slice('toggle-notification:'.length))}else if(act.startsWith('reply-chat:')){startChatReply(act.slice('reply-chat:'.length))}else if(act==='cancel-chat-reply'){cancelChatReply()}else if(act.startsWith('defect-confirm:'))decideDefect(act.split(':')[1],'Подтверждён');else if(act.startsWith('defect-cancel:')){pendingDefectId=act.split(':')[1];decideDefect(pendingDefectId,'Отменён')}return}if(e.target===modal)closeModal();const photo=e.target.closest('[data-photo]');if(photo){$('imageViewerImage').src=photo.dataset.photo;$('imageViewer').hidden=false}});
let sidebarHistoryEntry=false,handlingSidebarPop=false;function closeSidebar(fromPop=false){$('sidebar').classList.remove('open');$('sidebarBackdrop').hidden=true;if(sidebarHistoryEntry&&!fromPop){handlingSidebarPop=true;history.back()}sidebarHistoryEntry=false}
function openSidebar(){if($('sidebar').classList.contains('open')){closeSidebar();return}$('sidebar').classList.add('open');$('sidebarBackdrop').hidden=false;history.pushState({mobileSidebar:true},'','#menu');sidebarHistoryEntry=true}
window.addEventListener('popstate',()=>{
  if(modalHistoryEntry){
    closeModal(true);
    return;
  }
  if($('sidebar').classList.contains('open')){
    closeSidebar(true);
    return;
  }
  if(handlingSidebarPop)handlingSidebarPop=false;
});document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSidebar();if(!$('imageViewer').hidden){$('imageViewer').hidden=true;$('imageViewerImage').removeAttribute('src');return}if(!modal.hidden)closeModal()}});$('closeImageViewer').addEventListener('click',()=>{$('imageViewer').hidden=true;$('imageViewerImage').removeAttribute('src')});
$('newOrderButton').addEventListener('click',openNewOrder);$('emptyAddButton').addEventListener('click',openNewOrder);$('closeModal').addEventListener('click',closeModal);$('searchInput').addEventListener('input',render);$('dateFromFilter').addEventListener('change',render);$('dateToFilter').addEventListener('change',render);$('clearDateButton').addEventListener('click',()=>{$('dateFromFilter').value='';$('dateToFilter').value='';render()});$('notificationButton').addEventListener('click',showNotifications);$('profileButton').addEventListener('click',profileMenu);$('chatSidebarButton').addEventListener('click',openChat);$('mobileMenu').addEventListener('click',openSidebar);function positionFilterMenu(){const button=$('filterButton'),menu=$('filterMenu');if(!button||!menu||menu.hidden)return;const r=button.getBoundingClientRect();const gap=6;const menuWidth=Math.max(205,r.width);let left=Math.min(r.right-menuWidth,window.innerWidth-8);left=Math.max(8,left);let top=r.bottom+gap;const menuHeight=menu.offsetHeight;if(top+menuHeight>window.innerHeight-8&&r.top-menuHeight-gap>=8)top=r.top-menuHeight-gap;menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';menu.style.minWidth=Math.round(menuWidth)+'px'}$('filterButton').addEventListener('click',e=>{e.stopPropagation();const menu=$('filterMenu');const isOpen=!menu.hidden;menu.hidden=isOpen;$('filterButton').setAttribute('aria-expanded',String(!isOpen));if(!isOpen){updateFilterMenu();requestAnimationFrame(positionFilterMenu)}});document.querySelectorAll('[data-menu-filter]').forEach(btn=>btn.addEventListener('click',()=>{activeFilter=btn.dataset.menuFilter;render();updateFilterMenu();$('filterMenu').hidden=true;$('filterButton').setAttribute('aria-expanded','false')}));document.addEventListener('click',e=>{if(!e.target.closest('.filter-menu-wrap')){$('filterMenu').hidden=true;$('filterButton').setAttribute('aria-expanded','false')}});window.addEventListener('resize',positionFilterMenu);window.addEventListener('scroll',positionFilterMenu,true);function updateFilterMenu(){document.querySelectorAll('[data-menu-filter]').forEach(btn=>btn.classList.toggle('active',btn.dataset.menuFilter===activeFilter));}document.addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ')&&e.target.closest('.stat-card-clickable')){
    e.preventDefault();
    openStatOrders(e.target.closest('.stat-card-clickable').dataset.statKey||'');
  }
});
document.addEventListener('change',e=>{
  if(e.target?.id==='shipmentCategoryFilter'){
    openShipmentManifest($('shipmentDate')?.value||localDateKey(new Date()),e.target.value||'');
  }
});
document.addEventListener('submit',e=>e.preventDefault());
if('serviceWorker'in navigator){
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type==='APP_UPDATED'){
      const key='warehouse_orders_app_version';
      const version=document.querySelector('meta[name="app-version"]')?.content||'';
      if(version)localStorage.setItem(key,version);
      window.location.reload();
    }
  });
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
showAuth();
