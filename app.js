import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential, GoogleAuthProvider, signInWithPopup, linkWithCredential, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, getDoc, updateDoc, writeBatch, serverTimestamp, query, orderBy, limit, startAfter, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import { getMessaging, getToken, deleteToken, onMessage } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';
import { firebaseConfig, vapidKey } from './firebase-config.js';
const firebaseApp=initializeApp(firebaseConfig),auth=getAuth(firebaseApp),db=getFirestore(firebaseApp),messaging=getMessaging(firebaseApp),storage=getStorage(firebaseApp),staffAuth=getAuth(initializeApp(firebaseConfig,'amp-staff-provisioner'));
let signedInUser=null,profileName='',canManageUsers=false,profileUnsubscribe=null,ordersUnsubscribe=null,chatUnsubscribe=null,chatBadgeUnsubscribe=null,notificationsUnsubscribe=null,serverCache=new Map(),entryUnsubscribes=new Map(),pendingWrites=new Set(),pendingOrderData=new Map(),initialCloudLoad=true;
const roles={warehouse:'Кладовщик',manager:'Менеджер',chief_accountant:'Главный бухгалтер',accountant:'Бухгалтер',director:'Директор'};
const isManagerRole=()=>['manager','chief_accountant','accountant'].includes(state.role);
const isShipmentLocked=o=>['Отгружен кладовщиком','Клиент забрал самовывозом'].includes(o?.status)&&!canManageUsers;
const canEditOrder=o=>!!o&&!isShipmentLocked(o);

 // Cache derived search text per order object so typing in the search field does not
 // repeatedly rebuild article strings for every row. The signature detects local edits.
const orderSearchCache = new WeakMap();
function orderSearchText(order) {
  const articles = Array.isArray(order.articles) ? order.articles : [];
  const signature = [order.number || '', order.client || '',
    articles.map(item => String(item?.article || item || '').toLocaleLowerCase('ru')).join(' ')
  ].join('\u0000');
  const cached = orderSearchCache.get(order);
  if (cached?.signature === signature) return cached.text;
  const text = (String(order.number || '') + ' ' + String(order.client || '') + ' ' +
    articles.map(item => String(item?.article || item || '').toLocaleLowerCase('ru')).join(' ')
  ).toLocaleLowerCase('ru');
  orderSearchCache.set(order, { signature, text });
  return text;
}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isoNow=()=>new Date().toISOString();
const asDate=d=>{if(!d)return null;if(typeof d.toDate==='function')return d.toDate();if(typeof d.toMillis==='function')return new Date(d.toMillis());if(d instanceof Date)return d;const out=new Date(d);return Number.isNaN(out.getTime())?null:out};
const fmtDate=d=>{const date=asDate(d);return date?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric'}).format(date):'—'};
const fmtDateTime=d=>{const date=asDate(d);return date?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):'—'};
let state={orders:[],notices:[],role:'warehouse',seen:{},extraPhoneNotifications:false,notificationSettings:{chat:true,replies:true,likes:true,orders:true}};
let activeFilter='all', selectedId=null, pendingDefectId=null, pendingNotificationOrderId='', pendingNotificationChat=false, chatReplyTo=null, chatUnread=false, chatFilterText='', chatFilterMode='all', currentOrdersPage=1;
const ordersPageSize=50;
const notificationParams=new URLSearchParams(location.search);
pendingNotificationOrderId=notificationParams.get('order')||'';
pendingNotificationChat=notificationParams.get('chat')==='1';
const $=id=>document.getElementById(id), modal=$('modalBackdrop');
let uiStateRestored=false,lastUiSave=0;
function saveUiState(){
  try{
    const chatBox=$('chatMessages');
    const modalOpen=!!(modal&&!modal.hidden);
    const modalTitle=$('modalTitle')?.textContent||'';
    const isChat=modalOpen&&modalTitle==='Общий чат';
    const orderId=modalOpen&&modalTitle.includes('№')&&modal.dataset.orderDetail?String(modal.dataset.orderDetail):'';
    sessionStorage.setItem('warehouseUiState',JSON.stringify({
      scrollX:window.scrollX||0,scrollY:window.scrollY||0,
      activeFilter,search:$('searchInput')?.value||'',
      dateFrom:$('dateFromFilter')?.value||'',dateTo:$('dateToFilter')?.value||'',
      currentOrdersPage,modalType:isChat?'chat':orderId?'order':'',
      orderId,chatScrollTop:chatBox?.scrollTop||0
    }));
  }catch{}
}
function restoreUiState(){
  if(uiStateRestored)return;
  uiStateRestored=true;
  try{
    const raw=sessionStorage.getItem('warehouseUiState');
    if(!raw)return;
    const saved=JSON.parse(raw);
    if(saved.activeFilter)activeFilter=saved.activeFilter;
    if($('searchInput')&&typeof saved.search==='string')$('searchInput').value=saved.search;
    if($('dateFromFilter')&&typeof saved.dateFrom==='string')$('dateFromFilter').value=saved.dateFrom;
    if($('dateToFilter')&&typeof saved.dateTo==='string')$('dateToFilter').value=saved.dateTo;
    currentOrdersPage=Math.max(1,Number(saved.currentOrdersPage)||1);
    render();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      window.scrollTo(Number(saved.scrollX)||0,Number(saved.scrollY)||0);
      if(saved.modalType==='order'&&saved.orderId&&state.orders.some(o=>o.id===saved.orderId)){
        openOrder(saved.orderId);
      }else if(saved.modalType==='chat'){
        openChat();
        if(Number(saved.chatScrollTop)>0){
          const target=Number(saved.chatScrollTop);
          const restoreChatScroll=()=>{const box=$('chatMessages');if(box)box.scrollTop=target;};
          setTimeout(restoreChatScroll,500);
        }
      }
    }));
  }catch(err){console.warn('Не удалось восстановить состояние страницы',err);}
}
window.addEventListener('scroll',()=>{
  const now=Date.now();
  if(now-lastUiSave<150)return;
  lastUiSave=now;saveUiState();
},{passive:true});
window.addEventListener('pagehide',saveUiState);
window.addEventListener('beforeunload',saveUiState);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveUiState();});
document.addEventListener('input',saveUiState,true);
document.addEventListener('change',saveUiState,true);
document.addEventListener('click',()=>{setTimeout(saveUiState,0)},true);

const THEME_MIGRATION_KEY='warehouse_graphite_theme_v1';
try{
  if(localStorage.getItem(THEME_MIGRATION_KEY)!=='done'){
    localStorage.setItem('ampTheme','dark');
    localStorage.setItem(THEME_MIGRATION_KEY,'done');
  }
}catch{}
const savedTheme=localStorage.getItem('ampTheme')||'dark';
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
  let knownNoticeIds=new Set(state.notices.map(n=>n.id));
  let initialSnapshot=true;
  // Only surface notifications created while this live listener is active.
  // Firestore can replay changes accumulated during sleep/offline; keep those in history, not as a toast flood.
  const listenerStartedAt=Date.now();
  const isFreshLiveNotice=n=>{
    const created=asDate(n.createdAt||n.at)?.getTime();
    return Number.isFinite(created)&&created>=listenerStartedAt-5000&&Date.now()-created<=60000;
  };
  const q=query(collection(db,'users',signedInUser.uid,'notifications'),orderBy('createdAt','desc'),limit(100));
  notificationsUnsubscribe=onSnapshot(q,snap=>{
    const next=snap.docs.map(d=>({id:d.id,...d.data(),at:d.data().createdAt||d.data().at||isoNow()}));
    if(!initialSnapshot){next.filter(n=>!knownNoticeIds.has(n.id)&&shouldShowAttentionToast(n)&&!n.read&&isFreshLiveNotice(n)).forEach(showAttentionToast)}
    initialSnapshot=false;
    knownNoticeIds=new Set(next.map(n=>n.id));state.notices=next;paintNotices();paintMentionCenter();
  },err=>console.error('Не удалось загрузить историю уведомлений',err));
}
function flagOn(n,key){return n?.[key]===true||n?.[key]==='true'||n?.[key]===1}
function isMentionNotice(n){const t=String(n?.title||'').toLocaleLowerCase('ru');return flagOn(n,'isMention')||t.includes('упомянули вас')||t.includes('вас упомянули')||n?.category==='mention'||(n?.category==='replies'&&n?.target==='chat'&&!flagOn(n,'isReply'))}
function shouldShowAttentionToast(n){return isMentionNotice(n)||flagOn(n,'isReply')||n?.category==='chat'}
function unreadMentionNotices(){return state.notices.filter(n=>!n.read&&isMentionNotice(n))}
function paintMentionCenter(){const b=$('mentionCenterButton'),c=$('mentionCenterCount'),l=$('mentionCenterLabel');if(!b||!c||!l)return;const n=unreadMentionNotices().length;c.textContent=String(n);b.hidden=n===0;l.textContent=n===1?'Вас упомянули':`У вас ${n} новых упоминания`}
const shownAttentionToastKeys=new Map();
function showAttentionToast(n){
  const now=Date.now();
  for(const [key,time] of shownAttentionToastKeys){if(now-time>15000)shownAttentionToastKeys.delete(key);}
  const sender=String(n.title||'Сотрудник');
  const message=String(n.message||n.body||'Откройте, чтобы посмотреть сообщение');
  const semanticKey='semantic:'+[`${n.target||''}`,sender,message,String(n.orderId||'')].join('|').toLocaleLowerCase('ru');
  const eventKey='event:'+String(n.eventId||n.id||semanticKey);
  if(shownAttentionToastKeys.has(eventKey)||shownAttentionToastKeys.has(semanticKey))return;
  shownAttentionToastKeys.set(eventKey,now);
  shownAttentionToastKeys.set(semanticKey,now);
  while(shownAttentionToastKeys.size>600)shownAttentionToastKeys.delete(shownAttentionToastKeys.keys().next().value);
  const heading=isMentionNotice(n)||flagOn(n,'isMention')?'Вас упомянули':flagOn(n,'isReply')?'Вам ответили':(n?.target==='chat'||n?.category==='chat')?'Новое сообщение в общем чате':'Новое сообщение';
  const t=toast(`${heading} · ${sender}: ${message}`,String(n.orderId||''));
  t.classList.add('mention-toast');t.setAttribute('role','button');t.tabIndex=0;
  t.setAttribute('aria-label',`${heading} от ${sender}. Открыть сообщение`);
  t.addEventListener('click',()=>openMentionNotice(n));
  t.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMentionNotice(n)}});
}
function openMentionNotice(n){if(n?.orderId){closeModal();openOrder(String(n.orderId));return}if(n?.target==='chat'||n?.category==='chat'||n?.category==='replies'){openChat();return}showNotifications()}
function openMentionCenter(){const items=unreadMentionNotices();if(!items.length){showNotifications();return}const body='<div class="mention-center-list">'+items.map(n=>'<button type="button" class="mention-center-item" data-mention-notice="'+esc(n.id)+'"><b>'+esc(n.title||'Вас упомянули')+'</b><span>'+esc(n.message||n.body||'Новое упоминание')+'</span><small>'+esc(fmtDateTime(n.createdAt||n.at))+'</small></button>').join('')+'</div>';showModal('Новые упоминания',body,[button('Все уведомления','show-notifications','small-button'),button('Закрыть','close')],'ВАС УПОМЯНУЛИ')}
function watchChatBadge(){
  chatBadgeUnsubscribe?.();
  if(!signedInUser)return;
  let initialSnapshot=true;
  let knownMessageIds=new Set();
  const listenerStartedAt=Date.now();
  const isFreshLiveMessage=m=>{
    const created=asDate(m.createdAt)?.getTime();
    return Number.isFinite(created)&&created>=listenerStartedAt-5000&&Date.now()-created<=60000;
  };
  const q=query(collection(db,'chatMessages'),orderBy('createdAt','desc'),limit(100));
  chatBadgeUnsubscribe=onSnapshot(q,snap=>{
    const messages=snap.docs.map(d=>({id:d.id,...(d.data()||{})}));
    if(!initialSnapshot){
      messages.filter(m=>!knownMessageIds.has(m.id)&&m.authorId&&m.authorId!==signedInUser.uid&&isFreshLiveMessage(m)).forEach(m=>{
        const messageText=String(m.text||m.message||m.content||'').trim()||'📷 Фото';
        const sender=chatDisplayName(m.authorName||m.author||m.userName||'Сотрудник');
        const mentionToken='@'+chatMentionToken(profileName||'');
        const isMention=!!profileName&&messageText.toLocaleLowerCase('ru').includes(mentionToken.toLocaleLowerCase('ru'));
        showAttentionToast({
          id:'chat-message:'+m.id,
          title:sender,
          message:messageText.slice(0,300),
          target:'chat',
          category:'chat',
          isReply:!!m.replyToId,
          isMention
        });
      });
    }
    initialSnapshot=false;
    knownMessageIds=new Set(messages.map(m=>m.id));
    knownChatPeople=[...new Map(messages.filter(m=>m.authorId&&m.authorName).map(m=>[m.authorId,{id:m.authorId,name:chatDisplayName(m.authorName)}])).values()];
    chatUnread=messages.some(m=>m.authorId!==signedInUser.uid && Array.isArray(m.readBy) && !m.readBy.includes(signedInUser.uid));
    paintChatBadge();
  },err=>console.error('Не удалось проверить непрочитанный чат',err));
}
function chatUnreadIndicatorMode(){return signedInUser&&localStorage.getItem('warehouse_chat_indicator_'+signedInUser.uid)==='bell'?'bell':'dot'}
function paintChatBadge(){const button=$('chatSidebarButton');if(!button)return;const unread=!!chatUnread;button.classList.toggle('has-unread-chat',unread&&chatUnreadIndicatorMode()==='dot');button.classList.toggle('has-unread-chat-bell',unread&&chatUnreadIndicatorMode()==='bell');}
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

let authRevealTimer=null;
function finishInitialLoading(){if(authRevealTimer!==null){clearTimeout(authRevealTimer);authRevealTimer=null;}document.documentElement.classList.add('app-booted');const loader=$('siteLoader');if(loader){loader.classList.add('site-loader-hidden');setTimeout(()=>{if(loader.classList.contains('site-loader-hidden'))loader.hidden=true;},260);}}
function showAuth(message='Войдите с рабочей учётной записью.'){ $('authGate').hidden=false;document.querySelector('.app-shell').hidden=true;$('authMessage').textContent=message;const loader=$('siteLoader');if(loader&&!loader.hidden&&!loader.classList.contains('site-loader-hidden')){if(authRevealTimer!==null)clearTimeout(authRevealTimer);authRevealTimer=setTimeout(()=>{authRevealTimer=null;if(!$('authGate').hidden&&document.querySelector('.app-shell').hidden)finishInitialLoading();},1800);}else{finishInitialLoading();} }
function hideAuth(){ finishInitialLoading();$('authGate').hidden=true;document.querySelector('.app-shell').hidden=false }
// Keep the existing screen and state when returning to an already-open app.
// The startup loader is reserved for a fresh page launch only.
function entryToCloud(e){
  const out={
    kind:e.kind,
    article:e.article||'',
    text:e.text||'',
    important:e.important===true,
    authorId:e.authorId||auth.currentUser.uid,
    authorName:e.author||profileName,
    createdAt:e.createdAt,
    photos:Array.isArray(e.photos)?e.photos.filter(p=>typeof p==='string'):[]
  };
  for(const k of ['decision','decisionText','decidedBy','decidedByName','decidedAt','articleIndex','replyToEntryId','replyToAuthorId','replyToAuthorName','replyToText']){
    if(e[k]!==undefined)out[k]=e[k];
  }
  return out;
}function entryFromCloud(id,d){return{id,kind:d.kind,article:d.article||'',text:d.text||'',authorId:d.authorId,author:d.authorName||'Сотрудник',createdAt:d.createdAt,photos:d.photos||[],important:d.important===true,...Object.fromEntries(['decision','decisionText','decidedBy','decidedByName','decidedAt','articleIndex','replyToEntryId','replyToAuthorId','replyToAuthorName','replyToText'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]]))}}
function orderToCloud(o,isNew=false){return{number:o.number,client:o.client||'',deliveryType:['city','pickup','post'].includes(o.deliveryType)?o.deliveryType:'city',status:o.status,...(o.returnCancelled===true?{returnCancelled:true}:{}),articles:Array.isArray(o.articles)?o.articles.map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1),collected:x.collected===true,shipmentChecked:x.shipmentChecked===true})).filter(x=>x.article):[],createdAt:o.createdAt,createdBy:o.createdBy||auth.currentUser.uid,createdByName:o.author||profileName,updatedAt:o.updatedAt||o.createdAt,...(!isNew&&o.updatedBy?{updatedBy:o.updatedBy,updatedByName:o.updatedByName}:{}),...(o.transferredAt?{transferredAt:o.transferredAt}:{}),...(o.resumedAt?{resumedAt:o.resumedAt}:{}),...(o.assembledAt?{assembledAt:o.assembledAt}:{}),...(o.shippedAt?{shippedAt:o.shippedAt}:{}),...(typeof o.assemblyInProgress==='boolean'?{assemblyInProgress:o.assemblyInProgress}:{}),...(o.assemblyStartedAt?{assemblyStartedAt:o.assemblyStartedAt}:{}),...(o.assemblyStartedBy?{assemblyStartedBy:o.assemblyStartedBy}:{}),...(o.assemblyStartedByName?{assemblyStartedByName:o.assemblyStartedByName}:{}),...(Array.isArray(o.returns)?{returns:o.returns}:{} )}}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b)}
async function writeAudit(action,details='',orderId='',meta={}){
 if(!signedInUser)return;
 try{
  const id=String(orderId||'');
  const order=state.orders.find(o=>o.id===id);
  const orderNumber=String(meta.orderNumber||order?.number||'');
  const safeMeta={...meta};delete safeMeta.orderNumber;
  await setDoc(doc(db,'auditLog',crypto.randomUUID()),{action:String(action||'Действие'),details:String(details||''),orderId:id,...(orderNumber?{orderNumber}:{}),actorId:signedInUser.uid,actorName:profileName||roles[state.role]||'Сотрудник',actorRole:state.role,createdAt:isoNow(),...safeMeta});
 }catch(err){console.warn('Аудит не записан',err);}
}
async function save(){
 if(!signedInUser)return;
 let saveStage='подготовка изменений';
 try{
 const currentIds=new Set(state.orders.map(o=>o.id));
 let batch=writeBatch(db),batchWrites=0;
 const flushBatch=async()=>{if(batchWrites){await batch.commit();batch=writeBatch(db);batchWrites=0;}};
 const addBatchWrite=async write=>{
   if(batchWrites>=450)await flushBatch();
   write(batch);
   batchWrites++;
 };

 for(const o of state.orders){
   const pushTasks=[];
   const base=serverCache.get(o.id),newOrder=!base;
   const next=orderToCloud(o,newOrder),prev=base?orderToCloud(base):null;
   const orderChanged=!base||!equal(next,prev);
   const articlesChanged=!!base&&!articlesContentEqual(base.articles||[],o.articles||[]);

   if(orderChanged){
     if(base){
       next.updatedAt=isoNow();
       next.updatedBy=signedInUser.uid;
       next.updatedByName=profileName;
       o.updatedAt=next.updatedAt;
       o.updatedBy=next.updatedBy;
       o.updatedByName=profileName;
     }
     pendingWrites.add(o.id);
     pendingOrderData.set(o.id,{...o,number:next.number,client:next.client,status:next.status,articles:next.articles||[]});
     const orderRef=doc(db,'orders',o.id);
     saveStage='обновление документа заказа '+(o.number||o.id);
      await addBatchWrite(b=>newOrder?b.set(orderRef,next):b.update(orderRef,next));

     const normalizedArticles=normalizeArticles(o.articles||[]);
     const articleBody=normalizedArticles.length
       ?normalizedArticles.map(x=>`${x.article} × ${x.quantity}`).join(', ')
       :'Все артикулы удалены.';
     const newOrderBody=newOrder
       ?(o.articles?.length?`${o.client||'Создан новый заказ'} · ${articleBody}`:(o.client||'Создан новый заказ'))
       :articlesChanged?articleBody:`Статус: ${next.status}`;
     pushTasks.push(()=>queuePush(
       newOrder?`Новый заказ · ${o.client||'Клиент не указан'}`:articlesChanged?`Артикулы изменены · ${o.client||'Клиент не указан'}`:`Заказ изменён · ${o.client||'Клиент не указан'}`,
       newOrderBody,signedInUser.uid,o.id
     ));
   }

   const oldEntries=new Map((base?.entries||[]).map(e=>[e.id,e]));
   for(const e of o.entries||[]){
     const cloud=entryToCloud(e),old=oldEntries.get(e.id);
     if(!old||!equal(cloud,entryToCloud(old))){
       saveStage='сохранение записи истории '+e.id+' заказа '+(o.number||o.id);
        await addBatchWrite(b=>b.set(doc(db,'orders',o.id,'entries',e.id),cloud));
       if(!newOrder&&e.kind!=='viewed'&&e.kind!=='system'){
         const label=e.kind==='decision'?'Решение':e.kind==='defect'?'Дефект':e.kind==='question'?'Вопрос':'Комментарий';
         const body=e.kind==='decision'&&e.decision?`Решение: ${e.decision}. ${e.decisionText||e.text||''}`:e.text||label;
         pushTasks.push(()=>e.replyToEntryId&&e.replyToAuthorId?queuePush(profileName||roles[state.role],body,signedInUser.uid,o.id,'site','replies',e.replyToAuthorId):queuePush(`${o.client||'Клиент не указан'} · ${label}`,body,signedInUser.uid,o.id));
       }
       oldEntries.delete(e.id);
     }else oldEntries.delete(e.id);
   }

   if(state.role==='director'||canManageUsers){
     for(const removedId of oldEntries.keys()){
       await addBatchWrite(b=>b.delete(doc(db,'orders',o.id,'entries',removedId)));
       pushTasks.push(()=>queuePush(`${o.client||'Клиент не указан'} · заказ изменён`,'Запись из истории была удалена директором.',signedInUser.uid,o.id));
     }
   }

   // Persist the order and its changed history entries together, reducing
   // round-trips while ensuring push notifications are queued only after data commits.
   await flushBatch();
   await Promise.all(pushTasks.map(task=>task()));
   pendingWrites.delete(o.id);
   serverCache.set(o.id,{...(serverCache.get(o.id)||o),...o,articles:normalizeArticles(o.articles||[]),entries:[...(o.entries||[])]});
 }

 for(const [id,old] of serverCache){
   if(!currentIds.has(id)&&state.role==='director'){
     for(const e of old.entries||[])await addBatchWrite(b=>b.delete(doc(db,'orders',id,'entries',e.id)));
     await addBatchWrite(b=>b.delete(doc(db,'orders',id)));
     serverCache.delete(id);
   }
 }
 await flushBatch();
 }catch(err){
  console.error('Ошибка сохранения заказа на этапе «'+saveStage+'»: ',err);
  const code=String(err?.code||'').trim();
  const message=String(err?.message||'').trim();
  const details=code?code.replace(/^.*?\//,''):message;
  toast(details?'Не удалось сохранить: '+details:'Не удалось сохранить изменения. Проверьте доступ и соединение.');
  throw err;
 }
}
async function queuePush(title,body,authorId,orderId='',target='site',category='',recipientUserId='',attention={}){
  try{
    const normalizedCategory=category||(target==='chat'?'chat':'orders');
    await setDoc(doc(db,'pushQueue',crypto.randomUUID()),{
      title:String(title||'Заказы · Склад'),
      body:String(body||'Новое изменение в заказе.'),
      authorId,
      orderId:String(orderId||''),
      target:target==='chat'?'chat':'site',
      category:normalizedCategory,
      isMention:attention.isMention===true,
      isReply:attention.isReply===true,
      recipientUserId:String(recipientUserId||''),
      createdAt:isoNow(),
      sentAt:null
    });
    return true;
  }catch(err){
    console.error('Push event was not queued',err);
    const code=String(err?.code||'').replace(/^.*?\//,'');
    toast('Не удалось создать уведомление'+(code?' ('+code+')':'')+'. Проверьте подключение и правила Firebase.');
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

let lastPushTokenRefreshAt=0;
function refreshPushTokenOnResume(){
  if(!signedInUser||!('Notification' in window)||Notification.permission!=='granted')return;
  if(Date.now()-lastPushTokenRefreshAt<5*60*1000)return;
  lastPushTokenRefreshAt=Date.now();
  syncPushToken(false);
}
window.addEventListener('pageshow',refreshPushTokenOnResume);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshPushTokenOnResume();});

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
    const attention={...n,isMention:n.isMention==='true'||n.isMention===true,isReply:n.isReply==='true'||n.isReply===true};
    if(category==='mention'||category==='replies'||category==='chat'){showForegroundPushNotification(n);if(shouldShowAttentionToast(attention))showAttentionToast({...attention,id:eventId||signature})}
    notify(message,orderId,target,target==='chat'?'chat':'orders');
  }
});
function stopCloud(){profileUnsubscribe?.();ordersUnsubscribe?.();chatUnsubscribe?.();chatBadgeUnsubscribe?.();notificationsUnsubscribe?.();profileUnsubscribe=ordersUnsubscribe=chatUnsubscribe=chatBadgeUnsubscribe=notificationsUnsubscribe=null;for(const stop of entryUnsubscribes.values())stop();entryUnsubscribes.clear();serverCache.clear();state.orders=[];state.notices=[];paintMentionCenter()}
function watchOrders(){
 ordersUnsubscribe?.();
 ordersUnsubscribe=onSnapshot(collection(db,'orders'),snap=>{
   const oldIds=new Set(state.orders.map(o=>o.id)),remoteIds=new Set();
   let openedOrderStatusChanged=false;
   for(const d of snap.docs){remoteIds.add(d.id);const data=d.data(),prior=serverCache.get(d.id),pending=pendingOrderData.get(d.id);
     const existingOrder=state.orders.find(o=>o.id===d.id);
     if(existingOrder&&existingOrder.status!==data.status&&selectedId===d.id&&!modal.hidden&&modal.dataset.orderDetail===d.id)openedOrderStatusChanged=true;
     const order={id:d.id,number:pending?.number??data.number,client:pending?.client??(data.client||''),deliveryType:['city','pickup','post'].includes(data.deliveryType)?data.deliveryType:'city',status:pending?.status??data.status,returnCancelled:data.returnCancelled===true||(Array.isArray(data.returns)&&data.returns.some(r=>r?.status==='cancelled')),articles:pending?.articles??(Array.isArray(data.articles)?data.articles:[]),createdAt:data.createdAt,updatedAt:data.updatedAt,transferredAt:data.transferredAt,resumedAt:data.resumedAt,assembledAt:data.assembledAt,shippedAt:data.shippedAt,assemblyInProgress:data.assemblyInProgress===true,assemblyStartedAt:data.assemblyStartedAt,assemblyStartedBy:data.assemblyStartedBy,assemblyStartedByName:data.assemblyStartedByName,returns:Array.isArray(data.returns)?data.returns:[],author:data.createdByName||'Сотрудник',createdBy:data.createdBy,updatedBy:data.updatedBy,updatedByName:data.updatedByName,entries:prior?.entries||[],returns:Array.isArray(data.returns)?data.returns:[]};
     const at=state.orders.findIndex(o=>o.id===d.id);if(at<0)state.orders.push(order);else state.orders[at]={...order,entries:state.orders[at].entries||[]};serverCache.set(d.id,{...order,articles:(order.articles||[]).map(x=>({...x})),entries:(prior?.entries||[]).map(x=>({...x}))});
     if(!entryUnsubscribes.has(d.id)){let firstEntries=true;entryUnsubscribes.set(d.id,onSnapshot(collection(db,'orders',d.id,'entries'),es=>{const entries=es.docs.map(x=>entryFromCloud(x.id,x.data())).sort((a,b)=>(asDate(a.createdAt)?.getTime()||0)-(asDate(b.createdAt)?.getTime()||0)||String(a.id).localeCompare(String(b.id)));const item=state.orders.find(o=>o.id===d.id);if(!item)return;const before=JSON.stringify(item.entries||[]);item.entries=entries;serverCache.set(d.id,{...serverCache.get(d.id),entries:entries.map(x=>({...x}))});const entriesChanged=before!==JSON.stringify(entries);
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
   initialCloudLoad=false;render();restoreUiState();
   // Keep the open order card in sync when another employee changes its status.
   if(openedOrderStatusChanged&&selectedId&&!modal.hidden&&modal.dataset.orderDetail===selectedId)openOrder(selectedId);
   if(pendingNotificationOrderId){const target=pendingNotificationOrderId;pendingNotificationOrderId='';history.replaceState({},'',location.pathname+location.hash);if(state.orders.some(o=>o.id===target))openOrder(target);}
 },err=>{console.error(err);toast('Не удалось загрузить общую историю. Проверьте доступ к Firestore.')});
}
setPersistence(auth,browserLocalPersistence).then(()=>onAuthStateChanged(auth,user=>{
 stopCloud();signedInUser=user;initialCloudLoad=true;
 if(!user){showAuth();return}
 // Reuse the last verified profile for immediate display on mobile resume/reload.
 const profileCacheKey='warehouse_orders_profile_'+user.uid;
 let cachedProfile=null;
 try{const raw=localStorage.getItem(profileCacheKey);if(raw){const parsed=JSON.parse(raw);if(parsed&&parsed.active===true&&roles[parsed.role])cachedProfile=parsed;}}catch{}
 if(cachedProfile){
  // Keep the full-screen loader visible while Firebase validates the session and server profile.
  state.role=cachedProfile.role;canManageUsers=cachedProfile.admin===true||cachedProfile.role==='director';
  profileName=cachedProfile.displayName||user.email||roles[cachedProfile.role];
  state.notificationSettings={chat:cachedProfile.notificationSettings?.chat!==false,replies:cachedProfile.notificationSettings?.replies!==false,likes:cachedProfile.notificationSettings?.likes!==false,orders:cachedProfile.notificationSettings?.orders!==false};
  state.extraPhoneNotifications=cachedProfile.extraPhoneNotifications===true;
  $('userName').textContent=profileName;$('userRole').textContent=canManageUsers?`Администратор · ${roles[cachedProfile.role]}`:roles[cachedProfile.role];
  // The app is revealed only after the server profile is confirmed.
 }
 profileUnsubscribe=onSnapshot(doc(db,'users',user.uid),snap=>{
   if(!snap.exists()){showAuth('Учётная запись создана, но профиль не найден. Обратитесь к администратору.');$('authError').textContent=`UID: ${user.uid}`;return}
   const profile=snap.data();if(profile.active!==true||!roles[profile.role]){try{localStorage.removeItem(profileCacheKey)}catch{}showAuth('Доступ отключён или роль не назначена. Обратитесь к администратору.');return}
   try{localStorage.setItem(profileCacheKey,JSON.stringify(profile))}catch{}
   state.role=profile.role;canManageUsers=profile.admin===true||profile.role==='director';profileName=profile.displayName||user.email||roles[profile.role];state.notificationSettings={chat:profile.notificationSettings?.chat!==false,replies:profile.notificationSettings?.replies!==false,likes:profile.notificationSettings?.likes!==false,orders:profile.notificationSettings?.orders!==false};state.extraPhoneNotifications=profile.extraPhoneNotifications===true;$('userName').textContent=profileName;$('userRole').textContent=canManageUsers?`Администратор · ${roles[profile.role]}`:roles[profile.role];hideAuth();watchOrders();watchNotifications();watchChatBadge();watchClients();loadProductsCatalog();render();syncPushToken(false);if(window.AndroidWarehouse?.requestNativePushToken){window.AndroidWarehouse.requestNativePushToken();}if(pendingNotificationChat){pendingNotificationChat=false;history.replaceState({},'',location.pathname+location.hash);setTimeout(()=>openChat(),0);}
 },err=>{console.error(err);showAuth('Не удалось проверить профиль сотрудника. Проверьте правила доступа Firestore.')});
})).catch(err=>{console.error('Не удалось сохранить вход на этом устройстве',err);showAuth('Браузер не разрешил сохранить вход. Проверьте настройки приватности и хранения данных.');});
 $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('authError').textContent='';try{await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value)}catch(err){$('authError').textContent=err.code==='auth/invalid-credential'?'Неверная почта или пароль.':err.code==='auth/too-many-requests'?'Слишком много попыток. Попробуйте позже.':'Не удалось войти. Проверьте почту и пароль.'}});
 $('googleLoginButton').addEventListener('click',async()=>{ $('authError').textContent='';try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(err){console.error(err);$('authError').textContent=err.code==='auth/popup-closed-by-user'?'Окно входа закрыто.':'Не удалось войти через Google.'}});
function initials(name){return String(name).split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}
function notify(){paintNotices()}
function statusClass(s){return({'Собран':'status-assembled','Отгружен кладовщиком':'status-shipped','Ожидает оплаты':'status-payment','Под вопросом':'status-question','Дефект':'status-defect','На согласовании':'status-approval','Одобрен на отгрузку клиенту':'status-ready','Ожидает самовывоза':'status-pickup-waiting','Клиент забрал самовывозом':'status-pickup-done','Самовывоз':'status-pickup-waiting','Перенесен':'status-transferred','Отменён':'status-cancel'})[s]||'status-neutral'}
function statusPill(s){return `<span class="status-pill ${statusClass(s)}">${esc(s)}</span>`}
function assemblyIndicator(o){if(o?.assemblyInProgress!==true)return '';const startedBy=String(o.assemblyStartedByName||'Кладовщик');const startedAt=o.assemblyStartedAt?fmtDateTime(o.assemblyStartedAt):'';return `<span class="assembly-indicator" title="Сборку начал: ${esc(startedBy)}${startedAt?' · '+esc(startedAt):''}"><span class="assembly-light"></span><span>Идёт сборка</span></span>`}
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
  const stuck=orders.filter(o=>['Создан','На согласовании','Ожидает оплаты','Ожидает самовывоза','Перенесен'].includes(o.status));
  const byStatus=new Map();
  orders.forEach(o=>byStatus.set(o.status,(byStatus.get(o.status)||0)+1));
  const statusRows=[...byStatus.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([s,n])=>'<div class="analytics-status-row"><span>'+statusPill(s)+'</span><b>'+n+'</b></div>').join('');
  const assembledToday=orders.filter(o=>o.status==='Собран'&&localDateKey(o.assembledAt||o.updatedAt)===todayKey).length;
  const shippedToday=orders.filter(o=>o.status==='Отгружен кладовщиком'&&localDateKey(o.shippedAt||o.updatedAt)===todayKey).length;
  const shippedUniqueArticlesToday=new Set(orders.filter(o=>o.status==='Отгружен кладовщиком'&&localDateKey(o.shippedAt||o.updatedAt)===todayKey).flatMap(o=>(o.articles||[]).map(x=>String(x.article||'').trim().toUpperCase()).filter(Boolean))).size;
  const body='<div class="analytics-grid">'+
    '<div class="analytics-kpi"><span>Заказов сегодня</span><b>'+today.length+'</b><small>за текущую дату</small></div>'+
    '<div class="analytics-kpi"><span>Заказов за 7 дней</span><b>'+week.length+'</b><small>по дате обработки</small></div>'+
    '<div class="analytics-kpi"><span>Собрано сегодня</span><b>'+assembledToday+'</b><small>за текущую дату</small></div>'+
    '<div class="analytics-kpi"><span>Отгружено сегодня</span><b>'+shippedToday+'</b><small>за текущую дату</small></div>'+'<div class="analytics-kpi"><span>Уникальных артикулов отгружено</span><b>'+shippedUniqueArticlesToday+'</b><small>сегодня, без повторов</small></div>'+
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
function showReturns(dateFrom='',dateTo=''){
  const inPeriod=r=>{const day=localDateKey(r.createdAt);return (!dateFrom||day>=dateFrom)&&(!dateTo||day<=dateTo);};
  // Вкладка показывает только действующие возвраты. Отменённые остаются в истории заказа.
  const orders=state.orders.filter(o=>Array.isArray(o.returns)&&o.returns.some(r=>r?.status!=='cancelled'&&inPeriod(r))).sort((a,b)=>(asDate(b.updatedAt||b.createdAt)?.getTime()||0)-(asDate(a.updatedAt||a.createdAt)?.getTime()||0));
  const all=orders.flatMap(order=>order.returns.filter(r=>r?.status!=='cancelled'&&inPeriod(r)).map(r=>({order,return:r})));
  const totalItems=all.reduce((sum,x)=>sum+(x.return.items||[]).reduce((n,it)=>n+(Number(it.quantity)||0),0),0);
  const rows=orders.length?orders.map(o=>{
    const records=o.returns.filter(r=>r?.status!=='cancelled'&&inPeriod(r));
    const returnsHtml=records.map(r=>{
      const cancelButton=canManageUsers?button('Отменить возврат','cancel-return:'+o.id+':'+r.id,'small-button danger'):'';
      return '<article class="timeline-item"><div class="timeline-top"><span><b>'+fmtDateTime(r.createdAt)+'</b> · '+esc(r.author||'Сотрудник')+'</span><span class="timeline-type">ВОЗВРАТ</span></div><div class="timeline-text">'+(r.items||[]).map(it=>esc(it.article)+' × '+(Number(it.quantity)||0)+' шт.').join('<br>')+(r.reason?'<br><span style="color:#89919d">Причина: '+esc(r.reason)+'</span>':'')+'</div>'+cancelButton+'</article>';
    }).join('');
    return '<section class="timeline-item"><div class="timeline-top"><span><b>Заказ № '+esc(o.number)+'</b></span><span class="timeline-type">'+esc(o.status||'')+'</span></div><div class="timeline-article">'+esc(o.client||'')+'</div><div class="timeline">'+returnsHtml+'</div><div style="margin-top:10px">'+button('Открыть заказ','open-return-order:'+o.id,'small-button primary-soft')+'</div></section>';
  }).join(''):'<div class="danger-note">За выбранный период действующих возвратов нет.</div>';
  showModal('Заказы с возвратами',`<div class="history-controls" style="margin-bottom:14px"><label class="search-box"><span>С</span><input id="returnsDateFrom" type="date" value="${dateFrom}" aria-label="Дата от"></label><label class="search-box"><span>По</span><input id="returnsDateTo" type="date" value="${dateTo}" aria-label="Дата по"></label><button type="button" class="small-button primary-soft" data-action="returns-date">Показать</button></div><div class="analytics-kpi" style="margin-bottom:14px"><span>Заказов: ${orders.length} · действующих возвратов: ${all.length}</span><b>${totalItems}</b><small>шт. по действующим возвратам</small></div><div class="timeline">${rows}</div>`,[button('Закрыть','close')],'ВОЗВРАТЫ');
}
async function cancelReturnAction(orderId,returnId){
  if(!canManageUsers){toast('Отменить возврат может только администратор или директор.');return;}
  const o=state.orders.find(x=>x.id===orderId),r=o?.returns?.find(x=>x.id===returnId);
  if(!o||!r||r.status==='cancelled'){toast('Возврат уже отменён или не найден.');return;}
  if(!confirm('Отменить возврат по заказу № '+o.number+'? Все позиции этого возврата снова станут доступными.'))return;
  const oldReturns=JSON.parse(JSON.stringify(o.returns||[]));
  const cancelledAt=isoNow();
  const nextReturns=oldReturns.map(item=>item.id===returnId?{...item,status:'cancelled',cancelledAt,cancelledBy:signedInUser.uid,cancelledByName:profileName||'Администратор'}:item);
  const hasOtherActive=nextReturns.some(item=>item.status!=='cancelled');
  const restoredStatus=hasOtherActive?'Возврат':(r.previousStatus||'Собран');
  try{
    await updateDoc(doc(db,'orders',o.id),{returns:nextReturns,status:restoredStatus,returnCancelled:true,updatedAt:cancelledAt,updatedBy:signedInUser.uid,updatedByName:profileName||''});
    o.returns=nextReturns;o.status=restoredStatus;o.returnCancelled=true;o.updatedAt=cancelledAt;o.updatedBy=signedInUser.uid;o.updatedByName=profileName||'';
    serverCache.set(o.id,{...o,returns:JSON.parse(JSON.stringify(nextReturns)),status:restoredStatus,returnCancelled:true,entries:[...(o.entries||[])]});
    await writeAudit('Возврат отменён','Отменён возврат по заказу № '+o.number,o.id,{previousStatus:'Возврат',newStatus:restoredStatus});
    toast(hasOtherActive?'Возврат отменён. Остались другие действующие возвраты.':'Возврат отменён. Заказ восстановлен до статуса «'+restoredStatus+'».');
    if(hasOtherActive)showReturns($('returnsDateFrom')?.value||'',$('returnsDateTo')?.value||'');else{closeModal();render();}
  }catch(err){
    console.error('Не удалось сохранить отмену возврата',err);
    toast('Не удалось отменить возврат: '+String(err?.code||'ошибка').replace(/^.*?\//,''));
  }
}
let transferredInsightsExpanded=false;
function notificationTone(n){
  const cat=n.category||(n.target==='chat'?'chat':'orders');
  return cat==='chat'?'blue':cat==='replies'?'violet':cat==='likes'?'pink':'green';
}
function render(){const search=$('searchInput').value.toLocaleLowerCase('ru');const dateFrom=$('dateFromFilter')?.value||'';const dateTo=$('dateToFilter')?.value||'';const statusPriority={'Создан':0,'Собран':1,'На согласовании':2,'Под вопросом':3,'Дефект':4,'Ожидает оплаты':5,'Одобрен на отгрузку клиенту':6,'Ожидает самовывоза':7,'Самовывоз':7,'Перенесен':8,'Отгружен кладовщиком':9,'Клиент забрал самовывозом':10,'Отменён':11};const dateValue=o=>o?.status==='Перенесен'?(o.createdAt||o.transferredAt||o.updatedAt):orderDisplayDate(o);const compareOrders=(a,b)=>{const dayA=localDateKey(dateValue(a)),dayB=localDateKey(dateValue(b));if(dayA!==dayB)return dayB.localeCompare(dayA);const pA=statusPriority[a.status]??8,pB=statusPriority[b.status]??8;if(pA!==pB)return pA-pB;return new Date(orderDisplayDate(b)||0)-new Date(orderDisplayDate(a)||0)};let orders=[...state.orders].sort((a,b)=>{const aTransferred=a.status==='Перенесен',bTransferred=b.status==='Перенесен';if(aTransferred!==bTransferred)return aTransferred?-1:1;if(aTransferred&&bTransferred){const d=localDateKey(a.createdAt||a.transferredAt||a.updatedAt).localeCompare(localDateKey(b.createdAt||b.transferredAt||b.updatedAt));return d||new Date(a.createdAt||a.transferredAt||0)-new Date(b.createdAt||b.transferredAt||0)}return compareOrders(a,b)});if(activeFilter!=='all')orders=orders.filter(o=>o.status===activeFilter);if(search)orders=orders.filter(o=>orderSearchText(o).includes(search));if(dateFrom||dateTo)orders=orders.filter(o=>isDateInRange(o,dateFrom,dateTo));const hasDateFilter=!!(dateFrom||dateTo);$('clearDateButton').hidden=!hasDateFilter;const filteredOrderCount=orders.length;const pageCount=Math.max(1,Math.ceil(filteredOrderCount/ordersPageSize));currentOrdersPage=Math.max(1,Math.min(currentOrdersPage,pageCount));const pageOrders=orders.slice((currentOrdersPage-1)*ordersPageSize,currentOrdersPage*ordersPageSize);const rows=[];let previousDate='',previousSection='';for(const o of pageOrders){const transferred=o.status==='Перенесен';const displayDate=transferred?(o.createdAt||o.transferredAt||o.updatedAt||o.createdAt):orderDisplayDate(o);const day=localDateKey(displayDate);const section=transferred?'transferred':'current';if(section!==previousSection){rows.push(`<tr class="date-separator ${transferred?'transferred-date-separator':'current-date-separator'}"><td colspan="7"><span>${transferred?'Перенесённые заказы · дата создания':'Текущие заказы · по дням'}</span></td></tr>`);previousSection=section;previousDate=''}if(day!==previousDate){rows.push(`<tr class="date-separator"><td colspan="7"><span>${esc(fmtDate(displayDate))}</span></td></tr>`);previousDate=day}rows.push(`<tr data-order="${esc(o.id)}" class="${transferred?'transferred-order-row':''}"><td><a class="order-number" href="#" data-open="${esc(o.id)}">№ ${esc(o.number)}</a><span class="client-sub">создал ${esc(o.author||'Кладовщик')}</span></td><td><a class="client-name client-open" href="#" data-open="${esc(o.id)}">${esc(o.client)}</a><span class="client-sub">${fmtDateTime(displayDate)}</span></td><td><button type="button" class="row-open-status" data-open="${esc(o.id)}" title="Открыть заказ">${statusPill(o.status)}</button>${assemblyIndicator(o)}</td><td><button type="button" class="delivery-type-pill" data-open="${esc(o.id)}" title="Открыть карточку заказа"><span class="delivery-type-icon" aria-hidden="true">${o.deliveryType==='pickup'?'♧':o.deliveryType==='post'?'✉':'↗'}</span><span>${o.deliveryType==='pickup'?'Самовывоз':o.deliveryType==='post'?'Доставка почтой':'Доставка по городу'}</span></button></td><td><button type="button" class="row-open-comments" data-open="${esc(o.id)}" title="Открыть заказ"><span class="comment-icon">💬</span><span class="entry-count">${entriesCount(o)}</span></button></td><td class="time-cell">${fmtDate(displayDate)}</td><td><button class="row-menu" title="Открыть карточку" data-open="${esc(o.id)}">···</button></td></tr>`)}$('ordersBody').innerHTML=rows.join('');const empty=orders.length===0;$('emptyState').classList.toggle('visible',empty);$('ordersBody').style.display=empty?'none':'';$('statTotal').textContent=state.orders.filter(o=>o.status==='Собран').length;$('statCreated').textContent=state.orders.filter(o=>o.status==='Создан').length;$('statQuestions').textContent=state.orders.filter(o=>o.status==='Под вопросом').length;$('statApproval').textContent=state.orders.filter(o=>o.status==='На согласовании').length;$('statReady').textContent=state.orders.filter(o=>o.status==='Одобрен на отгрузку клиенту').length;$('statPayment').textContent=state.orders.filter(o=>o.status==='Ожидает оплаты').length;$('statPickup').textContent=state.orders.filter(o=>o.status==='Ожидает самовывоза').length;$('statTransferred').textContent=state.orders.filter(o=>o.status==='Перенесен').length;$('listSummary').textContent=`${filteredOrderCount} ${plural(filteredOrderCount,'заказ','заказа','заказов')}`;const pagination=$('ordersPagination');if(pagination){const first=filteredOrderCount?(currentOrdersPage-1)*ordersPageSize+1:0;const last=Math.min(currentOrdersPage*ordersPageSize,filteredOrderCount);pagination.innerHTML=`<button type="button" class="secondary-button" data-orders-page="prev" ${currentOrdersPage<=1?'disabled':''}>← Назад</button><span>Страница ${currentOrdersPage} из ${pageCount} · ${first}–${last} из ${filteredOrderCount}</span><button type="button" class="secondary-button" data-orders-page="next" ${currentOrdersPage>=pageCount?'disabled':''}>Вперёд →</button>`;pagination.hidden=filteredOrderCount<=ordersPageSize;}$('userName').textContent=profileName||roles[state.role];$('userRole').textContent=canManageUsers?`Администратор · ${roles[state.role]}`:roles[state.role];$('modeLabel').textContent='Вы онлайн';$('modeSub').textContent='Подключено к облаку';$('today').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'long'}).format(new Date());document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.filter===activeFilter));paintNotices();syncPendingDefectToasts()}
function plural(n,a,b,c){n=Math.abs(n)%100;const d=n%10;return n>10&&n<20?c:d>1&&d<5?b:d===1?a:c}
function toast(msg,orderId='',options={}){const t=document.createElement('div');t.className='toast'+(orderId?' toast-clickable':'');t.textContent=msg;if(orderId)t.addEventListener('click',()=>{if(!t.classList.contains('defect-toast'))t.remove();openOrder(orderId)});$('toastStack').append(t);if(!options.persistent)setTimeout(()=>t.remove(),3500);return t}
function syncPendingDefectToasts(){const stack=$('toastStack');if(!stack)return;const pending=state.orders.flatMap(o=>(o.entries||[]).filter(e=>e.kind==='defect'&&!e.decision).map(e=>({id:`${o.id}:${e.id}`,orderId:o.id,number:o.number,article:e.article})));const active=new Set(pending.map(x=>x.id));stack.querySelectorAll('.defect-toast[data-defect-key]').forEach(t=>{if(!active.has(t.dataset.defectKey))t.remove()});for(const d of pending){if(stack.querySelector(`[data-defect-key="${CSS.escape(d.id)}"]`))continue;const t=toast(`⚠️ ДЕФЕКТ · Заказ № ${d.number} · ${d.article||'Артикул не указан'} — ожидает решения`,d.orderId,{persistent:true});t.classList.add('defect-toast');t.dataset.defectKey=d.id;t.setAttribute('role','button');t.tabIndex=0;t.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openOrder(d.orderId)}})}}
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
function articleRowHtml(item={article:'',quantity:1,collected:false}){return `<div class="order-article-row"><input class="order-article-input" value="${esc(item.article||'')}" placeholder="Артикул" autocomplete="off"><div class="article-suggestions" hidden></div><input class="order-article-qty" type="number" min="1" step="1" value="${Math.max(1,Number(item.quantity)||1)}" aria-label="Количество"><button type="button" class="small-button danger article-remove" data-action="remove-order-article" title="Удалить">×</button></div>`}
function articlesEditorHtml(items=[]){return `<div class="article-editor" id="orderArticlesEditor"><div class="article-editor-head"><span>Артикул</span><span>Количество</span><span></span></div><div id="orderArticlesRows">${items.map(articleRowHtml).join('')}</div><button type="button" class="secondary-button article-add" data-action="add-order-article">＋ Добавить артикул</button></div>`}
function readArticles(){return [...document.querySelectorAll('#orderArticlesRows .order-article-row')].map(row=>({article:row.querySelector('.order-article-input')?.value.trim()||'',quantity:Math.max(1,Number(row.querySelector('.order-article-qty')?.value)||1)})).filter(x=>x.article)}
function normalizeArticles(items=[]){return items.map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1),collected:x.collected===true,shipmentChecked:x.shipmentChecked===true})).filter(x=>x.article)}
const hasPendingDefect=o=>Array.isArray(o?.entries)&&o.entries.some(e=>e.kind==='defect'&&!e.decision);
function articlesEqual(a=[],b=[]){return JSON.stringify(normalizeArticles(a).map(x=>({article:x.article,quantity:x.quantity})))===JSON.stringify(normalizeArticles(b).map(x=>({article:x.article,quantity:x.quantity})))}
function articlesContentEqual(a=[],b=[]){return JSON.stringify((a||[]).map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1)})).filter(x=>x.article))===JSON.stringify((b||[]).map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1)})).filter(x=>x.article))}
function parseOrderClipboardText(raw){
  const text=String(raw||'').replace(/\u00a0/g,' ').replace(/\r/g,'');
  const result={number:'',client:'',articles:[]};
  const numberMatch=text.match(/Замовлення\s+покупця\s*№\s*([^|\n\r]+)/i)||text.match(/Заказ\s*(?:покупателя)?\s*№\s*([^|\n\r]+)/i);
  if(numberMatch)result.number=numberMatch[1].replace(/[*]/g,'').trim().split(/\s+/)[0];

  const lines=text.split('\n');
  for(const line of lines){
    if(!/Покупець|Покупатель/i.test(line))continue;
    const cells=line.split('|').map(x=>x.replace(/[*]/g,'').trim()).filter(Boolean);
    const labelIndex=cells.findIndex(x=>/Покупець|Покупатель/i.test(x));
    if(labelIndex<0)continue;
    const labelCell=cells[labelIndex];
    const inlineValue=labelCell.replace(/^.*?(?:Покупець|Покупатель)\s*:?\s*/i,'').trim();
    if(inlineValue){result.client=inlineValue;break;}
    const nextCell=cells.slice(labelIndex+1).find(x=>x&&!/^(Тел\.?|Телефон|ІПН|ЄДРПОУ|Адреса)\s*:/i.test(x));
    if(nextCell){result.client=nextCell.replace(/^\*+|\*+$/g,'').trim();break;}
  }
  if(!result.client){
    const clientMatch=text.match(/(?:Покупець|Покупатель)\s*:\s*\*{0,2}([^|\n\r*]+?)\*{0,2}(?=\s*(?:\||$))/i);
    if(clientMatch)result.client=clientMatch[1].trim();
  }

  const cleanCell=x=>String(x||'').replace(/[*]/g,'').trim();
  const splitRow=line=>{
    if(line.includes('|'))return line.split('|').map(cleanCell);
    if(line.includes('\t'))return line.split('\t').map(cleanCell);
    return null;
  };
  const isArticleHeader=x=>/артикул|код\s*(?:товару|товара|запчасти)?|article/i.test(x);
  const isDescriptionHeader=x=>/^(?:товар|номенклатура|наименование|назва|опис|описание|деталь|product|description)$/i.test(x.trim());
  const isQuantityHeader=x=>/кількість|кол-?\s*во|количество|quantity|к-сть/i.test(x);
  const rows=lines.map(line=>({line,cells:splitRow(line)})).filter(row=>row.cells);
  let headerRow=null, articleIndex=-1, descriptionIndex=-1, quantityIndex=-1;
  for(const row of rows){
    const a=row.cells.findIndex(isArticleHeader);
    const q=row.cells.findIndex(isQuantityHeader);
    if(a>=0&&q>=0){headerRow=row;articleIndex=a;descriptionIndex=row.cells.findIndex((cell,i)=>i!==a&&isDescriptionHeader(cell));quantityIndex=q;break;}
  }
  if(headerRow){
    let passedHeader=false;
    for(const row of rows){
      if(row===headerRow){passedHeader=true;continue;}
      if(!passedHeader)continue;
      if(/Разом:|Всього найменувань|У тому числі|Всього до сплати|Итого:|Разом по/i.test(row.line))break;
      if(row.cells.every(x=>/^:?-{2,}:?$/.test(x)||!x))continue;
      const articleCode=cleanCell(row.cells[articleIndex]);
      if(!articleCode||isArticleHeader(articleCode)||/^(товар|кількість|кол-?\s*во|количество)$/i.test(articleCode))continue;
      const description=descriptionIndex>=0?cleanCell(row.cells[descriptionIndex]):'';
      const article=description&&description.toLocaleLowerCase('ru')!==articleCode.toLocaleLowerCase('ru')?articleCode+' '+description:articleCode;
      const qCell=cleanCell(row.cells[quantityIndex]);
      const qMatch=qCell.match(/\d+(?:[.,]\d+)?/);
      const quantity=Math.max(1,parseInt(qMatch?qMatch[0].replace(',','.'): '1',10)||1);
      result.articles.push({article,quantity});
    }
  }

  // Fallback for copied invoices where the article column has no recognizable heading.
  // Keep each source row as a separate order position; never merge rows by article.
  if(!result.articles.length){
    for(const row of rows){
      if(/Разом:|Всього найменувань|У тому числі|Всього до сплати|Итого:/i.test(row.line))break;
      if(/Замовлення покупця|Заказ покупателя|Покупець:|Покупатель:|Телефон:|Тел\.?\s*:/i.test(row.line))continue;
      if(row.cells.length<3||row.cells.every(x=>/^:?-{2,}:?$/.test(x)||!x))continue;
      const cells=row.cells.map(cleanCell);
      const articleIndexFallback=cells.findIndex(x=>/^(?:[A-ZА-ЯІЇЄ]{1,5}[-_]?)?\d{4,12}[A-ZА-ЯІЇЄ0-9_-]*$/i.test(x));
      if(articleIndexFallback<0)continue;
      const articleCode=cells[articleIndexFallback];
      const description=cells.slice(articleIndexFallback+1).find(x=>x&&!/^\d+(?:[.,]\d+)?$/.test(x)&&!/^(?:грн|uah|шт\.?|од\.?|pcs)$/i.test(x))||'';
      const article=description?articleCode+' '+description:articleCode;
      // Quantity is usually the first small integer after the article/product columns,
      // while prices/totals are commonly larger numeric values.
      const later=cells.slice(articleIndexFallback+1);
      const quantityCell=later.find(x=>/^\d+(?:[.,]\d+)?$/.test(x)&&Number(x.replace(',','.'))>0&&Number(x.replace(',','.'))<=999);
      const quantity=Math.max(1,parseInt(quantityCell||'1',10)||1);
      result.articles.push({article,quantity});
    }
  }
  result.articles=result.articles.slice(0,100);
  return result;
}
function applyParsedOrderData(parsed){
  if(!parsed)return;
  if(parsed.number&&$('orderNumber'))$('orderNumber').value=parsed.number;
  if(parsed.client&&$('clientName'))$('clientName').value=parsed.client;
  const rows=$('orderArticlesRows');
  if(rows&&parsed.articles?.length)rows.innerHTML=parsed.articles.map(articleRowHtml).join('');
  const parts=[];
  if(parsed.number)parts.push('№ '+parsed.number);
  if(parsed.client)parts.push(parsed.client);
  if(parsed.articles?.length)parts.push(parsed.articles.length+' поз.');
  toast(parts.length?'Данные из документа распознаны: '+parts.join(' · '):'Не удалось найти данные заказа в тексте.');
}
function openNewOrder(){
  loadProductsCatalog();
  if(!['warehouse','manager','chief_accountant','accountant'].includes(state.role)&&!canManageUsers){toast('Создавать карточки может только кладовщик, менеджер или администратор.');return}
  const managerCreate=isManagerRole()&&!canManageUsers;
  const statusOptions=managerCreate?'<option value="Создан">Создан</option><option>Под вопросом</option>':'<option value="Создан">Создан</option><option>Собран</option><option>Под вопросом</option>';
  const statusHint=managerCreate?'Менеджер создаёт заказ со статусом «Создан». Кладовщик позже отметит его как «Собран».':'Можно сразу отметить заказ как «Собран», если он уже собран.';
  const body=`<form id="newOrderForm">
    <div class="order-import-box">
      <div class="order-import-head"><div><b>⚡ Заполнить из документа</b><span>Вставьте скопированный текст накладной — номер, клиента и артикулы распознаются автоматически.</span></div><button type="button" class="small-button" id="parseOrderClipboard">Разобрать</button></div>
      <textarea id="orderClipboardText" class="order-import-textarea" placeholder="Скопируйте сюда текст заказа…"></textarea>
    </div>
    <div class="form-grid"><div class="field"><label for="orderNumber">Номер заказа *</label><input id="orderNumber" required placeholder="Например, ЗК-18472" autocomplete="off"></div><div class="field client-suggestion-wrap"><label for="clientName">Имя клиента *</label><input id="clientName" required placeholder="Имя или название компании" autocomplete="off"><div id="clientNameSuggestions" class="chat-mention-suggestions client-suggestions" hidden></div></div></div>
    <div class="field"><label for="deliveryType">Вид доставки</label><select id="deliveryType"><option value="city">Доставка по городу</option><option value="post">Доставка почтой</option><option value="pickup">Самовывоз</option></select></div>
    <div class="field"><label>Артикулы заказа</label>${articlesEditorHtml([{article:'',quantity:1}])}<span class="field-hint">Для каждого артикула укажите количество. Можно добавлять и удалять позиции.</span></div>
    <div class="field"><label for="startStatus">Начальный статус</label><select id="startStatus">${statusOptions}</select><span class="field-hint">${statusHint}</span></div>
    <div class="field"><label for="initialComment">Комментарий (необязательно)</label><textarea id="initialComment" placeholder="Короткая заметка по заказу"></textarea></div>
  </form>`;
  showModal('Добавить заказ',body,[button('Отмена','close'),button('Создать карточку','create-order','primary-button')],'НОВЫЙ ЗАКАЗ');
  setTimeout(()=>{
    const input=$('orderClipboardText'),parse=$('parseOrderClipboard');
    if(!input||!parse)return;
    const run=()=>applyParsedOrderData(parseOrderClipboardText(input.value));
    parse.addEventListener('click',run);
    input.addEventListener('paste',()=>setTimeout(run,0));
  },0);
}
/* ===== Справочники клиентов и артикулов ===== */
let clients=[], productsCatalog=[], clientsUnsubscribe=null, productsLoaded=false;

function watchClients(){
  clientsUnsubscribe?.();
  if(!signedInUser)return;
  clientsUnsubscribe=onSnapshot(query(collection(db,'clients'),orderBy('name')),snap=>{
    clients=snap.docs.map(d=>({id:d.id,...d.data()}));
  },err=>console.warn('Не удалось загрузить клиентов',err));
}

async function loadProductsCatalog(){
  if(productsLoaded||!signedInUser)return;
  try{
    const cached=sessionStorage.getItem('warehouse_products_cache');
    if(cached){
      const parsed=JSON.parse(cached);
      if(Array.isArray(parsed)&&parsed.length){productsCatalog=parsed;productsLoaded=true;return;}
    }
  }catch{}
  try{
    const snap=await getDocs(collection(db,'products'));
    const chunks=snap.docs.filter(d=>d.id.startsWith('chunk-')).sort((a,b)=>a.id.localeCompare(b.id));
    productsCatalog=chunks.flatMap(d=>Array.isArray(d.data()?.items)?d.data().items:[]);
    productsLoaded=true;
    try{sessionStorage.setItem('warehouse_products_cache',JSON.stringify(productsCatalog));}catch{}
  }catch(err){console.warn('Не удалось загрузить базу артикулов',err);}
}

function productSearch(text){
  const q=String(text||'').trim().toLocaleLowerCase('ru');
  if(q.length<2)return [];
  const exact=[], starts=[], other=[];
  for(const p of productsCatalog){
    const a=String(p.a||'').toLocaleLowerCase('ru'), o=String(p.o||'').toLocaleLowerCase('ru');
    if(a===q||o.split(',').map(x=>x.trim().toLocaleLowerCase('ru')).includes(q)) exact.push(p);
    else if(a.startsWith(q)||o.split(',').some(x=>x.trim().toLocaleLowerCase('ru').startsWith(q))) starts.push(p);
    else if((p.n||'').toLocaleLowerCase('ru').includes(q)||(p.b||'').toLocaleLowerCase('ru').includes(q)) other.push(p);
  }
  return [...exact,...starts,...other].slice(0,8);
}

function clientSearch(text){
  const q=String(text||'').trim().toLocaleLowerCase('ru');
  if(q.length<1)return [];
  return clients.filter(c=>String(c.name||'').toLocaleLowerCase('ru').includes(q)||String(c.phone||'').toLocaleLowerCase('ru').includes(q)).slice(0,8);
}

function showClientSuggestions(inputId,boxId){
  const input=$(inputId),box=$(boxId);if(!input||!box)return;
  const items=clientSearch(input.value);
  if(!items.length){box.hidden=true;box.innerHTML='';return;}
  box.innerHTML=items.map(c=>'<button type="button" class="client-suggestion" data-client-suggestion="'+esc(c.id)+'"><b>'+esc(c.name)+'</b><small>'+esc(c.phone||c.email||'')+'</small></button>').join('');
  box.hidden=false;
}
function chooseClientSuggestion(inputId,boxId,id){
  const c=clients.find(x=>x.id===id);if(!c)return;
  const input=$(inputId);if(input){input.value=c.name||'';input.dataset.clientId=c.id;}
  const box=$(boxId);if(box)box.hidden=true;
}
function showArticleSuggestions(input){
  const row=input?.closest('.order-article-row');if(!row)return;
  let box=row.querySelector('.article-suggestions');
  if(!box){box=document.createElement('div');box.className='article-suggestions';row.appendChild(box);}
  const items=productSearch(input.value);
  if(!items.length){box.hidden=true;box.innerHTML='';return;}
  box.innerHTML=items.map(p=>'<button type="button" class="article-suggestion" data-product-article="'+esc(p.a)+'"><b>'+esc(p.a)+'</b><small>'+esc([p.m,p.b,p.n].filter(Boolean).join(' · ').slice(0,180))+'</small></button>').join('');
  box.hidden=false;
}
function chooseArticleSuggestion(button){
  const row=button.closest('.order-article-row'),input=row?.querySelector('.order-article-input');if(!input)return;
  input.value=button.dataset.productArticle||'';input.focus();
  row.querySelector('.article-suggestions')?.remove();
}

function directoryActions(){
  document.querySelectorAll('.directory-modal').forEach(x=>x.classList.remove('directory-modal'));
}
async function openClientCardByName(name){
  const target=String(name||'').trim();
  if(!target)return;
  let matches=(Array.isArray(clients)?clients:[]).filter(c=>String(c.name||'').trim().toLocaleLowerCase('ru')===target.toLocaleLowerCase('ru'));
  try{
    const snap=await getDocs(query(collection(db,'clients'),orderBy('name')));
    const fresh=snap.docs.map(d=>({id:d.id,...d.data()}));
    clients=fresh;
    matches=fresh.filter(c=>String(c.name||'').trim().toLocaleLowerCase('ru')===target.toLocaleLowerCase('ru'));
  }catch(err){console.warn('Не удалось обновить данные клиента',err);}
  const c=matches.find(x=>!x.hiddenFromDirectory)||matches[0];
  const row=(label,value)=>'<div class="client-detail-field"><span>'+label+'</span><b>'+esc(String(value||'—'))+'</b></div>';
  const body='<div class="client-detail-card">'+
    '<div class="client-detail-name">'+esc(c?.name||target)+'</div>'+
    row('Телефон',c?.phone)+row('Адрес',c?.address)+
    '<div class="client-detail-field client-detail-comment"><span>Комментарий</span><b>'+esc(String(c?.comment||'—'))+'</b></div>'+
    (!c?'<div class="field-hint">В справочнике нет точного совпадения для этого имени. Возможно, заказ сохранён под старым названием клиента.</div>':'')+
    '</div>';
  showModal('Карточка клиента',body,[button('Назад к заказу','back-detail')],'ДАННЫЕ КЛИЕНТА');
}
async function openClientsDirectory(){
  try{
    const current=await getDocs(query(collection(db,'clients'),orderBy('name')));
    clients=current.docs.map(d=>({id:d.id,...d.data()}));
  }catch(err){console.warn('Не удалось обновить список клиентов перед открытием',err);}
  const known=new Set(clients.map(c=>String(c.name||'').trim().toLocaleLowerCase('ru')).filter(Boolean));
  const historic=new Map();
  (state.orders||[]).forEach(o=>{const name=String(o.client||'').trim(),key=name.toLocaleLowerCase('ru');if(name&&!known.has(key)&&!historic.has(key))historic.set(key,name);});
  if(historic.size&&signedInUser){
    try{
      const entries=[...historic.values()];
      for(let i=0;i<entries.length;i+=400){
        const batch=writeBatch(db);
        entries.slice(i,i+400).forEach(name=>batch.set(doc(db,'clients',crypto.randomUUID()),{name,phone:'',email:'',comment:'',createdAt:isoNow(),createdBy:signedInUser.uid,source:'order-history'}));
        await batch.commit();
      }
    }catch(err){console.warn('Не удалось автоматически добавить клиентов из истории заказов',err);}
  }
  try{const current=await getDocs(query(collection(db,'clients'),orderBy('name')));clients=current.docs.map(d=>({id:d.id,...d.data()}));}catch{}
  const displayed=new Set(clients.map(c=>String(c.name||'').trim().toLocaleLowerCase('ru')));
  historic.forEach((name,key)=>{if(!displayed.has(key))clients.push({id:'history:'+key,name,phone:'',address:'',comment:'Из истории заказов',source:'order-history'});});
  clients=clients.filter(c=>!c.hiddenFromDirectory&&! /подробное описание|тестовый клиент|^тест\\b/i.test(String(c.name||''))).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ru'));
  const rows=clients.map(c=>'<tr><td><b>'+esc(c.name||'')+'</b></td><td>'+esc(c.phone||'—')+'</td><td>'+esc(c.address||'—')+'</td><td>'+esc(c.comment||'—')+'</td><td><button class="small-button primary-soft" data-action="edit-client:'+esc(c.id)+'">Изменить</button> <button class="small-button danger" data-action="delete-client:'+esc(c.id)+'">Удалить</button></td></tr>').join('');
  showModal('Клиенты','<div class="directory-toolbar"><label class="search-box"><span>⌕</span><input id="directoryClientSearch" placeholder="Поиск клиента"></label><button class="primary-button" data-action="new-client">＋ Добавить клиента</button><button class="secondary-button" data-action="import-clients">⇧ Excel</button></div><div class="directory-table-wrap"><table class="directory-table"><thead><tr><th>Клиент</th><th>Телефон</th><th>Адрес</th><th>Комментарий</th><th></th></tr></thead><tbody id="clientsDirectoryBody">'+(rows||'<tr><td colspan="5" class="directory-empty">Клиентов пока нет</td></tr>')+'</tbody></table></div><p class="directory-help">В справочнике могут автоматически появляться клиенты из истории заказов. Excel: «Имя/Клиент», «Телефон», «Почта», «Комментарий».</p><input id="clientsExcelInput" type="file" accept=".xlsx,.xls" hidden>',[button('Закрыть','close')],'СПРАВОЧНИК КЛИЕНТОВ');
  modal.querySelector('.modal')?.classList.add('directory-modal');
  setTimeout(()=>{$('directoryClientSearch')?.addEventListener('input',e=>filterClientDirectory(e.target.value));},0);
}
function filterClientDirectory(text){
  const q=String(text||'').toLocaleLowerCase('ru');
  const body=$('clientsDirectoryBody');if(!body)return;
  const list=clients.filter(c=>(String(c.name||'')+' '+String(c.phone||'')+' '+String(c.address||'')).toLocaleLowerCase('ru').includes(q));
  body.innerHTML=list.length?list.map(c=>'<tr><td><b>'+esc(c.name||'')+'</b></td><td>'+esc(c.phone||'—')+'</td><td>'+esc(c.address||'—')+'</td><td>'+esc(c.comment||'—')+'</td><td><button class="small-button primary-soft" data-action="edit-client:'+esc(c.id)+'">Изменить</button> <button class="small-button danger" data-action="delete-client:'+esc(c.id)+'">Удалить</button></td></tr>').join(''):'<tr><td colspan="5" class="directory-empty">Ничего не найдено</td></tr>';
}
function openClientForm(id=''){
  const c=clients.find(x=>x.id===id)||{};
  showModal(id?'Изменить клиента':'Добавить клиента','<form id="clientForm"><div class="form-grid"><div class="field"><label>Имя / название *</label><input id="clientFormName" required value="'+esc(c.name||'')+'"></div><div class="field"><label>Телефон</label><input id="clientFormPhone" value="'+esc(c.phone||'')+'"></div></div><div class="form-grid"><div class="field"><label>Адрес</label><input id="clientFormAddress" value="'+esc(c.address||'')+'"></div><div class="field"><label>Комментарий</label><input id="clientFormComment" value="'+esc(c.comment||'')+'"></div></div></form>',[button('Отмена','close'),button(id?'Сохранить':'Добавить','save-client:'+esc(id),'primary-button')],'КЛИЕНТ');
}
async function saveClient(id){
  const name=$('clientFormName')?.value.trim();if(!name){toast('Укажите имя клиента.');return}
  const data={name,phone:$('clientFormPhone')?.value.trim()||'',address:$('clientFormAddress')?.value.trim()||'',comment:$('clientFormComment')?.value.trim()||'',updatedAt:isoNow(),updatedBy:signedInUser.uid};
  try{
    if(id)await updateDoc(doc(db,'clients',id),data);
    else await setDoc(doc(db,'clients',crypto.randomUUID()),{...data,createdAt:isoNow(),createdBy:signedInUser.uid});
    openClientsDirectory();toast(id?'Клиент изменён.':'Клиент добавлен.');
  }catch(err){console.error(err);toast('Не удалось сохранить клиента: '+(err?.message||'нет доступа'))}
}
async function deleteClient(id){
  const c=clients.find(x=>x.id===id);if(!c)return;
  if(!confirm('Удалить клиента «'+c.name+'»?'))return;
  // Historical-only rows are synthetic and have no Firestore document.
  if(String(id).startsWith('history:')){
    const key=String(c.name||'').trim().toLocaleLowerCase('ru');
    clients=clients.filter(x=>String(x.id)!==String(id));
    const body=$('clientsDirectoryBody');
    if(body){const q=String($('directoryClientSearch')?.value||'').toLocaleLowerCase('ru');const list=clients.filter(x=>(String(x.name||'')+' '+String(x.phone||'')+' '+String(x.address||'')).toLocaleLowerCase('ru').includes(q));body.innerHTML=list.length?list.map(x=>'<tr><td><b>'+esc(x.name||'')+'</b></td><td>'+esc(x.phone||'—')+'</td><td>'+esc(x.address||'—')+'</td><td>'+esc(x.comment||'—')+'</td><td><button class="small-button primary-soft" data-action="edit-client:'+esc(x.id)+'">Изменить</button> <button class="small-button danger" data-action="delete-client:'+esc(x.id)+'">Удалить</button></td></tr>').join(''):'<tr><td colspan="5" class="directory-empty">Ничего не найдено</td></tr>';}
    toast('Клиент скрыт из справочника. Он может снова появиться, если останется в истории заказов.');
    return;
  }
  try{
    // Mark the record as hidden instead of physically deleting it: old orders can
    // otherwise recreate the same client in the directory immediately.
    await updateDoc(doc(db,'clients',id),{hiddenFromDirectory:true,updatedAt:isoNow(),updatedBy:signedInUser.uid});
    clients=clients.filter(x=>String(x.id)!==String(id));
    toast('Клиент удалён из справочника.');
    await openClientsDirectory();
  }catch(err){console.error('Ошибка удаления клиента',err);toast('Не удалось удалить клиента: '+(err?.code||err?.message||'нет доступа'))}
}
function importClientsExcel(file){
  if(!file)return;
  if(!window.XLSX){toast('Не удалось загрузить модуль Excel. Обновите страницу и попробуйте снова.');return;}
  const reader=new FileReader();
  reader.onerror=()=>toast('Не удалось прочитать выбранный Excel-файл.');
  reader.onload=async e=>{
    try{
      const wb=window.XLSX.read(new Uint8Array(e.target.result),{type:'array'});
      const sheet=wb.Sheets[wb.SheetNames[0]];
      if(!sheet)throw new Error('В Excel-файле нет листов.');

      const normalize=s=>String(s??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru').replace(/ё/g,'е');
      const headerKey=s=>normalize(s).replace(/[\s_\-./:]+/g,'');
      const aliases={
        name:['имя','клиент','клиентфио','фио','имяклиента','названиеклиента','название','name','client','customer','группирование','групування'],
        phone:['телефон','номер телефона','номертелефона','тел','мобильный','мобильныйтелефон','phone','telephone','mobile'],
        address:['адрес','адресклиента','адресдоставки','фактическийадрес','фактичнаадреса','юридическийадрес','юридичнаадреса','почтовыйадрес','address','customeraddress']
      };
      const matchesAlias=(header,field)=>{
        const key=headerKey(header);
        return aliases[field].some(alias=>{
          const a=headerKey(alias);
          return key===a||key.includes(a);
        });
      };

      // Выгрузка 1С может содержать несколько служебных строк перед настоящим заголовком.
      const matrix=window.XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false});
      let headerRowIndex=-1;
      for(let i=0;i<Math.min(matrix.length,40);i++){
        const row=Array.isArray(matrix[i])?matrix[i]:[];
        const hasName=row.some(v=>matchesAlias(v,'name'));
        const hasPhone=row.some(v=>matchesAlias(v,'phone'));
        const hasAddress=row.some(v=>matchesAlias(v,'address'));
        if(hasName && (hasPhone||hasAddress)){headerRowIndex=i;break;}
      }
      if(headerRowIndex<0)headerRowIndex=0;

      const rows=window.XLSX.utils.sheet_to_json(sheet,{range:headerRowIndex,defval:'',raw:false});
      if(!rows.length)throw new Error('На первом листе нет строк с клиентами.');

      const columns={name:[],phone:[],address:[]};
      const firstRowKeys=Object.keys(rows[0]||{});
      for(const key of firstRowKeys){
        if(matchesAlias(key,'name'))columns.name.push(key);
        if(matchesAlias(key,'phone'))columns.phone.push(key);
        if(matchesAlias(key,'address'))columns.address.push(key);
      }

      const pick=(row,keys)=>{
        for(const key of keys){
          const value=String(row[key]??'').trim();
          if(value)return value;
        }
        return '';
      };
      const prioritizedPhone=columns.phone.sort((a,b)=>{
        const score=k=>{
          const h=headerKey(k);
          if(h.includes('телефонконтрагента'))return 0;
          if(h==='телефон')return 1;
          if(h.includes('другой'))return 2;
          if(h.includes('мобиль'))return 3;
          return 4;
        };
        return score(a)-score(b);
      });
      const prioritizedAddress=columns.address.sort((a,b)=>{
        const score=k=>{
          const h=headerKey(k);
          if(h.includes('фактичнаадреса')||h.includes('фактическийадрес'))return 0;
          if(h.includes('адресадоставки'))return 1;
          if(h.includes('юридичнаадреса')||h.includes('юридическийадрес'))return 2;
          return 3;
        };
        return score(a)-score(b);
      });
      const nameKey=columns.name[0];

      if(!nameKey)throw new Error('Не найдена колонка с именем клиента. Подойдут «Имя клиента», «Клиент», «Название» или выгрузка 1С с колонкой «Групування».');
      if(!prioritizedPhone.length&&!prioritizedAddress.length)throw new Error('Не найдены колонки телефона или адреса.');

      const importedByName=new Map();
      let skipped=0;
      for(const row of rows){
        const rawName=String(row[nameKey]??'').trim();
        if(!rawName){skipped++;continue;}
        const name=rawName.replace(/\s+/g,' ').trim();
        const key=normalize(name);
        const phone=pick(row,prioritizedPhone);
        const address=pick(row,prioritizedAddress);
        if(!importedByName.has(key))importedByName.set(key,{name,phone,address});
        else{
          const current=importedByName.get(key);
          if(phone)current.phone=phone;
          if(address)current.address=address;
        }
      }

      const imported=[...importedByName.entries()];
      if(!imported.length)throw new Error('Не найдено ни одной записи с именем клиента.');

      const existingSnap=await getDocs(collection(db,'clients'));
      const existingByName=new Map();
      existingSnap.docs.forEach(d=>{
        const data=d.data(),key=normalize(data.name);
        if(!key)return;
        if(!existingByName.has(key))existingByName.set(key,[]);
        existingByName.get(key).push(d);
      });

      const stamp=isoNow(),operations=[];
      let added=0,updated=0,hiddenDuplicates=0;
      for(const [key,client] of imported){
        const matches=existingByName.get(key)||[];
        if(!matches.length){
          operations.push({type:'set',ref:doc(db,'clients',crypto.randomUUID()),data:{
            name:client.name,phone:client.phone,address:client.address,comment:'',
            createdAt:stamp,createdBy:signedInUser.uid,updatedAt:stamp,updatedBy:signedInUser.uid
          }});
          added++;
          continue;
        }

        const primary=matches.find(d=>!d.data().hiddenFromDirectory)||matches[0];
        const old=primary.data()||{};
        operations.push({type:'update',ref:primary.ref,data:{
          name:client.name,
          phone:client.phone||old.phone||'',
          address:client.address||old.address||'',
          hiddenFromDirectory:false,updatedAt:stamp,updatedBy:signedInUser.uid
        }});
        updated++;

        for(const duplicate of matches){
          if(duplicate.id===primary.id||duplicate.data().hiddenFromDirectory)continue;
          operations.push({type:'update',ref:duplicate.ref,data:{
            hiddenFromDirectory:true,updatedAt:stamp,updatedBy:signedInUser.uid
          }});
          hiddenDuplicates++;
        }
      }

      for(let i=0;i<operations.length;i+=400){
        const batch=writeBatch(db);
        operations.slice(i,i+400).forEach(op=>{
          if(op.type==='set')batch.set(op.ref,op.data);
          else batch.update(op.ref,op.data);
        });
        await batch.commit();
      }

      const sourceLabel=headerRowIndex>0?'Выгрузка 1С':'Excel';
      toast(sourceLabel+' обработан: добавлено '+added+', обновлено '+updated+
        (hiddenDuplicates?', скрыто повторов: '+hiddenDuplicates:'')+
        (skipped?', пропущено пустых строк: '+skipped:'')+'. Заказы не удалялись.');
      await openClientsDirectory();
    }catch(err){
      console.error('Ошибка импорта клиентов из Excel',err);
      toast('Не удалось импортировать клиентов: '+(err?.message||err?.code||'ошибка Excel'));
    }
  };
  reader.readAsArrayBuffer(file);
}

function importProductsExcel(file){
  if(!file)return;
  if(!window.XLSX){toast('Не удалось загрузить модуль Excel. Обновите страницу и попробуйте снова.');return;}
  const reader=new FileReader();
  reader.onerror=()=>toast('Не удалось прочитать выбранный Excel-файл.');
  reader.onload=async e=>{
    try{
      const wb=window.XLSX.read(new Uint8Array(e.target.result),{type:'array'}),sheet=wb.Sheets[wb.SheetNames[0]];
      if(!sheet)throw new Error('В книге нет листов.');
      const rows=window.XLSX.utils.sheet_to_json(sheet,{defval:''});
      if(!rows.length)throw new Error('Первый лист пустой или не содержит строк данных.');
      const normalize=s=>String(s??'').trim().toLocaleLowerCase('ru').replace(/[\s_-]+/g,'');
      const map=new Map();
      for(const row of rows){
        const keys=Object.keys(row),get=(...names)=>{const wanted=names.map(normalize);const k=keys.find(x=>wanted.includes(normalize(x)));return k===undefined?'':String(row[k]??'').trim();};
        const a=get('catalog_number','catalog number','Артикул','Каталожный номер','Номер детали','article','артикул товара');
        if(!a||map.has(a.toLocaleLowerCase('ru')))continue;
        map.set(a.toLocaleLowerCase('ru'),{a,m:get('manufacturer_parts','manufacturer parts','Производитель','Бренд','Производитель детали'),n:get('name','Наименование','Название','Описание'),o:get('original_number','original number','Оригинальный номер','Кросс-номер','Кросс номера'),b:get('marks','Марки','Марка','Модель автомобиля','Применяемость')});
      }
      const items=[...map.values()];
      if(!items.length)throw new Error('Не найдены артикулы. Проверьте колонку catalog_number или «Артикул» в первой строке.');
      const chunks=[];
      for(let i=0;i<items.length;i+=1000)chunks.push(items.slice(i,i+1000));
      const stamp=isoNow();
      for(let i=0;i<chunks.length;i++)await setDoc(doc(db,'products','chunk-'+(i+1)),{items:chunks[i],count:chunks[i].length,updatedAt:stamp,updatedBy:signedInUser.uid});
      const oldSnap=await getDocs(collection(db,'products')),keep=new Set(chunks.map((_,i)=>'chunk-'+(i+1))),cleanup=writeBatch(db);
      oldSnap.docs.filter(d=>d.id.startsWith('chunk-')&&!keep.has(d.id)).forEach(d=>cleanup.delete(d.ref));
      cleanup.set(doc(db,'products','meta'),{count:items.length,updatedAt:stamp,updatedBy:signedInUser.uid});
      await cleanup.commit();
      productsCatalog=items;productsLoaded=true;try{sessionStorage.setItem('warehouse_products_cache',JSON.stringify(items));}catch{}
      toast('База артикулов обновлена: '+items.length+' позиций.');openProductsDirectory();
    }catch(err){console.error('Ошибка импорта базы артикулов',err);toast('Не удалось импортировать базу: '+(err?.message||err?.code||'ошибка Excel'))}
  };
  reader.readAsArrayBuffer(file);
}
function openProductsDirectory(){
  showModal('База артикулов','<div class="directory-toolbar products-directory-toolbar"><label class="search-box"><span>⌕</span><input id="directoryProductSearch" placeholder="Артикул, кросс-номер, марка"></label><button class="primary-button" data-action="import-products">⇧ Загрузить Excel</button></div><div class="directory-table-wrap products-directory-wrap"><table class="directory-table products-directory-table"><thead><tr><th>Артикул</th><th>Производитель</th><th>Марка</th><th>Наименование</th><th>Кросс-номера</th></tr></thead><tbody id="productsDirectoryBody"><tr><td colspan="5" class="directory-empty">Загружаю базу артикулов…</td></tr></tbody></table></div><input id="productsExcelInput" type="file" accept=".xlsx,.xls" hidden><p class="field-hint" id="productsDirectoryHint">Подготавливаем каталог…</p>',[button('Закрыть','close')],'КАТАЛОГ АРТИКУЛОВ');
  modal.querySelector('.modal')?.classList.add('directory-modal','products-directory-modal');
  $('directoryProductSearch')?.addEventListener('input',e=>renderProductDirectory(e.target.value));
  loadProductsCatalog().then(()=>{
    const hint=$('productsDirectoryHint');
    if(hint)hint.textContent='В каталоге '+productsCatalog.length+' уникальных позиций. База используется для подсказок при создании и редактировании заказа.';
    renderProductDirectory($('directoryProductSearch')?.value||'');
  }).catch(err=>{
    console.error('Не удалось открыть базу артикулов',err);
    const body=$('productsDirectoryBody');
    if(body)body.innerHTML='<tr><td colspan="5" class="directory-empty">Не удалось загрузить каталог. Проверь подключение и права доступа, затем закрой и открой вкладку снова.</td></tr>';
    const hint=$('productsDirectoryHint');if(hint)hint.textContent='Ошибка загрузки базы артикулов.';
  });
}
function renderProductDirectory(text){
  const body=$('productsDirectoryBody');if(!body)return;
  const q=String(text||'').toLocaleLowerCase('ru');
  const list=!q?productsCatalog.slice(0,100):productsCatalog.filter(p=>(String(p.a)+' '+String(p.m)+' '+String(p.b)+' '+String(p.n)+' '+String(p.o)).toLocaleLowerCase('ru').includes(q)).slice(0,100);
  body.innerHTML=list.length?list.map(p=>'<tr><td><b>'+esc(p.a)+'</b></td><td>'+esc(p.m||'—')+'</td><td>'+esc(p.b||'—')+'</td><td>'+esc(p.n||'—')+'</td><td>'+esc(p.o||'—')+'</td></tr>').join(''):'<tr><td colspan="5" class="directory-empty">Ничего не найдено</td></tr>';
}

function returnedQuantityForArticle(o,article){
  const key=String(article||'').trim().toUpperCase();
  // Отменённые возвраты не должны уменьшать доступное к возврату количество.
  return (Array.isArray(o?.returns)?o.returns:[]).filter(r=>r?.status!=='cancelled').reduce((sum,r)=>sum+(Array.isArray(r.items)?r.items.filter(x=>String(x.article||'').trim().toUpperCase()===key).reduce((n,x)=>n+(Number(x.quantity)||0),0):0),0);
}
function openReturnForm(){
  const o=state.orders.find(x=>x.id===selectedId);if(!o)return;
  if(o.returnCancelled&&!canManageUsers){toast('После отмены возврата повторно оформить его может только администратор или директор.');return;}
  const items=(o.articles||[]).map(x=>{const article=String(x.article||'').trim();const ordered=Math.max(1,Number(x.quantity)||1);const returned=returnedQuantityForArticle(o,article);return {article,ordered,returned,available:Math.max(0,ordered-returned)};}).filter(x=>x.available>0);
  if(!items.length){toast('Для этого заказа уже нечего возвращать.');return;}
  const rows=items.map(x=>'<div class="return-row" style="display:grid;grid-template-columns:minmax(0,1fr) 90px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line,#2a2a2a)"><label><b>'+esc(x.article)+'</b><small style="display:block;color:#89919d">В заказе: '+x.ordered+' шт. · уже возвращено: '+x.returned+' · доступно: '+x.available+'</small></label><input class="return-qty" data-article="'+esc(x.article)+'" data-max="'+x.available+'" type="number" min="0" max="'+x.available+'" step="1" value="0" aria-label="Количество к возврату"></div>').join('');
  showModal('Возврат заказа № '+esc(o.number),'<div class="field"><span class="field-hint">Укажите количество только у тех позиций, которые возвращаются. Можно вернуть часть заказа.</span></div><div>'+rows+'</div><div class="field" style="margin-top:14px"><label for="returnReason">Причина возврата (необязательно)</label><textarea id="returnReason" placeholder="Например: клиент отказался от детали"></textarea></div>',[button('Назад','back-detail'),button('Оформить возврат','save-return','primary-button')],'ВОЗВРАТ');
}
async function saveReturn(){
  const o=state.orders.find(x=>x.id===selectedId);if(!o)return;
  if(o.returnCancelled&&!canManageUsers){toast('После отмены возврата повторно оформить его может только администратор или директор.');return;}
  if(state.role!=='warehouse'&&!canManageUsers){toast('Возврат может оформить только кладовщик, администратор или директор.');return;}
  const items=[...document.querySelectorAll('.return-qty')].map(input=>({article:String(input.dataset.article||'').trim(),quantity:Math.min(Math.max(0,Math.floor(Number(input.value)||0)),Math.max(0,Math.floor(Number(input.dataset.max)||0)))})).filter(x=>x.article&&x.quantity>0);
  if(!items.length){toast('Укажите хотя бы одну позицию для возврата.');return;}
  const reason=$('returnReason')?.value.trim()||'';
  const previousStatus=o.status;
  const createdAt=isoNow();
  const entry={id:crypto.randomUUID(),createdAt,authorId:signedInUser.uid,author:profileName||roles[state.role],reason,items,previousStatus};
  const nextReturns=[...(Array.isArray(o.returns)?JSON.parse(JSON.stringify(o.returns)):[]),entry];
  try{
    await updateDoc(doc(db,'orders',o.id),{returns:nextReturns,status:'Возврат',updatedAt:createdAt,updatedBy:signedInUser.uid,updatedByName:profileName||''});
    o.returns=nextReturns;o.status='Возврат';o.updatedAt=createdAt;o.updatedBy=signedInUser.uid;o.updatedByName=profileName||'';
    serverCache.set(o.id,{...o,returns:JSON.parse(JSON.stringify(nextReturns)),articles:(o.articles||[]).map(x=>({...x})),entries:[...(o.entries||[])]});
    const historyEntry={id:crypto.randomUUID(),kind:'return',text:'Оформлен возврат: '+items.map(x=>x.article+' × '+x.quantity).join(', ')+(reason?' · '+reason:''),authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt,photos:[]};
    try{
      await setDoc(doc(db,'orders',o.id,'entries',historyEntry.id),entryToCloud(historyEntry));
      o.entries=Array.isArray(o.entries)?o.entries:[];o.entries.push(historyEntry);
      serverCache.set(o.id,{...o,returns:JSON.parse(JSON.stringify(nextReturns)),articles:(o.articles||[]).map(x=>({...x})),entries:[...o.entries]});
    }catch(historyError){console.warn('Возврат сохранён, но запись в истории не добавлена',historyError);}
    await writeAudit('Возврат оформлен','Оформлен возврат по заказу № '+o.number,o.id,{previousStatus,newStatus:'Возврат'});
    closeModal();render();toast('Возврат оформлен.');notify('Возврат по заказу № '+o.number,o.id);openOrder(o.id);
  }catch(err){
    console.error('Не удалось сохранить возврат',err);
    const code=String(err?.code||'').replace(/^.*?\//,'')||'ошибка';
    toast('Не удалось сохранить возврат: '+code);
  }
}
function openOrder(id){const o=state.orders.find(x=>x.id===id);if(!o)return;selectedId=id;const isManager=isManagerRole()||canManageUsers,isWarehouse=state.role==='warehouse'||canManageUsers,isDirector=state.role==='director',hasOpenDefect=hasPendingDefect(o),shipmentLocked=isShipmentLocked(o);const locked=shipmentLocked;const lockedButton=(label,action,cls='small-button',reason='Недоступно для вашей роли')=>'<button type="button" class="'+cls+' role-action-locked" disabled aria-disabled="true" title="'+esc(reason)+'"><span class="role-action-ban" aria-hidden="true">🚫</span>'+label+'</button>';const actionButton=(label,action,cls,allowed,reason)=>allowed?button(label,action,cls):lockedButton(label,action,cls,reason);let actions='';actions+='<div class="detail-action-group detail-action-roles">'+actionButton('📋 Менеджер','open-manager-actions','small-button action-category manager-category',isManager&&!locked,'Доступно менеджерам и администраторам')+actionButton('📦 Кладовщик','open-warehouse-actions','small-button action-category warehouse-category',isWarehouse&&!locked,'Доступно кладовщику и администраторам')+'</div>';actions+='<div class="detail-action-group detail-action-edit">'+actionButton('✎ Редактировать','open-edit-menu','small-button neutral-edit-button',!locked,'Редактирование недоступно после отгрузки')+'</div>';actions+='<div class="detail-action-group detail-action-bottom">'+actionButton('⚠ Дефект','add-defect','small-button danger',isWarehouse&&!locked&&!hasOpenDefect,'Создавать дефекты может кладовщик или администратор/директор')+actionButton('🗑 Удалить карточку','delete-order','small-button danger',canManageUsers&&!locked&&!hasOpenDefect,'Удалять заказы может только администратор или директор')+'</div>';const utilityActions=actionButton('＋ Добавить комментарий','add-comment','small-button primary-soft',true,'')+actionButton('↩ Возврат','open-return','small-button primary-soft',isWarehouse&&(!o.returnCancelled||canManageUsers)&&!locked,'Возврат доступен кладовщику и администраторам')+actionButton(o.assemblyInProgress?'✓ Завершить сборку':'▶ Начать сборку','toggle-assembly','small-button '+(o.assemblyInProgress?'good':'primary-soft'),isWarehouse&&o.status!=='Отгружен кладовщиком','Сборка доступна кладовщику и администраторам');actions+='<div class="detail-action-group detail-action-utility">'+utilityActions+'</div>';if(shipmentLocked)actions='<div class="danger-note">🔒 🔒 После отгрузки или статуса «Клиент забрал самовывозом» менеджер, бухгалтер и главный бухгалтер больше не могут редактировать, отменять или удалять заказ.</div>'+actions;else if(hasOpenDefect)actions='<div class="defect-order-lock-note">⚠ По заказу есть нерассмотренный дефект. Сборку и редактирование можно продолжать; смена статуса будет доступна после решения.</div>'+actions;let articlesHtml='<div class="detail-section-title">Артикулы заказа · '+(o.articles||[]).length+'</div>';
if(hasOpenDefect){articlesHtml+='<div class="defect-click-hint"><span class="defect-click-hint-icon">⚠</span><span><b>ТРЕБУЕТСЯ РЕШЕНИЕ ПО ДЕФЕКТУ</b><small>Нажмите на красную позицию ниже, чтобы открыть фото и вынести решение.</small></span><span class="defect-click-arrow">↓</span></div>';}
if((o.articles||[]).length){
  articlesHtml+='<div class="order-articles-list">'+o.articles.map((x,i)=>{
    const collected=x.collected===true;const itemDefects=(o.entries||[]).filter(e=>e.kind==='defect'&&!['Удалена из заказа','Отменён'].includes(e.decision)&&(Number.isInteger(e.articleIndex)?e.articleIndex===i:e.article===x.article));const removedByDefect=(o.entries||[]).some(e=>e.kind==='defect'&&e.decision==='Удалена из заказа'&&(Number.isInteger(e.articleIndex)?e.articleIndex===i:e.article===x.article));
    const collectedControl=removedByDefect
      ?'<span class="field-hint">Не участвует в сборке</span>'
      :(state.role==='warehouse'||canManageUsers)&&!shipmentLocked
        ?button(collected?'✓ Собрано':'☐ Собрано','toggle-collected:'+i,'small-button '+(collected?'good':'primary-soft'))
        :'<button type="button" class="small-button role-action-locked" disabled aria-disabled="true" title="Отмечать сборку может кладовщик или администратор"><span class="role-action-ban" aria-hidden="true">🚫</span>'+(collected?'✓ Собрано':'☐ Собрано')+'</button>';
    const pendingItemDefect=itemDefects.some(e=>!e.decision);return '<div class="order-article-view '+(collected?'article-collected':'')+(removedByDefect?' article-removed':'')+(pendingItemDefect?' article-defect-pending':'')+(pendingItemDefect?'" data-defect-article="'+i:'')+'"><span class="article-main"><b>'+esc(x.article)+'</b>'+(itemDefects.length?'<span class="defect-article-badge">ДЕФЕКТ</span>':'')+(removedByDefect?'<span class="removed-article-badge">УДАЛЕНА ИЗ ЗАКАЗА</span>':'')+'<small>'+(removedByDefect?'Не отгружается':collected?'Собрано':'Не собрано')+'</small></span><span style="display:flex;align-items:center;gap:8px"><span>'+(Number(x.quantity)||1)+' шт.</span>'+collectedControl+'<button type="button" class="small-button primary-soft" data-action="show-on-map" data-map-article="'+esc(String(x.article||''))+'">🗺️ На карте</button></span></div>';
  }).join('')+'</div>';
}else{
  articlesHtml+='<div class="danger-note">Артикулы не указаны.</div>';
}
articlesHtml+='<div class="detail-section-title">Возвраты · '+(o.returns||[]).length+'</div>';
if((o.returns||[]).length){
  articlesHtml+='<div class="timeline">'+(o.returns||[]).slice().reverse().map(r=>'<article class="timeline-item"><div class="timeline-top"><span><b>'+esc(r.author||'Сотрудник')+'</b> · '+fmtDateTime(r.createdAt)+'</span><span class="timeline-type">'+(r.status==='cancelled'?'ОТМЕНЁН':'ВОЗВРАТ')+'</span></div><div class="timeline-text" style="'+(r.status==='cancelled'?'text-decoration:line-through;opacity:.65':'')+'">'+(r.items||[]).map(x=>esc(x.article)+' × '+(Number(x.quantity)||0)).join('<br>')+(r.reason?'<br><span style="color:#89919d">Причина: '+esc(r.reason)+'</span>':'')+(r.status==='cancelled'?'<br><b>Отменён '+fmtDateTime(r.cancelledAt)+'</b>':'')+'</div>'+(canManageUsers&&r.status!=='cancelled'?button('Отменить возврат','cancel-return:'+o.id+':'+r.id,'small-button danger'):'')+'</article>').join('')+'</div>';
}else{
  articlesHtml+='<div class="field-hint">Возвратов ещё не оформляли.</div>';
}
let entries=(o.entries||[]).slice().sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0)).map(e=>{const replyTarget=(o.entries||[]).find(x=>x.id===e.replyToEntryId);const decisionLabel=e.decision==='Подтверждён'?'Подтверждено':e.decision==='Отменён'?'Отменено':e.decision==='Удалена из заказа'?'Позиция удалена из заказа':'Ожидает решения';const decidedBy=e.decidedByName||e.decidedBy||'';return `<article class="timeline-item ${e.important?'timeline-item-important':''}"><div class="timeline-top"><span><b>${esc(e.author)}</b> · ${fmtDateTime(e.createdAt)}${e.important?' <span class="important-message-mark" title="Важное сообщение">❗ ВАЖНО</span>':''}</span><span style="display:flex;align-items:center;gap:7px"><span class="timeline-type">${esc(({defect:'ДЕФЕКТ',question:'ВОПРОС',decision:'РЕШЕНИЕ',comment:'КОММЕНТАРИЙ',viewed:'ПРОСМОТРЕНО',system:'СИСТЕМА'})[e.kind]||'ЗАПИСЬ')}</span>${isDirector?`<button class="row-menu" title="Удалить запись (директор)" data-action="delete-entry:${e.id}">×</button>`:''}</span></div>${e.replyToEntryId?`<div class="timeline-reply-reference"><b>Ответ для ${esc(e.replyToAuthorName||replyTarget?.author||'Сотрудника')}</b><div>${esc(String(e.replyToText||replyTarget?.text||'').slice(0,220))}${String(e.replyToText||replyTarget?.text||'').length>220?'…':''}</div></div>`:''}${e.article?`<div class="timeline-article">Артикул: ${esc(e.article)}</div>`:''}<div class="timeline-text">${esc(e.text)}</div>${e.kind==='comment'?button('↩ Ответить','reply-entry:'+e.id,'small-button primary-soft timeline-reply-button'):''}${e.photos?.length?`<div class="photo-grid">${e.photos.map(p=>`<img src="${p}" alt="Фото к записи" data-photo="${p}">`).join('')}</div>`:''}${e.kind==='defect'?(e.decision?`<div class="decision-row"><span>Решение по дефекту: <b>${esc(decisionLabel)}</b>${decidedBy?`<br>Решение вынес: <b>${esc(decidedBy)}</b>`:''}${e.decidedAt?`<br>${fmtDateTime(e.decidedAt)}`:''}${e.decisionText?`<br>${esc(e.decisionText)}`:''}</span></div>`:((isManager||isWarehouse)?`<div class="decision-row"><span>Решение по дефекту: <b>ожидает ответа</b></span></div>`:'')):''}</article>`}).join('');const reviewed=(o.entries||[]).some(e=>e.kind==='viewed');let badge=reviewed?'<span class="status-pill status-neutral">Просмотрен менеджером</span>':'';showModal(`Заказ № ${o.number}`,`<div class="order-detail-head"><div><button type="button" class="detail-number detail-client-link" data-open-client-card="${esc(o.client)}" title="Открыть карточку клиента">${esc(o.client)}</button><div class="detail-client">Заказ № ${esc(o.number)}</div><div class="detail-meta"><div class="detail-meta-line">Создан: ${fmtDateTime(o.createdAt)}</div>${`<div class="detail-meta-line">Доставка: ${o.deliveryType==='pickup'?'Самовывоз':o.deliveryType==='post'?'Доставка почтой':'Доставка по городу'}</div>`}${o.transferredAt?`<div class="detail-meta-line">Перенесен: ${fmtDateTime(o.transferredAt)}</div>`:""}${o.assembledAt?`<div class="detail-meta-line">Собран: ${fmtDateTime(o.assembledAt)}</div>`:""}${o.shippedAt?`<div class="detail-meta-line">Отгружен: ${fmtDateTime(o.shippedAt)}</div>`:""}<div class="detail-meta-line">${esc(o.author||"Кладовщик")}</div><div class="detail-history-mini">${(o.entries||[]).slice(-3).reverse().map(e=>`<div class="detail-history-line">${esc(e.author||'Сотрудник')} · ${fmtDateTime(e.createdAt)} · ${esc(e.text||'Действие')}</div>`).join('')}</div></div></div><div>${statusPill(o.status)}${assemblyIndicator(o)}<div style="margin-top:6px">${badge}</div></div></div><div class="detail-actions">${actions}</div>${articlesHtml}<div class="detail-section-title">История · ${entriesCount(o)} ${plural(entriesCount(o),'запись','записи','записей')}</div><div class="timeline">${entries||'<div class="danger-note">Записей пока нет. Добавьте комментарий или описание дефекта.</div>'}</div>`,[button('Закрыть','close')],'КАРТОЧКА ЗАКАЗА');modal.dataset.orderDetail=id}

function openOrderActionCategory(category){const o=state.orders.find(x=>x.id===selectedId);if(o&&hasPendingDefect(o)){toast('Пока дефект не рассмотрен, смена статуса недоступна. Сборку и редактирование можно продолжать.');return;}const isManager=isManagerRole()||canManageUsers;const warehouseActions=[...(state.role==='warehouse'||canManageUsers?[button('Отгружен кладовщиком','set-status:Отгружен кладовщиком','small-button shipped')]:[]),button('Под вопросом','set-status:Под вопросом','small-button warehouse-status-question'),button('Ожидает самовывоза','set-status:Ожидает самовывоза','small-button warehouse-status-pickup-waiting'),button('Клиент забрал самовывозом','set-status:Клиент забрал самовывозом','small-button warehouse-status-pickup-done')];const managerActions=[button('Создан','set-status:Создан','small-button manager-status-created'),button('На согласовании','set-status:На согласовании','small-button manager-status-approval'),button('Одобрен на отгрузку клиенту','set-status:Одобрен на отгрузку клиенту','small-button manager-status-ready'),button('Перенесен','set-status:Перенесен','small-button manager-status-transferred'),button('Отменён','set-status:Отменён','small-button manager-status-cancel'),button('Ожидает оплаты','set-status:Ожидает оплаты','small-button manager-status-payment')];const title=category==='warehouse'?'Действия кладовщика':'Действия менеджера';const list=category==='warehouse'?warehouseActions:managerActions;showModal(title,`<div class="order-action-menu"><div class="order-action-menu-hint">${category==='warehouse'?'Статусы сборки и выдачи заказа.':'Статусы согласования и работы менеджера.'}</div><div class="order-action-menu-list">${list.join('')}</div></div>`,[button('Назад к заказу','back-detail')],category==='warehouse'?'КЛАДОВЩИК':'МЕНЕДЖЕР')}
function openEditMenu(){showModal('Редактировать заказ','<div class="field-hint">Выберите, что хотите изменить.</div>',[button('Редактировать данные','edit-order-info','small-button neutral-edit-button'),button('Редактировать артикулы','edit-articles','small-button neutral-edit-button'),button('Назад к заказу','back-detail','small-button')],'РЕДАКТИРОВАНИЕ ЗАКАЗА')}
function editOrderInfo(){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(!canEditOrder(o)){toast('После отгрузки или получения заказа клиентом редактирование доступно только администратору и директору.');return;}showModal('Редактировать данные заказа',`<form id="editOrderInfoForm"><div class="field"><label for="editOrderNumber">Номер заказа *</label><input id="editOrderNumber" required autocomplete="off" value="${esc(o.number)}"></div><div class="field client-suggestion-wrap"><label for="editClientName">Имя клиента *</label><input id="editClientName" required autocomplete="off" value="${esc(o.client)}"><div id="editClientNameSuggestions" class="chat-mention-suggestions client-suggestions" hidden></div></div><div class="field"><label for="editDeliveryType">Вид доставки</label><select id="editDeliveryType"><option value="city"${(o.deliveryType||'city')==='city'?' selected':''}>Доставка по городу</option><option value="pickup"${o.deliveryType==='pickup'?' selected':''}>Самовывоз</option><option value="post"${o.deliveryType==='post'?' selected':''}>Доставка почтой</option></select></div><span class="field-hint">Изменения сохранятся в карточке заказа и будут видны всем сотрудникам.</span></form>`,[button('Назад','back-detail'),button('Сохранить изменения','save-order-info','primary-button')],'ДАННЫЕ ЗАКАЗА')}
async function saveOrderInfo(){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(!canEditOrder(o)){toast('После отгрузки или получения заказа клиентом редактировать заказ могут только администратор и директор.');return;}const number=$("editOrderNumber").value.trim(),client=$("editClientName").value.trim(),deliveryType=['city','pickup','post'].includes($("editDeliveryType")?.value)?$("editDeliveryType").value:'city';if(!number||!client){toast('Укажите номер заказа и имя клиента.');return}const duplicate=state.orders.find(x=>x.id!==o.id&&String(x.number).trim().toLowerCase()===number.toLowerCase());if(duplicate){toast('Карточка с таким номером уже существует.');return}const oldNumber=o.number,oldClient=o.client,oldDeliveryType=o.deliveryType||'city',now=isoNow(),updatedByName=profileName||roles[state.role]||'Сотрудник';try{await updateDoc(doc(db,'orders',o.id),{number,client,deliveryType,updatedAt:now,updatedBy:signedInUser.uid,updatedByName});o.number=number;o.client=client;o.deliveryType=deliveryType;o.updatedAt=now;o.updatedBy=signedInUser.uid;o.updatedByName=updatedByName;const entry={id:crypto.randomUUID(),kind:'system',text:`Данные заказа изменены: ${oldNumber} → ${number}; клиент: ${oldClient} → ${client}; доставка: ${oldDeliveryType==='pickup'?'Самовывоз':oldDeliveryType==='post'?'Доставка почтой':'Доставка по городу'} → ${deliveryType==='pickup'?'Самовывоз':deliveryType==='post'?'Доставка почтой':'Доставка по городу'}`,authorId:signedInUser.uid,author:updatedByName,createdAt:now,photos:[]};try{await setDoc(doc(db,'orders',o.id,'entries',entry.id),entryToCloud(entry));o.entries.push(entry)}catch(logErr){console.warn('Не удалось записать историю изменения данных заказа',logErr)}serverCache.set(o.id,{...(serverCache.get(o.id)||{}),...o,entries:[...(o.entries||[])]});pendingOrderData.delete(o.id);closeModal();render();toast('Данные заказа сохранены.');notify('Данные заказа изменены',o.id);openOrder(o.id)}catch(err){console.error('Не удалось сохранить данные заказа',err);toast('Не удалось сохранить данные заказа: '+(err?.code||err?.message||'нет доступа'));}}
function editArticles(){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}showModal(`Артикулы заказа № ${o.number}`,`<div class="field"><label>Состав заказа</label>${articlesEditorHtml(o.articles||[])}<span class="field-hint">Добавляйте новые позиции, меняйте количество или удаляйте ненужные.</span></div>`,[button('Назад','back-detail'),button('Сохранить артикулы','save-articles','primary-button')],'СОСТАВ ЗАКАЗА')}
function isArticleRemovedByDefect(o,index,item){
  return (o?.entries||[]).some(entry=>
    entry.kind==='defect'&&entry.decision==='Удалена из заказа'&&
    (Number.isInteger(entry.articleIndex)?entry.articleIndex===index:entry.article===item?.article)
  );
}
async function toggleArticleCollected(index){
  const o=state.orders.find(x=>x.id===selectedId);
  if(!o||!(state.role==='warehouse'||canManageUsers)||!Number.isInteger(index))return;
  const item=o.articles?.[index];
  if(!item)return;
  if(isArticleRemovedByDefect(o,index,item)){
    toast('Эта позиция удалена из заказа и не участвует в сборке.');
    return;
  }

  const previousCollected=item.collected===true;
  const previousStatus=o.status;
  const previousAssembledAt=o.assembledAt;
  const previousAssemblyInProgress=o.assemblyInProgress;

  item.collected=!previousCollected;

  // Учитываем только позиции, которые действительно будут отгружаться.
  const articles=(o.articles||[]).map((article,articleIndex)=>({article,articleIndex}))
    .filter(({article,articleIndex})=>String(article?.article||'').trim()&&!isArticleRemovedByDefect(o,articleIndex,article));
  const allCollected=articles.length>0&&articles.every(({article})=>article.collected===true);

  // Удалённые по дефекту позиции не должны мешать завершению сборки.
  if(allCollected){
    if(previousStatus!=='Собран')o.assembledAt=isoNow();
    o.status='Собран';
    o.assemblyInProgress=false;
  }

  try{
    await save();
    render();
    openOrder(o.id);
  }catch(err){
    item.collected=previousCollected;
    o.status=previousStatus;
    o.assembledAt=previousAssembledAt;
    o.assemblyInProgress=previousAssemblyInProgress;
    console.error('Не удалось изменить отметку сборки',err);
    toast('Не удалось изменить отметку сборки.');
  }
}
async function toggleAssemblyProgress(){
  const o=state.orders.find(x=>x.id===selectedId);
  if(!o||!signedInUser)return;
  if(state.role!=='warehouse'&&!canManageUsers){toast('Начать или завершить сборку может кладовщик.');return;}
  if(o.status==='Отгружен кладовщиком'){toast('Отгруженный заказ нельзя вернуть в сборку.');return;}
  const previous={assemblyInProgress:o.assemblyInProgress,assemblyStartedAt:o.assemblyStartedAt,assemblyStartedBy:o.assemblyStartedBy,assemblyStartedByName:o.assemblyStartedByName,updatedAt:o.updatedAt,updatedBy:o.updatedBy,updatedByName:o.updatedByName};
  const next=o.assemblyInProgress!==true;
  const now=isoNow();
  const patch={assemblyInProgress:next,assemblyStartedAt:o.assemblyStartedAt||(next?now:''),assemblyStartedBy:o.assemblyStartedBy||(next?signedInUser.uid:''),assemblyStartedByName:o.assemblyStartedByName||(next?(profileName||roles[state.role]):''),updatedAt:now,updatedBy:signedInUser.uid,updatedByName:profileName||roles[state.role]};
  Object.assign(o,patch);
  try{
    await updateDoc(doc(db,'orders',o.id),patch);
    serverCache.set(o.id,{...serverCache.get(o.id),...o});
    await writeAudit(next?'Начата сборка заказа':'Сборка заказа завершена',next?'Кладовщик начал сборку заказа.':'Кладовщик завершил сборку заказа.',o.id);
    await queuePush(next?`Начата сборка заказа № ${o.number}`:`Сборка заказа № ${o.number} завершена`,next?'Кладовщик начал сборку заказа.':'Кладовщик завершил сборку заказа.',signedInUser.uid,o.id);
    render();
    openOrder(o.id);
  }catch(err){
    Object.assign(o,previous);
    console.error('Не удалось изменить состояние сборки',err);
    toast('Не удалось изменить сборку: '+(String(err?.code||'').replace(/^.*?\//,'')||'проверьте доступ и соединение'));
  }
}
async function saveArticles(){
 const o=state.orders.find(x=>x.id===selectedId);
 if(!o||!signedInUser)return;
 if(!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}
 const next=normalizeArticles(readArticles()),previous=normalizeArticles(o.articles||[]);
 if(articlesEqual(previous,next)){backDetail();return;}
 const entry={id:crypto.randomUUID(),kind:'system',text:`Состав заказа изменён: ${next.length?next.map(x=>`${x.article} × ${x.quantity}`).join(', '):'артикулы удалены'}`,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:isoNow(),photos:[]};
 const now=isoNow(),oldUpdated={updatedAt:o.updatedAt,updatedBy:o.updatedBy,updatedByName:o.updatedByName};
 const normalized=next.map(x=>({article:String(x.article||'').trim(),quantity:Math.max(1,Number(x.quantity)||1),collected:x.collected===true,shipmentChecked:x.shipmentChecked===true})).filter(x=>x.article);
 try{
   // Keep the write atomic, but update only fields permitted by the article-edit rule.
   // The history record is created in the same batch as the order's article patch.
   const batch=writeBatch(db);
   batch.update(doc(db,'orders',o.id),{articles:normalized,updatedAt:now,updatedBy:signedInUser.uid,updatedByName:profileName||roles[state.role]});
   batch.set(doc(db,'orders',o.id,'entries',entry.id),entryToCloud(entry));
   await batch.commit();
   o.articles=next;o.updatedAt=now;o.updatedBy=signedInUser.uid;o.updatedByName=profileName||roles[state.role];o.entries.push(entry);
   serverCache.set(o.id,{...(serverCache.get(o.id)||o),...o,articles:normalized,entries:[...(o.entries||[])]});
   closeModal();render();toast('Артикулы заказа сохранены.');notify(`Артикулы заказа № ${o.number} изменены`,o.id);openOrder(o.id);
 }catch(err){
   o.articles=previous;Object.assign(o,oldUpdated);
   console.error('Не удалось сохранить артикулы заказа № '+(o.number||o.id)+': ',err);
   toast('Не удалось сохранить артикулы: '+(String(err?.code||'').replace(/^.*?\//,'')||'проверьте доступ и соединение'));
 }
}
function addComment(){showModal('Добавить комментарий',`<form id="entryForm"><div class="field entry-mention-wrap"><label for="entryText">Сообщение *</label><textarea id="entryText" required placeholder="Напишите комментарий; используйте @ для упоминания" autocomplete="off"></textarea><div id="entryMentionSuggestions" class="chat-mention-suggestions entry-mention-suggestions" hidden></div></div><div class="field"><label class="important-message-option"><input id="entryImportant" type="checkbox"> <span>⚠ Сделать важным сообщением</span></label></div><div class="field"><label for="entryPhotos">Фото (необязательно)</label><div class="upload-box">Прикрепить фотографии<input id="entryPhotos" type="file" accept="image/*" multiple></div><span class="field-hint">Можно отправить обычный текст без артикула и фотографий.</span></div></form>`,[button('Назад','back-detail'),button('Отправить','save-entry','primary-button')],'КОММЕНТАРИЙ');modal.dataset.replyToEntryId='';$('entryKind')?.remove()}
function replyToEntry(entryId){const o=state.orders.find(x=>x.id===selectedId),entry=o?.entries.find(x=>x.id===entryId);if(!o||!entry||entry.kind!=='comment'){toast('Не удалось найти комментарий для ответа.');return;}showModal('Ответ на комментарий',`<div class="timeline-reply-reference"><b>${esc(entry.author||'Сотрудник')}</b><div>${esc(String(entry.text||'').slice(0,500))}${String(entry.text||'').length>500?'…':''}</div></div><form id="entryForm"><div class="field entry-mention-wrap"><label for="entryText">Ваш ответ *</label><textarea id="entryText" required placeholder="Напишите ответ…" autocomplete="off"></textarea><div id="entryMentionSuggestions" class="chat-mention-suggestions entry-mention-suggestions" hidden></div></div><div class="field"><label for="entryPhotos">Фото (необязательно)</label><div class="upload-box">Прикрепить фотографии<input id="entryPhotos" type="file" accept="image/*" multiple></div></div></form>`,[button('Назад','back-detail'),button('Отправить ответ','save-entry','primary-button')],'ОТВЕТ НА КОММЕНТАРИЙ');modal.dataset.replyToEntryId=entry.id;}
function addDefect(){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;if(!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}const options=(o.articles||[]).map((x,i)=>`<label class="defect-multi-option"><input type="checkbox" name="defectArticleIndex" value="${i}"><span><b>${esc(x.article)}</b> · ${Number(x.quantity)||1} шт. · позиция ${i+1}</span></label>`).join('');if(!options){toast('В заказе нет позиций для выбора дефекта.');return;}showModal('Добавить дефект',`<form id="entryForm"><input id="entryKind" type="hidden" value="defect"><div class="field"><label>Позиции с дефектом * (можно выбрать несколько)</label><div class="defect-multi-list">${options}</div></div><div class="field"><label for="entryText">Описание дефекта *</label><textarea id="entryText" required placeholder="Опишите, что не так с деталью"></textarea></div><div class="field"><label for="entryPhotos">Фото дефекта (необязательно)</label><div class="upload-box">Прикрепить фотографии<input id="entryPhotos" type="file" accept="image/*" multiple></div><span class="field-hint">Прикреплённые фото будут добавлены к первой отмеченной позиции.</span></div></form>`,[button('Назад','back-detail'),button('Добавить дефект','save-entry','primary-button')],'ДЕФЕКТ ДЕТАЛИ')}
function editDefect(entryId){const o=state.orders.find(x=>x.id===selectedId),e=o?.entries.find(x=>x.id===entryId);if(!o||!e||e.kind!=='defect'||e.decision||!(state.role==='warehouse'||canManageUsers)||!canEditOrder(o)){toast('Редактировать можно только нерассмотренный дефект в доступном для редактирования заказе.');return;}const options=(o.articles||[]).map((x,i)=>`<option value="${i}"${(Number.isInteger(e.articleIndex)?e.articleIndex===i:x.article===e.article)?' selected':''}>${esc(x.article)} · ${Number(x.quantity)||1} шт. · позиция ${i+1}</option>`).join('');showModal('Редактировать дефект',`<form id="editDefectForm"><div class="field"><label for="editDefectArticleIndex">Позиция заказа *</label><select id="editDefectArticleIndex" required>${options}</select></div><div class="field"><label for="editDefectText">Описание дефекта *</label><textarea id="editDefectText" required>${esc(e.text||'')}</textarea></div><div class="field"><label>Текущие фото</label><div class="photo-grid">${(e.photos||[]).map(p=>`<img src="${p}" alt="Фото дефекта" data-photo="${p}">`).join('')||'<span class="field-hint">Фото не прикреплены.</span>'}</div></div><div class="field"><label for="editDefectPhotos">Добавить фото</label><div class="upload-box">Прикрепить фотографии<input id="editDefectPhotos" type="file" accept="image/*" multiple></div><span class="field-hint">Существующие фото сохранятся; всего не более пяти фото.</span></div></form>`,[button('Назад','back-detail'),button('Сохранить дефект','save-defect-edit','primary-button')],'РЕДАКТИРОВАНИЕ ДЕФЕКТА');modal.dataset.editDefectId=entryId;}
async function saveDefectEdit(){const o=state.orders.find(x=>x.id===selectedId),id=modal.dataset.editDefectId,e=o?.entries.find(x=>x.id===id);if(!o||!e||e.kind!=='defect'||e.decision||!(state.role==='warehouse'||canManageUsers)||!canEditOrder(o)){toast('Редактирование недоступно для этого заказа.');return;}const articleIndex=Number($('editDefectArticleIndex')?.value),article=o.articles?.[articleIndex]?.article,text=$('editDefectText')?.value.trim()||'';if(!article||!Number.isInteger(articleIndex)||articleIndex<0||!text){toast('Выберите позицию и заполните описание.');return;}try{const blobs=await readPhotos($('editDefectPhotos')?.files||[]);if((e.photos||[]).length+blobs.length>5){toast('Всего можно прикрепить не более пяти фото.');return;}const added=await uploadPhotos(o.id,e.id,blobs);e.article=article;e.articleIndex=articleIndex;e.text=text;e.photos=[...(e.photos||[]),...added];await save();await writeAudit('Изменён дефект',`Артикул: ${article}`,o.id,{entryId:id});closeModal();render();openOrder(o.id);toast('Дефект обновлён.');}catch(err){console.error(err);toast(err.message||'Не удалось сохранить дефект.');}}
async function saveOrder(){const n=$('orderNumber').value.trim(),client=$('clientName').value.trim(),deliveryType=$('deliveryType')?.value==='pickup'?'pickup':'city';if(!n||!client){toast('Укажите номер заказа и имя клиента.');return}if(state.orders.some(o=>o.number.toLowerCase()===n.toLowerCase())){toast('Карточка с таким номером уже есть.');return}const articles=readArticles();const status=$('startStatus').value,comment=$('initialComment').value.trim();const o={id:crypto.randomUUID(),number:n,client,deliveryType,status,articles,createdAt:isoNow(),author:profileName||roles[state.role],createdBy:signedInUser.uid,entries:[]};if(comment)o.entries.push({id:crypto.randomUUID(),kind:'comment',text:comment,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:isoNow(),photos:[]});state.orders.unshift(o);await save();closeModal();render();toast('Карточка заказа создана.');notify(`Создан заказ № ${n}`,o.id)}
function appendClipboardImages(event,inputId,maxFiles=5,maxBytes=8*1024*1024){
  const input=$(inputId);
  const items=Array.from(event.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/'));
  if(!input||!items.length)return false;
  const pasted=items.map((item,index)=>item.getAsFile()).filter(Boolean).map((file,index)=>new File([file],file.name&&file.name!=='image.png'?file.name:`clipboard-image-${Date.now()}-${index+1}.${(file.type.split('/')[1]||'png').replace('jpeg','jpg')}`,{type:file.type||'image/png'}));
  const existing=Array.from(input.files||[]);
  const combined=[...existing,...pasted];
  if(combined.length>maxFiles){toast('Можно прикрепить не более '+maxFiles+' изображений.');return true;}
  if(combined.some(file=>file.size>maxBytes)){toast('Изображение из буфера слишком большое. Максимум '+Math.round(maxBytes/1024/1024)+' МБ на файл.');return true;}
  try{
    const transfer=new DataTransfer();
    combined.forEach(file=>transfer.items.add(file));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    toast('Изображение из буфера добавлено.');
  }catch(err){console.error('Не удалось добавить изображение из буфера',err);toast('Браузер не позволил прикрепить изображение из буфера. Используй кнопку «Фото».');}
  return true;
}
document.addEventListener('paste',event=>{
  const target=event.target;
  if(target?.id==='chatInput'){
    if(appendClipboardImages(event,'chatPhotoInput',5,8*1024*1024))event.preventDefault();
  }else if(target?.id==='entryText'||target?.id==='article'){
    if(appendClipboardImages(event,'entryPhotos',5,8*1024*1024))event.preventDefault();
  }
});
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
  return Promise.all(blobs.map(async(blob,i)=>{
    const path=`orders/${orderId}/${entryId}/photo-${i+1}-${crypto.randomUUID()}.jpg`;
    const fileRef=storageRef(storage,path);
    await uploadBytes(fileRef,blob,{contentType:'image/jpeg'});
    return getDownloadURL(fileRef);
  }));
}
let entrySending=false;
async function saveEntry(){
  if(entrySending)return;
  const kind=$('entryKind')?.value||'comment',text=$('entryText').value.trim(),o=state.orders.find(x=>x.id===selectedId),replyToEntryId=kind==='comment'?String(modal.dataset.replyToEntryId||''):'',replyTarget=replyToEntryId?(o?.entries||[]).find(e=>e.id===replyToEntryId):null,articleIndexes=kind==='defect'?[...document.querySelectorAll('input[name="defectArticleIndex"]:checked')].map(x=>Number(x.value)):[-1],articleIndex=articleIndexes[0]??-1,article=kind==='defect'?(o?.articles?.[articleIndex]?.article||''):'';if(!text){toast('Напишите сообщение.');return}if(kind==='defect'&&(!o||!articleIndexes.length||articleIndexes.some(i=>!Number.isInteger(i)||i<0||!o.articles?.[i]))){toast('Выберите хотя бы одну позицию заказа.');return}
if(!o)return;if(kind!=='comment'&&!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}if(hasPendingDefect(o)&&kind!=='comment'){toast('Пока дефект не рассмотрен, можно добавлять только комментарии.');return}const sendButton=document.querySelector('[data-action="save-entry"]');
entrySending=true;
if(sendButton){sendButton.disabled=true;sendButton.textContent='Отправка…';}
const previousStatus=o.status;
try{
const photoBlobs=await readPhotos($('entryPhotos').files);const important=kind==='comment'&&$('entryImportant')?.checked===true;
const entryId=crypto.randomUUID();
const photos=await uploadPhotos(o.id,entryId,photoBlobs);
if(kind==='defect'){o.status='Дефект';articleIndexes.forEach((idx,n)=>{const item=o.articles[idx];o.entries.push({id:n===0?entryId:crypto.randomUUID(),kind,article:item.article,articleIndex:idx,text,important:false,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:isoNow(),photos:n===0?photos:[]});});}else{o.entries.push({id:entryId,kind,article:'',...(replyTarget?{replyToEntryId:replyTarget.id,replyToAuthorId:replyTarget.authorId||'',replyToAuthorName:replyTarget.author||'Сотрудник',replyToText:String(replyTarget.text||'').slice(0,500)}:{}),text,important,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:isoNow(),photos});}await save();if(kind==='comment'){if(replyTarget?.authorId&&replyTarget.authorId!==signedInUser.uid){await queuePush(profileName||roles[state.role],`Ответ на ваш комментарий: ${text}`,signedInUser.uid,o.id,'site','replies',replyTarget.authorId,{isReply:true});}const tokens=[...text.matchAll(/(^|[\s])@([\p{L}\p{N}_-]{2,})/gu)].map(x=>x[2].toLocaleLowerCase('ru'));const mentioned=[...new Map(knownChatPeople.map(p=>[p.id,p])).values()].filter(p=>p.id&&p.id!==signedInUser.uid&&p.id!==replyTarget?.authorId&&tokens.includes(chatMentionToken(p.name).toLocaleLowerCase('ru')));await Promise.all(mentioned.map(p=>queuePush(profileName||roles[state.role],text,signedInUser.uid,o.id,'site','replies',p.id,{isMention:true})));}await writeAudit(kind==='defect'?'Добавлен дефект':'Добавлен комментарий',text,o.id,{entryId});closeModal();render();if(kind==='defect'){const defectToast=toast(`⚠️ ДЕФЕКТ · Заказ № ${o.number}`,o.id);defectToast.classList.add('defect-toast');}else{toast('Запись добавлена в историю заказа.');}notify(`${kind==='defect'?'Дефект':'Комментарий'} к заказу № ${o.number}`,o.id);openOrder(o.id)
}catch(e){if(kind==='defect'&&o?.status==='Дефект'&&previousStatus){o.status=previousStatus;}toast(e.message)}
finally{entrySending=false;if(sendButton){sendButton.disabled=false;sendButton.textContent=kind==='defect'?'Добавить дефект':'Отправить';}}}
async function setStatus(status,text,kind='system'){const o=state.orders.find(x=>x.id===selectedId);if(!o||!signedInUser)return;if(!canEditOrder(o)){toast('После отгрузки заказ заблокирован для этой роли.');return;}if(hasPendingDefect(o)){toast('Пока есть нерассмотренный дефект, другие изменения заказа заблокированы.');return;}const previous=o.status;const previousTransferredAt=o.transferredAt;const previousResumedAt=o.resumedAt;const previousAssembledAt=o.assembledAt;const previousShippedAt=o.shippedAt;const previousAssemblyInProgress=o.assemblyInProgress;const now=isoNow();const entry={id:crypto.randomUUID(),kind,text,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:now,photos:[]};const statusUpdate={status,updatedAt:now,updatedBy:signedInUser.uid,updatedByName:profileName||roles[state.role]};if(status==='Собран'){o.assembledAt=now;statusUpdate.assembledAt=now;}if(status==='Отгружен кладовщиком'){o.shippedAt=now;statusUpdate.shippedAt=now;}if(status==='Собран'||status==='Отгружен кладовщиком'){o.assemblyInProgress=false;statusUpdate.assemblyInProgress=false;}if(status==='Перенесен'){o.transferredAt=now;statusUpdate.transferredAt=now;}if(previous==='Перенесен'&&status!=='Перенесен'){o.resumedAt=now;statusUpdate.resumedAt=now;}try{o.status=status;await updateDoc(doc(db,'orders',o.id),statusUpdate);await setDoc(doc(db,'orders',o.id,'entries',entry.id),entryToCloud(entry));o.entries.push(entry);serverCache.set(o.id,{...serverCache.get(o.id),...o});await writeAudit('Изменён статус заказа',text,o.id,{previousStatus:previous,newStatus:status});await queuePush(`${o.client||'Клиент не указан'} · ${status}`,text,signedInUser.uid,o.id);render();notify(`Заказ № ${o.number}: ${status}`,o.id);openOrder(o.id)}catch(err){o.status=previous;o.transferredAt=previousTransferredAt;o.resumedAt=previousResumedAt;o.assembledAt=previousAssembledAt;o.shippedAt=previousShippedAt;o.assemblyInProgress=previousAssemblyInProgress;console.error('Ошибка изменения статуса заказа',err);toast('Не удалось изменить статус: '+(err?.message||'нет доступа'));}}
function cancelOrder(){const o=state.orders.find(x=>x.id===selectedId);if(o&&!canEditOrder(o)){toast('После отгрузки или получения заказа клиентом отменять заказ могут только администратор и директор.');return;}showModal('Отменить заказ',`<p style="font-size:12px;color:#697382;margin:0 0 14px">Укажите причину отмены заказа № ${esc(o.number)}. Причина сохранится в истории.</p><div class="field"><label for="cancelReason">Причина отмены *</label><textarea id="cancelReason" required placeholder="Почему заказ отменён?"></textarea></div>`,[button('Назад','back-detail'),button('Отменить заказ','confirm-cancel','small-button danger')],'РЕШЕНИЕ МЕНЕДЖЕРА')}
function approveOrder(){showModal('Одобрить на отгрузку',`<p style="font-size:12px;color:#697382;margin:0 0 12px">Заказ № ${esc(state.orders.find(x=>x.id===selectedId)?.number||'')} будет отмечен как одобренный к отгрузке клиенту.</p><div class="field"><label for="approvalComment">Комментарий менеджера (необязательно)</label><textarea id="approvalComment" placeholder="Добавьте пояснение для кладовщика"></textarea></div>`,[button('Назад','back-detail'),button('Одобрить','confirm-approve','small-button good')],'РЕШЕНИЕ МЕНЕДЖЕРА')}
function confirmApprove(){const note=$('approvalComment').value.trim()||'Согласовано к отгрузке клиенту.';setStatus('Одобрен на отгрузку клиенту',note,'decision')}
function confirmCancel(){const reason=$('cancelReason').value.trim();if(!reason){toast('Напишите причину отмены.');return}setStatus('Отменён',reason,'decision')}
function markViewed(){const o=state.orders.find(x=>x.id===selectedId);if(o.entries.some(e=>e.kind==='viewed'&&e.authorId===signedInUser.uid)){toast('Вы уже отмечали этот заказ просмотренным.');return}o.entries.push({id:crypto.randomUUID(),kind:'viewed',text:`${profileName||roles[state.role]} отметил(а), что увидел(а) собранный заказ.`,authorId:signedInUser.uid,author:profileName||roles[state.role],createdAt:isoNow(),photos:[]});save();render();notify(`Менеджер ${profileName||''} просмотрел заказ № ${o.number}`,o.id);openOrder(o.id)}
function decideDefect(entryId,decision){const o=state.orders.find(x=>x.id===selectedId),e=o?.entries.find(x=>x.id===entryId);if(!o||!e||e.kind!=='defect'||e.decision||!(isManagerRole()||canManageUsers)){toast('Этот дефект уже рассмотрен или у вас нет прав на решение.');return}if(decision==='Удалена из заказа'){pendingDefectId=entryId;showModal('Удалить позицию из заказа?',`<div class="danger-note">Артикул ${esc(e.article)} будет помечен как удалённый, сохранится в истории и не попадёт в отгрузку. Остальные позиции заказа останутся без изменений.</div><div class="field"><label for="defectReason">Причина решения (необязательно)</label><textarea id="defectReason" placeholder="Укажите причину удаления позиции"></textarea></div>`,[button('Назад','back-detail'),button('Удалить позицию','confirm-defect-remove','small-button danger')],'РЕШЕНИЕ ПО ДЕФЕКТУ');return}if(decision==='Отменён'){showModal('Отменить заказ',`<p style="font-size:12px;color:#697382;margin:0 0 12px">Напишите причину отмены заказа № ${esc(o.number)} по дефекту артикула ${esc(e.article)}.</p><div class="field"><label for="defectReason">Причина отмены *</label><textarea id="defectReason" required placeholder="Почему заказ отменён?"></textarea></div>`,[button('Назад','back-detail'),button('Отменить заказ','confirm-defect-cancel','small-button danger')],'ОТМЕНА ЗАКАЗА');return}e.decision='Подтверждён';e.decisionText=`Дефект подтверждён сотрудником ${profileName||roles[state.role]}.`;e.decidedBy=profileName||roles[state.role];e.decidedByName=profileName||roles[state.role];e.decidedAt=isoNow();o.status='Создан';save();render();writeAudit('Дефект подтверждён',`Артикул: ${e.article}; статус заказа возвращён на «Создан».`,o.id,{entryId:e.id});notify(`Дефект артикула ${e.article} по заказу № ${o.number} подтверждён — статус возвращён на «Создан»`,o.id);openOrder(o.id)}
function confirmDefectRemove(){const reason=$('defectReason')?.value.trim()||'';const o=state.orders.find(x=>x.id===selectedId),e=o?.entries.find(x=>x.id===pendingDefectId);if(!o||!e||e.kind!=='defect'||e.decision||!((isManagerRole()||canManageUsers))){toast('Не удалось удалить позицию: проверьте права и состояние дефекта.');return;}e.decision='Удалена из заказа';e.decisionText=reason||'Позиция удалена из заказа по решению менеджера.';e.decidedBy=profileName||roles[state.role];e.decidedByName=profileName||roles[state.role];e.decidedAt=isoNow();o.status='Создан';pendingDefectId=null;save();render();writeAudit('Позиция удалена из заказа по дефекту',`Артикул: ${e.article}; ${e.decisionText}; статус заказа возвращён на «Создан», позиция исключена из отгрузки.`,o.id,{entryId:e.id});notify(`Позиция ${e.article} удалена из заказа № ${o.number}; статус возвращён на «Создан»`,o.id);openOrder(o.id)}
function confirmDefectCancel(){const reason=$('defectReason').value.trim();if(!reason){toast('Укажите причину решения.');return}const o=state.orders.find(x=>x.id===selectedId),e=o.entries.find(x=>x.id===pendingDefectId);if(!e)return;e.decision='Отменён';e.decisionText=reason;e.decidedBy=profileName||roles[state.role];e.decidedByName=profileName||roles[state.role];e.decidedAt=isoNow();o.status='Отменён';pendingDefectId=null;save();render();notify(`Заказ № ${o.number} отменён по дефекту артикула ${e.article}: ${reason}`,o.id);toast('Кладовщик получит уведомление об отмене заказа.');openOrder(o.id)}
function deleteOrder(){if(!canManageUsers)return;const current=state.orders.find(x=>x.id===selectedId);if(current&&hasPendingDefect(current)){toast('Нельзя удалить заказ, пока не рассмотрен дефект.');return;}const o=state.orders.find(x=>x.id===selectedId);if(!o)return;showModal('Удалить карточку?',`<div class="danger-note">Заказ № ${esc(o.number)} и его записи сначала сохранятся в отдельной истории удалённых заказов, а затем исчезнут из общего списка.</div>`,[button('Назад','back-detail'),button('Удалить карточку','confirm-delete','small-button danger')],'УДАЛЕНИЕ ЗАКАЗА')}
function deleteEntry(entryId){const o=state.orders.find(x=>x.id===selectedId),entry=o.entries.find(x=>x.id===entryId);if(!entry||state.role!=='director')return;showModal('Удалить запись?',`<div class="danger-note">Комментарий и прикреплённые к нему фото будут удалены. Действие попадёт в журнал директора.</div>`,[button('Назад','back-detail'),button('Удалить запись','confirm-delete-entry:'+entryId,'small-button danger')],'ДЕЙСТВИЕ ДИРЕКТОРА')}
function confirmDeleteEntry(entryId){const o=state.orders.find(x=>x.id===selectedId),entry=o.entries.find(x=>x.id===entryId);if(!entry)return;const label=entry.article?`дефект артикула ${entry.article}`:({comment:'комментарий',question:'вопрос',decision:'решение',viewed:'отметку о просмотре'})[entry.kind]||'запись';o.entries=o.entries.filter(x=>x.id!==entryId);state.notices.unshift({id:crypto.randomUUID(),message:`Директор удалил ${label} из заказа № ${o.number}`,orderId:null,at:isoNow(),read:false,kind:'audit'});save();render();toast('Удаление внесено в журнал действий.');openOrder(o.id)}
async function confirmDelete(){if(!canManageUsers)return;const o=state.orders.find(x=>x.id===selectedId);if(!o)return;let archived=false;try{const sourceRef=doc(db,'orders',o.id),sourceSnap=await getDoc(sourceRef);if(!sourceSnap.exists()){toast('Заказ уже удалён или недоступен.');return}const sourceEntries=await getDocs(collection(db,'orders',o.id,'entries')),archiveRef=doc(db,'deletedOrders',o.id),archiveSnap=await getDoc(archiveRef);if(!archiveSnap.exists()||archiveSnap.data().complete!==true){if(!archiveSnap.exists()){const data=sourceSnap.data();await setDoc(archiveRef,{sourceOrderId:o.id,number:data.number||o.number,client:data.client||o.client||'',status:data.status||o.status,createdAt:data.createdAt||o.createdAt,createdBy:data.createdBy||'',createdByName:data.createdByName||o.author||'',entriesCount:sourceEntries.size,deletedAt:isoNow(),deletedBy:signedInUser.uid,deletedByName:profileName,deletedByEmail:signedInUser.email||'',complete:false})}for(let i=0;i<sourceEntries.docs.length;i+=450){const batch=writeBatch(db);for(const entrySnap of sourceEntries.docs.slice(i,i+450)){const entry=entryFromCloud(entrySnap.id,entrySnap.data());batch.set(doc(db,'deletedOrders',o.id,'entries',entrySnap.id),entryToCloud(entry))}await batch.commit()}await updateDoc(archiveRef,{complete:true})}archived=true;for(let i=0;i<sourceEntries.docs.length;i+=450){const batch=writeBatch(db);for(const entrySnap of sourceEntries.docs.slice(i,i+450))batch.delete(entrySnap.ref);await batch.commit()}await writeAudit('Удалён заказ',`Заказ № ${o.number}; статус: ${o.status}`,o.id);await queuePush(`Заказ № ${o.number} удалён`,`Заказ удалён администратором ${profileName || 'сотрудником'}.`,signedInUser.uid,o.id);await deleteDoc(sourceRef);entryUnsubscribes.get(o.id)?.();entryUnsubscribes.delete(o.id);serverCache.delete(o.id);state.orders=state.orders.filter(x=>x.id!==o.id);state.notices.unshift({id:crypto.randomUUID(),message:`Администратор ${profileName} удалил заказ № ${o.number}`,orderId:null,at:isoNow(),read:false,kind:'audit'});closeModal();render();toast('Заказ удалён и сохранён в истории.')}catch(err){console.error('Не удалось удалить заказ с архивированием',err);toast(archived?'Заказ сохранён в истории, но оригинал удалить не удалось. Повторите операцию позже.':'Не удалось заархивировать заказ. Оригинал сохранён. Проверьте правила Firestore и повторите попытку.')}}
async function showDeletedOrders(){if(!canManageUsers)return;try{const snap=await getDocs(collection(db,'deletedOrders')),archives=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.complete===true).sort((a,b)=>String(b.deletedAt||'').localeCompare(String(a.deletedAt||'')));const rows=archives.map(a=>`<div class="notice-item"><b>Заказ № ${esc(a.number||'—')} · ${esc(a.client||'без клиента')}</b><small>${esc(a.status||'')} · удалил ${esc(a.deletedByName||a.deletedByEmail||'администратор')} · ${fmtDateTime(a.deletedAt)} · записей: ${Number(a.entriesCount)||0}</small>${button('Открыть историю','view-deleted-order:'+esc(a.id),'small-button primary-soft')}</div>`).join('');showModal('История удалённых заказов',`<div class="notice-list">${rows||'<div class="danger-note">Удалённых заказов пока нет.</div>'}</div>`,[button('Назад','back-profile'),button('Закрыть','close')],'АРХИВ');}catch(err){console.error('Не удалось загрузить архив заказов',err);toast('Не удалось загрузить историю. Проверьте опубликованные правила Firestore.')}}
async function showDeletedOrder(id){if(!canManageUsers)return;try{const archiveSnap=await getDoc(doc(db,'deletedOrders',id));if(!archiveSnap.exists()||archiveSnap.data().complete!==true){toast('Запись истории не найдена.');showDeletedOrders();return}const a=archiveSnap.data(),entriesSnap=await getDocs(collection(db,'deletedOrders',id,'entries')),entries=entriesSnap.docs.map(d=>({id:d.id,...entryFromCloud(d.id,d.data())})).sort((x,y)=>new Date(x.createdAt)-new Date(y.createdAt)),timeline=entries.map(e=>`<article class="timeline-item"><div class="timeline-top"><span><b>${esc(e.author||'Сотрудник')}</b> · ${fmtDateTime(e.createdAt)}</span><span class="timeline-type">${esc(({defect:'ДЕФЕКТ',question:'ВОПРОС',decision:'РЕШЕНИЕ',comment:'КОММЕНТАРИЙ',viewed:'ПРОСМОТРЕНО',system:'СИСТЕМА'})[e.kind]||'ЗАПИСЬ')}</span></div>${e.kind==='comment'?button('↩ Ответить','reply-entry:'+e.id,'small-button primary-soft'):''}${replyTarget?`<div class="timeline-reply-reference"><b>Ответ на комментарий · ${esc(e.replyToAuthorName||replyTarget.author||'Сотрудник')}</b><div>${esc(String(e.replyToText||replyTarget.text||'').slice(0,220))}${String(e.replyToText||replyTarget.text||'').length>220?'…':''}</div></div>`:''}${e.article?`<div class="timeline-article">Артикул: ${esc(e.article)}</div>`:''}<div class="timeline-text">${esc(e.text||'')}</div>${e.photos?.length?`<div class="photo-grid">${e.photos.map(p=>`<img src="${esc(p)}" alt="Фото из удалённого заказа" data-photo="${esc(p)}">`).join('')}</div>`:''}</article>`).join('');showModal(`Архив · заказ № ${a.number||'—'}`,`<div class="order-detail-head"><div><div class="detail-number">${esc(a.client||'')}</div><div class="detail-meta">Создан ${fmtDateTime(a.createdAt)} · удалил ${esc(a.deletedByName||a.deletedByEmail||'администратор')} · ${fmtDateTime(a.deletedAt)}</div></div><div>${statusPill(a.status||'Удалён')}</div></div><div class="timeline">${timeline||'<div class="danger-note">У заказа не было записей.</div>'}</div>`,[button('Назад к архиву','deleted-orders'),button('Закрыть','close')],'ИСТОРИЯ УДАЛЁННЫХ ЗАКАЗОВ')}catch(err){console.error('Не удалось открыть архивный заказ',err);toast('Не удалось открыть заказ из истории.')}}
function paintNotices(){const unread=state.notices.some(n=>!n.read&&state.notificationSettings[n.category||(n.target==='chat'?'chat':'orders')]!==false);$('notificationButton').classList.toggle('has-notice',unread);paintChatBadge()}
async function disablePush(){try{if(!signedInUser)throw new Error('User is not signed in');const installationId=localStorage.getItem('ampPushInstallationId');const tokensRef=collection(db,'users',signedInUser.uid,'pushTokens');const snap=await getDocs(tokensRef);const batch=writeBatch(db);for(const tokenDoc of snap.docs){const data=tokenDoc.data()||{};if(installationId&&data.installationId===installationId)batch.delete(tokenDoc.ref)}await batch.commit();await deleteToken(messaging).catch(()=>{});toast('Push-уведомления выключены на этом устройстве.')}catch(err){console.error('Не удалось выключить push',err);toast('Не удалось выключить уведомления. Попробуйте ещё раз.')}}
async function toggleNotificationSetting(category){if(!signedInUser||!['chat','replies','likes','orders'].includes(category))return;const next=state.notificationSettings[category]===false;try{state.notificationSettings[category]=next;await updateDoc(doc(db,'users',signedInUser.uid),{notificationSettings:state.notificationSettings});toast(next?'Уведомления включены.':'Уведомления выключены.');showNotifications()}catch(err){console.error('Не удалось изменить настройку уведомлений',err);state.notificationSettings[category]=!next;toast('Не удалось сохранить настройку уведомлений.')}}
async function toggleExtraPhoneNotifications(){if(!signedInUser)return;const previous=state.extraPhoneNotifications;const next=!previous;try{await updateDoc(doc(db,'users',signedInUser.uid),{extraPhoneNotifications:next});state.extraPhoneNotifications=next;toast(next?'Дополнительные уведомления на все устройства включены.':'Дополнительные уведомления на все устройства выключены.');showNotifications()}catch(err){console.error('Не удалось сохранить настройку дополнительных уведомлений на все устройства',err);state.extraPhoneNotifications=previous;toast('Не удалось сохранить настройку. Проверьте подключение и права доступа.');showNotifications()}}

let chatMessages=[],olderChatMessages=[],chatOldestCursor=null,hasOlderChatMessages=false,loadingOlderChatMessages=false,chatPendingScrollRestore=null;
let knownChatPeople=[];

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

function chatDisplayName(value){
  const name=String(value||'Сотрудник').trim();
  const normalized=name.toLocaleLowerCase('ru').replace(/\\s+/g,' ');
  if(normalized==='глеб тест'||normalized==='gleb test')return 'Test';
  if(normalized==='глеб бурячок'||normalized==='gleb боричок'||normalized==='gleb boryachok')return 'Глеб';
  return name;
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
  const people=[...new Map([...knownChatPeople,...chatMessages.filter(m=>m.authorId&&m.authorName).map(m=>({id:m.authorId,name:chatDisplayName(m.authorName)}))].filter(p=>p.id&&p.name).map(p=>[p.id,p])).values()]
    .filter(p=>p.id!==signedInUser?.uid)
    .filter(p=>chatMentionToken(p.name).toLocaleLowerCase('ru').startsWith(needle))
    .slice(0,6);
  if(!people.length){list.hidden=true;list.innerHTML='';return;}
  list.innerHTML=people.map(p=>'<button type="button" data-chat-mention="'+esc(chatMentionToken(p.name))+'">@'+esc(chatMentionToken(p.name))+' <small>'+esc(p.name)+'</small></button>').join('');
  list.hidden=false;
}
function clientNameSuggestions(inputId,listId){
  const input=$(inputId),list=$(listId);
  if(!input||!list)return;
  const needle=input.value.trim().toLocaleLowerCase('ru');
  if(!needle){list.hidden=true;list.innerHTML='';return;}
  // The client directory is the single source of truth for autocomplete.
  // Never infer suggestions from historical orders.
  const matches=(clients||[])
    .filter(c=>!c.hiddenFromDirectory)
    .map(c=>({name:String(c.name||'').trim(),client:c}))
    .filter(c=>c.name&&!/подробное описание|тестовый клиент|^тест\\b/i.test(c.name))
    .filter(c=>c.name.toLocaleLowerCase('ru').includes(needle))
    .sort((a,b)=>{
      const x=a.name.toLocaleLowerCase('ru'),y=b.name.toLocaleLowerCase('ru');
      const xs=x.startsWith(needle)?1:0,ys=y.startsWith(needle)?1:0;
      return ys-xs||x.localeCompare(y,'ru');
    })
    .slice(0,8);
  if(!matches.length){list.hidden=true;list.innerHTML='';return;}
  list.innerHTML=matches.map(c=>'<button type="button" class="client-suggestion" data-order-client-suggestion="'+esc(c.name)+'"><b>'+esc(c.name)+'</b><small>'+(c.client.phone?esc(c.client.phone):'Клиент из справочника')+'</small></button>').join('');
  list.hidden=false;
}
function chooseOrderClientSuggestion(inputId,listId,name){
  const input=$(inputId),list=$(listId);
  if(!input)return;
  input.value=name;
  if(list){list.hidden=true;list.innerHTML='';}
  input.focus();
}
function entryMentionSuggestions(){
  const input=$('entryText'),list=$('entryMentionSuggestions');
  if(!input||!list)return;
  const value=input.value.slice(0,input.selectionStart??input.value.length);
  const match=value.match(/(?:^|[\s])@([\p{L}\p{N}_-]*)$/u);
  if(!match){list.hidden=true;list.innerHTML='';return;}
  const needle=match[1].toLocaleLowerCase('ru');
  const people=[...new Map([...knownChatPeople,...chatMessages.filter(m=>m.authorId&&m.authorName).map(m=>({id:m.authorId,name:chatDisplayName(m.authorName)}))].filter(p=>p.id&&p.name).map(p=>[p.id,p])).values()]
    .filter(p=>p.id!==signedInUser?.uid)
    .filter(p=>chatMentionToken(p.name).toLocaleLowerCase('ru').startsWith(needle))
    .slice(0,6);
  if(!people.length){list.hidden=true;list.innerHTML='';return;}
  list.innerHTML=people.map(p=>'<button type="button" data-entry-mention="'+esc(chatMentionToken(p.name))+'">@'+esc(chatMentionToken(p.name))+' <small>'+esc(p.name)+'</small></button>').join('');
  list.hidden=false;
}
function insertEntryMention(token){
  const input=$('entryText');
  if(!input)return;
  const start=input.selectionStart??input.value.length;
  const before=input.value.slice(0,start).replace(/@[\p{L}\p{N}_-]*$/u,'@'+token);
  input.value=before+input.value.slice(start);
  const pos=before.length;
  input.setSelectionRange(pos,pos);
  input.focus();
  entryMentionSuggestions();
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
async function loadOlderChatMessages(){
  if(loadingOlderChatMessages||!hasOlderChatMessages||!chatOldestCursor||!$('chatMessages'))return;
  loadingOlderChatMessages=true;
  const box=$('chatMessages');
  try{
    const olderQuery=query(collection(db,'chatMessages'),orderBy('createdAt','desc'),startAfter(chatOldestCursor),limit(50));
    const snap=await getDocs(olderQuery);
    if(!snap.empty){
      chatPendingScrollRestore={top:box.scrollTop,height:box.scrollHeight};
      const known=new Set([...chatMessages,...olderChatMessages].map(m=>m.id));
      const loaded=snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>(m.text||Array.isArray(m.photos)&&m.photos.length)&&!known.has(m.id));
      olderChatMessages=[...olderChatMessages,...loaded];
      
      chatOldestCursor=snap.docs.at(-1);
      hasOlderChatMessages=snap.docs.length===50;
      renderChatMessages();
    }else hasOlderChatMessages=false;
  }catch(err){console.error('Не удалось загрузить старые сообщения чата',err);toast('Не удалось загрузить старые сообщения. Проверьте соединение.');}
  finally{loadingOlderChatMessages=false;}
}
function renderChatMessages(){
  const box=$('chatMessages');
  if(!box)return;
  const wasAtBottom=box.scrollHeight-box.clientHeight-box.scrollTop<80;
  const previousScrollTop=box.scrollTop;
  const queryText=chatFilterText.toLocaleLowerCase('ru');
  const activeChatFilter=$('chatFilter')?.value||chatFilterMode||'all';
  const orderCommentMessages=state.orders.flatMap(o=>(o.entries||[]).filter(e=>e.kind==='comment'&&String(e.text||'').trim()).map(e=>({id:'order-comment-'+o.id+'-'+e.id,source:'order-comment',orderId:o.id,orderNumber:o.number,client:o.client||'',authorName:e.author||'Сотрудник',text:e.text||'',createdAt:e.createdAt||o.createdAt,photos:Array.isArray(e.photos)?e.photos:[]})));
  // Always combine the latest snapshot with order comments; do not reuse a stale timeline cache.
  const combinedMessages=[...olderChatMessages,...chatMessages,...orderCommentMessages].sort((x,y)=>{const time=v=>v?.toMillis?v.toMillis():new Date(v||0).getTime();return time(x.createdAt)-time(y.createdAt)||String(x.id).localeCompare(String(y.id))});
  // Keep ordinary staff chat messages at the end of the default All timeline so order comments cannot push them out of the visible bottom area.
  if(activeChatFilter==='all'&&!queryText){combinedMessages.sort((x,y)=>{const ax=x.source==='order-comment'?0:1,ay=y.source==='order-comment'?0:1;return ax-ay||(x.createdAt?.toMillis?x.createdAt.toMillis():new Date(x.createdAt||0).getTime())-(y.createdAt?.toMillis?y.createdAt.toMillis():new Date(y.createdAt||0).getTime())});}
  const visibleMessages=combinedMessages.filter(m=>{
    const hay=(String(m.authorName||'')+' '+String(m.text||'')+' '+String(m.replyToText||'')).toLocaleLowerCase('ru');
    if(queryText&&!hay.includes(queryText))return false;
    if(activeChatFilter==='mine'&&m.source==='order-comment')return false;
    if(activeChatFilter==='mine'&&m.authorId!==signedInUser?.uid)return false;
    if(activeChatFilter==='photos'&&!(Array.isArray(m.photos)&&m.photos.length))return false;
    if(activeChatFilter==='replies'&&!m.replyToId)return false;
    return true;
  });
  if(!visibleMessages.length){
    box.innerHTML='<div class="chat-empty">Пока никто ничего не написал. Будьте первым 🙂</div>';
  }else{
    let previousChatDay='';
    box.innerHTML=visibleMessages.map(m=>{
      const chatDateLabel=fmtDateTime(m.createdAt).split(',')[0];
      const chatDayDivider=chatDateLabel!==previousChatDay?'<div class="chat-day-divider"><span>'+esc(chatDateLabel)+'</span></div>':'';
      previousChatDay=chatDateLabel;
      const mine=m.authorId===signedInUser?.uid;
      const photos=Array.isArray(m.photos)?m.photos:[];
      if(m.source==='order-comment'){
        return chatDayDivider+'<button type="button" class="chat-order-comment" data-open-order-comment="'+esc(m.orderId)+'"><span class="chat-order-comment-label">Комментарий к заказу № '+esc(m.orderNumber)+'</span><span class="chat-order-comment-author">'+esc(m.authorName)+' · '+esc(m.client||'Заказ')+'</span><span class="chat-order-comment-text">'+esc(m.text)+'</span><span class="chat-order-comment-link">Открыть заказ ↗</span></button>';
      }
      const likes=Array.isArray(m.likes)?m.likes:[];
      const liked=likes.includes(signedInUser?.uid);
      const photoHtml=photos.length?'<div class="chat-photo-grid">'+photos.map(p=>'<a href="'+esc(p)+'" target="_blank" rel="noopener"><img src="'+esc(p)+'" alt="Фото из общего чата" loading="lazy"></a>').join('')+'</div>':'';
      const replyHtml=m.replyToId?'<div class="chat-reply-quote"><b>Ответ на '+esc(m.replyToAuthorName||'сообщение')+'</b><span>'+esc(m.replyToText||'📷 Фото')+'</span></div>':'';
      const likeHtml='<button type="button" class="chat-like-button '+(liked?'active':'')+'" data-action="toggle-chat-like:'+esc(m.id)+'" aria-label="Нравится">👍 <span>'+likes.length+'</span></button>'; const readBy=Array.isArray(m.readBy)?m.readBy:[]; const receipt=mine?'<span class="chat-read-receipt" title="'+(readBy.some(id=>id!==signedInUser?.uid)?'Прочитано':'Отправлено')+'">'+(readBy.some(id=>id!==signedInUser?.uid)?'✓✓':'✓')+'</span>':'';
      const roleMeta=({admin:{label:'Администратор',icon:'⚙',tone:'admin'},administrator:{label:'Администратор',icon:'⚙',tone:'admin'},warehouse:{label:'Кладовщик',icon:'▦',tone:'warehouse'},manager:{label:'Менеджер',icon:'↗',tone:'manager'},chief_accountant:{label:'Главный бухгалтер',icon:'₽',tone:'chief-accountant'},accountant:{label:'Бухгалтер',icon:'▤',tone:'accountant'},director:{label:'Директор',icon:'♛',tone:'director'}})[m.authorRole]||{label:'Сотрудник',icon:'•',tone:'unknown'};
      const roleBadge='<span class="chat-role-badge chat-role-'+roleMeta.tone+'" title="'+esc(roleMeta.label)+'"><span aria-hidden="true">'+roleMeta.icon+'</span>'+esc(roleMeta.label)+'</span>';
      return chatDayDivider+'<article class="chat-message chat-author-role-'+roleMeta.tone+' '+(mine?'mine':'')+'"><div class="chat-message-head"><span class="chat-author-line"><span class="chat-role-avatar chat-role-avatar-'+roleMeta.tone+'" aria-hidden="true">'+roleMeta.icon+'</span><b>'+esc(chatDisplayName(m.authorName))+'</b>'+roleBadge+'</span><time>'+esc(fmtDateTime(m.createdAt))+'</time></div>'+replyHtml+'<div class="chat-message-text">'+renderChatText(m.text)+'</div>'+photoHtml+'<div class="chat-message-actions">'+likeHtml+'<button type="button" class="chat-reply-button" data-action="reply-chat:'+esc(m.id)+'">↩ Ответить</button>'+receipt+'</div></article>';
    }).join('');
    if(chatPendingScrollRestore){box.scrollTop=chatPendingScrollRestore.top+(box.scrollHeight-chatPendingScrollRestore.height);chatPendingScrollRestore=null;}
    else if(wasAtBottom){
      const scrollChatToBottom=()=>{box.scrollTop=box.scrollHeight;};
      scrollChatToBottom();
      requestAnimationFrame(scrollChatToBottom);
      setTimeout(scrollChatToBottom,0);
      box.querySelectorAll('img').forEach(img=>{
        if(!img.complete)img.addEventListener('load',scrollChatToBottom,{once:true});
      });
    }else box.scrollTop=previousScrollTop;
  }
}

function sendChatMessage(){ $('chatForm')?.requestSubmit(); }
function openChat(){
  if(!signedInUser)return;
  chatUnsubscribe?.();
  chatMessages=[];olderChatMessages=[];chatOldestCursor=null;hasOlderChatMessages=false;loadingOlderChatMessages=false;chatPendingScrollRestore=null;chatReplyTo=null;chatFilterText='';chatFilterMode='all';
  showModal('Общий чат','<div class="chat-shell"><div class="chat-toolbar"><label class="search-box"><span>⌕</span><input id="chatSearch" type="search" placeholder="Поиск по чату"></label><select id="chatFilter"><option value="all">Все сообщения</option><option value="mine">Мои</option><option value="replies">С ответами</option><option value="photos">С фото</option></select></div><div class="chat-messages" id="chatMessages"><div class="chat-empty">Загрузка сообщений…</div></div><form id="chatForm" class="chat-form"><div id="chatReplyPreview" class="chat-reply-preview" hidden></div><div class="chat-input-wrap"><textarea id="chatInput" maxlength="1000" rows="2" placeholder="Напишите сообщение… (можно вставить фото из буфера)" autocomplete="off"></textarea><div id="chatMentionSuggestions" class="chat-mention-suggestions" hidden></div></div><div class="chat-attach-row"><label class="chat-attach-button">📎 Фото<input id="chatPhotoInput" type="file" accept="image/*" multiple hidden></label><span id="chatPhotoHint">До 5 фото, по 8 МБ</span></div><div id="chatUploadProgress" class="chat-upload-progress" hidden><div class="chat-upload-progress-track"><div id="chatUploadProgressBar" class="chat-upload-progress-bar"></div></div><span id="chatUploadProgressText">Загрузка…</span></div><div id="chatPhotoPreview" class="chat-photo-preview"></div></form></div>',[button('Закрыть','close'),button('Отправить','send-chat','primary-button')],'ОБЩИЙ ЧАТ');
  // Read the full chat collection without ordering/limiting in Firestore.
  // Older records may use a different createdAt type (Timestamp vs string); orderBy+limit can hide them.
  chatUnsubscribe=onSnapshot(collection(db,'chatMessages'),snap=>{
    chatMessages=snap.docs.map(d=>{const data=d.data();return {id:d.id,...data,source:'chat-message',text:String(data.text??data.message??data.content??''),authorName:data.authorName??data.author??data.userName??'Сотрудник',createdAt:data.createdAt??data.timestamp??data.sentAt??data.date,photos:Array.isArray(data.photos)?data.photos:(Array.isArray(data.images)?data.images:[])};}).filter(m=>String(m.text||'').trim()||Array.isArray(m.photos)&&m.photos.length).sort((x,y)=>{const date=v=>v?.toMillis?v.toMillis():new Date(v||0).getTime();return date(x.createdAt)-date(y.createdAt)||String(x.id).localeCompare(String(y.id));});
    olderChatMessages=[];
    chatOldestCursor=null;
    hasOlderChatMessages=false;
    renderChatMessages();
    markChatMessagesRead(chatMessages);
  },err=>{
    console.error('Не удалось загрузить общий чат',err);
    const box=$('chatMessages');
    if(box)box.innerHTML='<div class="danger-note">Не удалось загрузить сообщения.<br><small>Скорее всего, правила Firestore ещё не опубликованы.</small></div>';
    toast('Чат не имеет доступа к Firestore. Опубликуйте firestore.rules.');
  });
  const chatScrollBox=$('chatMessages');
  chatScrollBox?.addEventListener('scroll',()=>{if(chatScrollBox.scrollTop<60)loadOlderChatMessages();},{passive:true});
  $('chatInput').addEventListener('input',chatMentionSuggestions);$('chatSearch')?.addEventListener('input',e=>{chatFilterText=e.target.value||'';renderChatMessages();});const chatFilterSelect=$('chatFilter');if(chatFilterSelect){chatFilterSelect.value='all';chatFilterMode='all';chatFilterSelect.addEventListener('change',e=>{chatFilterMode=e.target.value||'all';renderChatMessages();});}
  $('chatInput').addEventListener('keyup',chatMentionSuggestions);
  let chatSending=false;
  $('chatForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(chatSending)return;
    const input=$('chatInput');
    const text=input.value.trim();
    const photoInput=$('chatPhotoInput');
    const files=Array.from(photoInput?.files||[]).slice(0,5);
    if(!text&&!files.length||!signedInUser)return;
    if(files.some(file=>!file.type.startsWith('image/')||file.size>8*1024*1024)){toast('Фото должны быть изображениями до 8 МБ каждое.');return}
    chatSending=true;
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
      const compressedFiles=files.length?await readPhotos(files):[];
      const totalBytes=compressedFiles.reduce((sum,file)=>sum+file.size,0);
      let uploadedBytes=0;
      await Promise.all(compressedFiles.map(async(file,index)=>{
        const path=`chat/${signedInUser.uid}/${Date.now()}-${crypto.randomUUID()}-photo-${index+1}.jpg`;
        const photoRef=storageRef(storage,path);
        await new Promise((resolve,reject)=>{
          const task=uploadBytesResumable(photoRef,file,{contentType:'image/jpeg'});
          task.on('state_changed',snap=>{
            const current=totalBytes?Math.min(100,((uploadedBytes+snap.bytesTransferred)/totalBytes)*100):0;
            if(progressBar)progressBar.style.width=current.toFixed(1)+'%';
            if(progressText)progressText.textContent=`Загрузка фото… ${Math.round(current)}%`;
          },reject,async()=>{
            uploadedBytes+=file.size;
            try{photos[index]=await getDownloadURL(photoRef);resolve()}catch(err){reject(err)}
          });
        });
      }));
      if(progressBar)progressBar.style.width='100%';
      if(progressText)progressText.textContent='Отправка сообщения…';
      await setDoc(doc(db,'chatMessages',crypto.randomUUID()),{
        text:text.slice(0,1000),
        authorId:signedInUser.uid,
        authorName:profileName,
        authorRole:state.role,
        createdAt,
        photos,
        likes:[],
        readBy:[signedInUser.uid],
        ...(chatReplyTo?{replyToId:chatReplyTo.id,replyToAuthorId:chatReplyTo.authorId,replyToAuthorName:chatReplyTo.authorName||'Сотрудник',replyToText:(chatReplyTo.text||'📷 Фото').slice(0,300)}:{})
      });
      if(chatReplyTo){await queuePush(profileName,text||'📷 Фото',signedInUser.uid,'','chat','replies',chatReplyTo.authorId,{isReply:true});}else{await queuePush(profileName,text||'📷 Фото',signedInUser.uid,'','chat','chat');}
      const mentionedTokens=[...text.matchAll(/(^|[\s])@([\p{L}\p{N}_-]{2,})/gu)].map(x=>x[2].toLocaleLowerCase('ru'));
      const mentionedUsers=[...new Map(chatMessages.map(m=>[m.authorId,{id:m.authorId,name:chatDisplayName(m.authorName)}])).values()]
        .filter(p=>p.id&&p.id!==signedInUser.uid&&mentionedTokens.includes(chatMentionToken(p.name).toLocaleLowerCase('ru')));
      for(const person of mentionedUsers){
        await queuePush(profileName,text||'📷 Фото',signedInUser.uid,'','chat','replies',person.id,{isMention:true});
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
      chatSending=false;
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

async function loadShipmentCategoryMap(){
  // Категории определяются функцией shipmentPartType ниже.
  // Старая встроенная карта была повреждена и больше нигде не использовалась.
  return {};
}
function shipmentArticleKey(article){
  return String(article||'').trim().split(/\s+/)[0].toUpperCase();
}
function shipmentTextCategory(article){
  const s=String(article||'').toLocaleLowerCase('ru').replace(/[()_,;:/\\-]+/g,' ').replace(/\s+/g,' ').trim();
  const has=(...p)=>p.some(x=>x.test(s));
  if(has(/кри\w*\s+(лів|ліва|ліве|лев|левая|левое)\w*/,/\b(лів|ліва|ліве|лев|левая|левое)\w*\s+кри\w*/))return 'Левое крыло';
  if(has(/кри\w*\s+(прав|права|праве|правая|правое|пра)\w*/,/\b(прав|права|праве|правая|правое|пра)\w*\s+кри\w*/))return 'Правое крыло';
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

function openDailyReport(){
  const today=localDateKey(new Date()),month=today.slice(0,7);
  showModal('Печатный отчёт склада',
    '<p class="stat-modal-hint">Можно сформировать отчёт за отдельный день или за весь месяц — с первого по последнее число.</p><div class="field"><label for="reportPeriodMode">Период отчёта</label><select id="reportPeriodMode"><option value="day">За день</option><option value="month">За месяц</option></select></div><div class="field" id="dailyReportDateField"><label for="dailyReportDate">Дата отчёта</label><input id="dailyReportDate" type="date" value="'+esc(today)+'"></div><div class="field" id="monthlyReportDateField" hidden><label for="monthlyReportMonth">Месяц отчёта</label><input id="monthlyReportMonth" type="month" value="'+esc(month)+'"></div><div class="field-hint">Печатная форма включает сводку, отгрузки, самовывоз, остатки, переносы, отмены, дефекты/возвраты, перекупной товар и отметки проверки деталей.</div>',
    [button('Закрыть','close'),button('Сформировать и печатать','print-daily-report','small-button primary-button')],
    'ПЕЧАТНЫЙ ОТЧЁТ');
  const mode=$('reportPeriodMode'),dayField=$('dailyReportDateField'),monthField=$('monthlyReportDateField');
  mode?.addEventListener('change',()=>{const monthly=mode.value==='month';if(dayField)dayField.hidden=monthly;if(monthField)monthField.hidden=!monthly;});
}
function reportDateMatches(value,dateKey,endDateKey=dateKey){const key=localDateKey(value);return !!key&&key>=dateKey&&key<=endDateKey;}
function reportEntryText(order,entry){return String(entry?.text||entry?.decisionText||'').trim();}
function reportTable(headers,rows){
  if(!rows.length)return '<p class="empty">Нет записей за выбранный период.</p>';
  return '<div class="table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+String(x??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
async function generateDailyReport(dateKey,endDateKey=dateKey){
  if(!dateKey||!endDateKey||endDateKey<dateKey){toast('Выберите корректный период отчёта.');return;}
  const periodIsMonth=dateKey!==endDateKey;
  const periodTitle=periodIsMonth?'за период':'за день';
  const win=window.open('','_blank');
  if(!win){toast('Браузер заблокировал окно печати. Разрешите всплывающие окна для сайта и повторите.');return;}
  win.document.open();
  win.document.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Отчёт склада '+esc(dateKey)+'</title><style>body{font:12px Arial,sans-serif;color:#182230;margin:24px}h1{font-size:23px;margin:0 0 5px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #bbb;padding-bottom:5px}.report-hero{border-bottom:2px solid #23344d;padding-bottom:8px;margin-bottom:20px}.eyebrow{font-size:10px;letter-spacing:2px;color:#64748b;font-weight:bold;margin-bottom:8px}.chart-legend{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0;font-size:10px}.chart-legend span{display:inline-flex;align-items:center;gap:5px}.chart-legend i{display:inline-block;width:10px;height:10px;border-radius:2px}.legend-created,.bar-created{background:#4776a8}.legend-shipped,.bar-shipped{background:#25856b}.legend-pickup,.bar-pickup{background:#d49b36}.legend-cancelled,.bar-cancelled{background:#b85a5a}.week-row{display:grid;grid-template-columns:130px 1fr;gap:12px;border-bottom:1px solid #e1e6ec;padding:10px 0;break-inside:avoid}.week-label small{display:block;color:#687386;margin-top:4px}.week-bars{display:grid;gap:6px}.bar-line,.status-row{display:grid;grid-template-columns:78px 1fr 28px;align-items:center;gap:8px;font-size:10px}.bar-track{height:9px;background:#edf0f4;border-radius:5px;overflow:hidden}.bar-track i{display:block;height:100%;border-radius:5px}.bar-status{background:#64748b}.status-breakdown{display:grid;gap:9px}.status-row{grid-template-columns:minmax(130px,220px) 1fr 28px;padding:3px 0}@media(max-width:600px){.week-row{grid-template-columns:1fr}.status-row{grid-template-columns:110px 1fr 24px}}.muted,.empty{color:#5e6876}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.kpi{border:1px solid #cbd1d8;padding:9px}.kpi b{display:block;font-size:20px;margin-bottom:4px}.table-wrap{width:100%;overflow:visible}table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:10px}th,td{border:1px solid #cbd1d8;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f0f2f5}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:40px}.sign{border-top:1px solid #333;padding-top:7px}.section-note{font-size:10px;color:#555}.empty{padding:10px 0}@page{size:auto;margin:12mm}@media print{body{margin:0}.no-print{display:none}tr{break-inside:avoid;page-break-inside:avoid}h2{break-after:avoid;page-break-after:avoid}.report-subsection{break-inside:avoid;page-break-inside:avoid}h3{break-after:avoid;page-break-after:avoid}}@media screen{body{max-width:1100px;margin:28px auto}.no-print{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #ddd;margin-bottom:14px}.no-print button{padding:9px 15px;cursor:pointer}}</style></head><body><div class="no-print"><button onclick="window.print()">Печать</button> <button onclick="window.close()">Закрыть</button></div><p>Формирую отчёт…</p></body></html>');
  win.document.close();
  try{
    const created=state.orders.filter(o=>reportDateMatches(o.createdAt,dateKey,endDateKey));
    let buybackItems=[];
    try{
      const buybackSnap=await getDocs(collection(db,'buybackItems'));
      buybackItems=buybackSnap.docs.map(d=>({id:d.id,...(d.data()||{})}));
    }catch(error){
      console.warn('Не удалось загрузить перекупной товар для отчёта',error);
    }
    const buybackStatusLabel=item=>{const status=String(item.status||'').trim();if(!status||status.toLowerCase()==='active')return 'На складе';if(/sold|продан|отгружен|забрал/i.test(status))return 'Продан / отгружен';if(/cancel|отмен/i.test(status))return 'Отменён';if(/return|возврат|вернул|returned/i.test(status))return 'Возвращён';return status;};
    const buybackStatus=item=>String(item.status||'active').trim().toLowerCase();
    const buybackOnStock=buybackItems.filter(item=>['','active'].includes(buybackStatus(item)));
    const buybackDate=(...values)=>values.some(value=>value&&reportDateMatches(value,dateKey,endDateKey));
    const buybackRelevant=buybackItems.filter(item=>{
      const status=buybackStatus(item);
      const createdToday=buybackDate(item.createdOn,item.createdAt,item.receivedAt);
      const sold=/sold|продан|отгружен|забрал/i.test(status);
      const cancelled=/cancel|отмен/i.test(status);
      const returned=/return|возврат|вернул/i.test(status);
      // Для новых записей используем только отдельные даты событий.
      // Старые записи могли быть закрыты до появления этих полей — для них updatedAt служит временным резервом.
      const soldToday=item.soldAt?buybackDate(item.soldAt):(!item.soldAt&&sold&&buybackDate(item.updatedAt));
      const cancelledToday=item.cancelledAt?buybackDate(item.cancelledAt):(!item.cancelledAt&&cancelled&&buybackDate(item.updatedAt));
      const returnedToday=item.returnedAt?buybackDate(item.returnedAt):(!item.returnedAt&&returned&&buybackDate(item.updatedAt));
      const onStock=['','active'].includes(status);
      return onStock||createdToday||soldToday||cancelledToday||returnedToday;
    });
    const buybackDaysOnStock=(item,status)=>{const received=String(item.receivedAt||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(received))return '—';const sold=/sold|продан|отгружен|забрал/i.test(status);const cancelled=/cancel|отмен/i.test(status);const returned=/return|возврат|вернул/i.test(status);const closed=sold||cancelled||returned;const endValue=closed?(sold?(item.soldAt||item.updatedAt):cancelled?(item.cancelledAt||item.updatedAt):(item.returnedAt||item.updatedAt)):localDateKey(new Date());const end=String(endValue||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(end))return '—';const elapsed=Math.floor((Date.parse(end+'T00:00:00Z')-Date.parse(received+'T00:00:00Z'))/86400000);return Number.isFinite(elapsed)?Math.max(0,elapsed):'—';};
    const buybackRows=buybackRelevant.slice().sort((a,b)=>String(a.status||'active').localeCompare(String(b.status||'active'))||String(a.article||'').localeCompare(String(b.article||''))).map(item=>{const status=buybackStatus(item);const eventDate=/sold|продан|отгружен/i.test(status)?(item.soldAt||item.updatedAt):/cancel|отмен/i.test(status)?(item.cancelledAt||item.updatedAt):/return|возврат|вернул/i.test(status)?(item.returnedAt||item.updatedAt):(item.createdOn||item.createdAt||item.receivedAt);return [esc(item.article||'—'),esc(item.quantity??'—'),esc(item.supplier||'—'),esc(buybackStatusLabel(item)),esc(item.receivedAt||'—'),esc(buybackDaysOnStock(item,status)),esc(eventDate?fmtDateTime(eventDate):'—'),esc(item.createdByName||'—')];});
    const eventEntries=state.orders.flatMap(o=>(Array.isArray(o.entries)?o.entries:[]).filter(e=>reportDateMatches(e.createdAt,dateKey,endDateKey)).map(e=>({order:o,entry:e})));
    const eventByOrder=re=>eventEntries.filter(x=>re.test(reportEntryText(x.order,x.entry)));
    const shippedEvents=eventByOrder(/отгруженн|отгрузил/i);
    const pickupEvents=eventByOrder(/клиент забрал заказ самовывозом|забрал.*самовывоз/i);
    const transferredEvents=eventByOrder(/заказ перенесен|перенесён заказ|перенесен/i);
    const shippedOrders=[...new Map(shippedEvents.map(x=>[x.order.id,x.order])).values()];
    for(const o of state.orders)if(o.status==='Отгружен кладовщиком'&&reportDateMatches(o.shippedAt||o.updatedAt,dateKey,endDateKey)&&!shippedOrders.some(x=>x.id===o.id))shippedOrders.push(o);
    const pickupOrders=[...new Map(pickupEvents.map(x=>[x.order.id,x.order])).values()];
    for(const o of state.orders)if(o.status==='Клиент забрал самовывозом'&&reportDateMatches(o.updatedAt,dateKey,endDateKey)&&!pickupOrders.some(x=>x.id===o.id))pickupOrders.push(o);
    const transferredOrders=[...new Map(transferredEvents.map(x=>[x.order.id,x.order])).values()];
    for(const o of state.orders)if(o.status==='Перенесен'&&reportDateMatches(o.transferredAt||o.updatedAt,dateKey,endDateKey)&&!transferredOrders.some(x=>x.id===o.id))transferredOrders.push(o);
    const cancelledOrders=state.orders.filter(o=>o.status==='Отменён'&&reportDateMatches(o.updatedAt,dateKey,endDateKey));
    const terminal=new Set(['Отгружен кладовщиком','Клиент забрал самовывозом','Отменён','Возврат']);
    const remaining=state.orders.filter(o=>!terminal.has(o.status)&&!(Array.isArray(o.returns)&&o.returns.some(r=>r?.status!=='cancelled')));
    const defects=eventEntries.filter(x=>x.entry.kind==='defect');
    const returns=state.orders.flatMap(o=>(Array.isArray(o.returns)?o.returns:[]).filter(r=>r?.status!=='cancelled'&&reportDateMatches(r.createdAt,dateKey,endDateKey)).map(r=>({order:o,record:r})));
    const totalQty=orders=>orders.reduce((sum,o)=>{const removed=new Set((o.entries||[]).filter(e=>e.kind==='defect'&&e.decision==='Удалена из заказа').map(e=>Number.isInteger(e.articleIndex)?e.articleIndex:-1));const items=normalizeArticles(o.articles||[]).filter((item,i)=>!removed.has(i)&&!(removed.has(-1)&&(o.entries||[]).some(e=>e.kind==='defect'&&e.decision==='Удалена из заказа'&&e.article===item.article)));return sum+items.reduce((n,item)=>n+(Number(item.quantity)||1),0);},0);
    let shipmentDay={checkedOrderArticles:[],checkedArticles:[]};
    try{
      const cursor=new Date(dateKey+'T12:00:00');
      const endCursor=new Date(endDateKey+'T12:00:00');
      const checkedOrderArticles=new Set(),checkedArticles=new Set();let hasCheckedOrderArticles=false;
      for(const day=new Date(cursor);day<=endCursor;day.setDate(day.getDate()+1)){
        const key=localDateKey(day),snap=await getDoc(doc(db,'shipmentDays',key));
        if(!snap.exists())continue;
        const data=snap.data()||{};
        if(Array.isArray(data.checkedOrderArticles)){hasCheckedOrderArticles=true;data.checkedOrderArticles.forEach(x=>checkedOrderArticles.add(String(x)));}
        (Array.isArray(data.checkedArticles)?data.checkedArticles:[]).forEach(x=>checkedArticles.add(String(x)));
      }
      shipmentDay={checkedOrderArticles:hasCheckedOrderArticles?[...checkedOrderArticles]:undefined,checkedArticles:[...checkedArticles]};
    }catch(err){console.warn('Не удалось загрузить отметки проверки отгрузки за период',err);}
    const shippedForManifest=state.orders.filter(o=>o.status==='Отгружен кладовщиком'&&shipmentOrderDateKey(o)>=dateKey&&shipmentOrderDateKey(o)<=endDateKey).flatMap(o=>{
      const removed=new Set((o.entries||[]).filter(e=>e.kind==='defect'&&e.decision==='Удалена из заказа').map(e=>Number.isInteger(e.articleIndex)?e.articleIndex:-1));
      return normalizeArticles(o.articles||[]).filter((item,i)=>!removed.has(i)&&!(removed.has(-1)&&(o.entries||[]).some(e=>e.kind==='defect'&&e.decision==='Удалена из заказа'&&e.article===item.article))).map(item=>({order:o,item,key:String(o.id)+'::'+String(item.article||'').trim().toUpperCase()}));
    });
    const checked=new Set(Array.isArray(shipmentDay.checkedOrderArticles)?shipmentDay.checkedOrderArticles.map(String):[]);
    if(!Array.isArray(shipmentDay.checkedOrderArticles)&&Array.isArray(shipmentDay.checkedArticles)){
      for(const x of shippedForManifest)if(shipmentDay.checkedArticles.some(a=>String(a).trim().toUpperCase()===String(x.item.article||'').trim().toUpperCase()))checked.add(x.key);
    }
    const checkedCount=shippedForManifest.filter(x=>checked.has(x.key)).length;
    const uniqueClients=orders=>new Set(orders.map(o=>String(o.client||'').trim().toLocaleLowerCase('ru')).filter(Boolean)).size;
    const shipmentRows=shippedOrders.map(o=>{
      const event=shippedEvents.find(x=>x.order.id===o.id);
      return [esc(o.number||'—'),esc(o.client||'—'),esc(event?.entry?.author||o.updatedByName||o.shippedByName||'—'),esc(fmtDateTime(o.shippedAt||event?.entry?.createdAt||o.updatedAt)),esc(totalQty([o]))];
    });
    const pickupRows=pickupOrders.map(o=>{const event=pickupEvents.find(x=>x.order.id===o.id);return [esc(o.number||'—'),esc(o.client||'—'),esc(o.deliveryType==='pickup'?'Самовывоз':'—'),esc(fmtDateTime(event?.entry?.createdAt||o.updatedAt))];});
    const transferredRows=transferredOrders.map(o=>{const event=transferredEvents.find(x=>x.order.id===o.id);return [esc(o.number||'—'),esc(o.client||'—'),esc(fmtDateTime(event?.entry?.createdAt||o.transferredAt||o.updatedAt)),esc(event?reportEntryText(o,event.entry):'Причина в истории заказа не найдена')];});
    const cancelledRows=cancelledOrders.map(o=>{
      const reason=(o.entries||[]).filter(e=>e.kind==='decision'&&reportDateMatches(e.createdAt,dateKey,endDateKey)).sort((a,b)=>(asDate(b.createdAt)?.getTime()||0)-(asDate(a.createdAt)?.getTime()||0))[0];
      return [esc(o.number||'—'),esc(o.client||'—'),esc(fmtDateTime(o.updatedAt)),esc(reason?reportEntryText(o,reason):'Причина в истории заказа не найдена')];
    });
    const remainingRows=remaining.map(o=>[esc(o.number||'—'),esc(o.client||'—'),esc(o.status||'—'),esc(o.deliveryType==='pickup'?'Самовывоз':o.deliveryType==='post'?'Почта':'По городу'),esc(totalQty([o]))]);
    const createdRows=created.map(o=>[esc(o.number||'—'),esc(o.client||'—'),esc(o.status||'—'),esc(fmtDateTime(o.createdAt)),esc(totalQty([o]))]);
    const defectRows=defects.map(({order,entry})=>[esc(order.number||'—'),esc(order.client||'—'),esc(entry.article||'—'),esc(reportEntryText(order,entry)),esc(entry.author||'—'),esc(fmtDateTime(entry.createdAt))]);
    const returnRows=returns.map(({order,record})=>[esc(order.number||'—'),esc(order.client||'—'),esc((record.items||[]).map(i=>String(i.article||'')+' × '+(Number(i.quantity)||0)).join(', ')||'—'),esc(record.reason||'—'),esc(record.author||'—')]);
    const dateFormatter=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'long',year:'numeric'});
    const dateLabel=esc(dateKey===endDateKey?dateFormatter.format(new Date(dateKey+'T12:00:00')):dateFormatter.format(new Date(dateKey+'T12:00:00'))+' — '+dateFormatter.format(new Date(endDateKey+'T12:00:00')));
    const sections=[];
    if(periodIsMonth){
      const periodMetrics=(fromKey,toKey)=>{
        const periodCreated=state.orders.filter(o=>reportDateMatches(o.createdAt,fromKey,toKey));
        const periodEntries=state.orders.flatMap(o=>(Array.isArray(o.entries)?o.entries:[]).filter(e=>reportDateMatches(e.createdAt,fromKey,toKey)).map(e=>({order:o,entry:e})));
        const periodEvents=regex=>periodEntries.filter(x=>regex.test(reportEntryText(x.order,x.entry)));
        const periodShippedEvents=periodEvents(/отгруженн|отгрузил/i);
        const periodPickupEvents=periodEvents(/клиент забрал заказ самовывозом|забрал.*самовывоз/i);
        const periodTransferredEvents=periodEvents(/заказ перенесен|перенесён заказ|перенесен/i);
        const uniqueEventOrders=events=>[...new Map(events.map(x=>[x.order.id,x.order])).values()];
        const periodShipped=uniqueEventOrders(periodShippedEvents);
        for(const o of state.orders)if(o.status==='Отгружен кладовщиком'&&reportDateMatches(o.shippedAt||o.updatedAt,fromKey,toKey)&&!periodShipped.some(x=>x.id===o.id))periodShipped.push(o);
        const periodPickup=uniqueEventOrders(periodPickupEvents);
        for(const o of state.orders)if(o.status==='Клиент забрал самовывозом'&&reportDateMatches(o.updatedAt,fromKey,toKey)&&!periodPickup.some(x=>x.id===o.id))periodPickup.push(o);
        const periodTransferred=uniqueEventOrders(periodTransferredEvents);
        for(const o of state.orders)if(o.status==='Перенесен'&&reportDateMatches(o.transferredAt||o.updatedAt,fromKey,toKey)&&!periodTransferred.some(x=>x.id===o.id))periodTransferred.push(o);
        const periodCancelled=state.orders.filter(o=>o.status==='Отменён'&&reportDateMatches(o.updatedAt,fromKey,toKey));
        const periodDefects=periodEntries.filter(x=>x.entry.kind==='defect');
        const periodReturns=state.orders.flatMap(o=>(Array.isArray(o.returns)?o.returns:[]).filter(r=>r?.status!=='cancelled'&&reportDateMatches(r.createdAt,fromKey,toKey)).map(record=>({order:o,record})));
        const involvedIds=new Set([...periodCreated,...periodShipped,...periodPickup,...periodTransferred,...periodCancelled,...periodDefects.map(x=>x.order),...periodReturns.map(x=>x.order)].map(o=>o.id));
        const problematicIds=new Set([...periodDefects.map(x=>x.order.id),...periodReturns.map(x=>x.order.id)]);
        return {created:periodCreated.length,shipped:periodShipped.length,pickup:periodPickup.length,cancelled:periodCancelled.length,problematic:problematicIds.size,involved:involvedIds.size,problemShare:involvedIds.size?problematicIds.size/involvedIds.size*100:0};
      };
      const selectedStart=new Date(dateKey+'T12:00:00');
      const selectedEnd=new Date(endDateKey+'T12:00:00');
      const selectedDays=Math.max(1,Math.round((selectedEnd-selectedStart)/86400000)+1);
      const isFullCalendarMonth=selectedStart.getDate()===1&&selectedEnd.getDate()===new Date(selectedEnd.getFullYear(),selectedEnd.getMonth()+1,0).getDate();
      let previousStart,previousEnd;
      if(isFullCalendarMonth){previousStart=new Date(selectedStart.getFullYear(),selectedStart.getMonth()-1,1,12);previousEnd=new Date(selectedStart.getFullYear(),selectedStart.getMonth(),0,12);}
      else{previousEnd=new Date(selectedStart);previousEnd.setDate(previousEnd.getDate()-1);previousStart=new Date(previousEnd);previousStart.setDate(previousStart.getDate()-selectedDays+1);}
      const previousStartKey=localDateKey(previousStart),previousEndKey=localDateKey(previousEnd);
      const currentMetrics=periodMetrics(dateKey,endDateKey),previousMetrics=periodMetrics(previousStartKey,previousEndKey);
      const comparisonLabel=isFullCalendarMonth?'к предыдущему календарному месяцу':'к предыдущему периоду такой же длины';
      const countComparison=(current,previous)=>{const diff=current-previous;const pct=previous?Math.round(diff/previous*100):current===0?'0':'—';return '<span class="comparison-delta '+(diff>0?'up':diff<0?'down':'flat')+'">'+(diff>0?'+':'')+diff+(pct==='—'?' ('+(current>0?'новые значения':'нет базы')+')':' ('+(pct>0?'+':'')+pct+'%)')+'</span>';};
      const percentagePointComparison=(current,previous)=>{const diff=Math.round((current-previous)*10)/10;return '<span class="comparison-delta '+(diff>0?'up':diff<0?'down':'flat')+'">'+(diff>0?'+':'')+diff+' п. п.</span>';};
      const weekBuckets=[];
      const startDate=new Date(dateKey+'T12:00:00');
      const finishDate=new Date(endDateKey+'T12:00:00');
      const calendarDays=Math.max(1,Math.round((finishDate-startDate)/86400000)+1);
      for(let cursor=new Date(startDate),week=1;cursor<=finishDate;week++){
        const from=new Date(cursor),to=new Date(cursor);
        to.setDate(to.getDate()+6);
        if(to>finishDate)to.setTime(finishDate.getTime());
        const fromKey=localDateKey(from),toKey=localDateKey(to);
        const inWeek=value=>reportDateMatches(value,fromKey,toKey);
        const createdCount=created.filter(o=>inWeek(o.createdAt)).length;
        const shippedCount=shippedOrders.filter(o=>inWeek(o.shippedAt||shippedEvents.find(x=>x.order.id===o.id)?.entry?.createdAt||o.updatedAt)).length;
        const pickupCount=pickupOrders.filter(o=>inWeek(pickupEvents.find(x=>x.order.id===o.id)?.entry?.createdAt||o.updatedAt)).length;
        const cancelledCount=cancelledOrders.filter(o=>inWeek(o.updatedAt)).length;
        weekBuckets.push({label:'Неделя '+week,range:fmtDate(from)+' — '+fmtDate(to),created:createdCount,shipped:shippedCount,pickup:pickupCount,cancelled:cancelledCount});
        cursor.setDate(cursor.getDate()+7);
      }
      const chartMax=Math.max(1,...weekBuckets.flatMap(w=>[w.created,w.shipped,w.pickup,w.cancelled]));
      const chartRows=weekBuckets.map(w=>'<div class="week-row"><div class="week-label"><b>'+esc(w.label)+'</b><small>'+esc(w.range)+'</small></div><div class="week-bars">'+[['Создано',w.created,'created'],['Отгружено',w.shipped,'shipped'],['Самовывоз',w.pickup,'pickup'],['Отменено',w.cancelled,'cancelled']].map(([label,value,kind])=>'<div class="bar-line"><span>'+esc(label)+'</span><div class="bar-track"><i class="bar-'+kind+'" style="width:'+Math.round(value/chartMax*100)+'%"></i></div><b>'+value+'</b></div>').join('')+'</div></div>').join('');
      const shippedQty=totalQty(shippedOrders);
      const pickupQty=totalQty(pickupOrders);
      const fulfilledOrders=shippedOrders.length+pickupOrders.length;
      const fulfilledQty=shippedQty+pickupQty;
      const buybackUnits=buybackOnStock.reduce((sum,item)=>sum+(Number(item.quantity)||0),0);
      const defectOrders=new Set(defects.map(x=>x.order.id)).size;
      const returnUnits=returns.reduce((sum,x)=>sum+(Array.isArray(x.record.items)?x.record.items.reduce((n,item)=>n+(Number(item.quantity)||0),0):0),0);
      const avg=(value,total=calendarDays)=>total?Math.round(value/total*10)/10:0;
      const pickupShare=fulfilledOrders?Math.round(pickupOrders.length/fulfilledOrders*100):0;
      const defectsPer100=shippedOrders.length?Math.round(defects.length/shippedOrders.length*1000)/10:0;
      const returnsPer100=fulfilledOrders?Math.round(returns.length/fulfilledOrders*1000)/10:0;
      const peakWeek=weekBuckets.reduce((best,w)=>!best||(w.shipped+w.pickup)>(best.shipped+best.pickup)?w:best,null);
      const peakCreatedWeek=weekBuckets.reduce((best,w)=>!best||w.created>best.created?w:best,null);
      const avgFulfilledPerWeek=weekBuckets.length?Math.round(fulfilledOrders/weekBuckets.length*10)/10:0;
      const problemShare=currentMetrics.involved?Math.round(currentMetrics.problemShare*10)/10:0;
      const previousProblemShare=previousMetrics.involved?Math.round(previousMetrics.problemShare*10)/10:0;
      sections.push('<section class="report-hero"><div class="eyebrow">WAREHOUSE · MONTHLY PERFORMANCE</div><h2>Итоги месяца</h2><p class="muted">Период: '+dateLabel+' · Сформирован: '+esc(fmtDateTime(new Date()))+'</p><div class="summary"><div class="kpi"><b>'+created.length+'</b>создано за период</div><div class="kpi"><b>'+shippedOrders.length+'</b>отгрузок</div><div class="kpi"><b>'+shippedQty+'</b>деталей отгружено</div><div class="kpi"><b>'+pickupOrders.length+'</b>самовывозов</div><div class="kpi"><b>'+uniqueClients(shippedOrders)+'</b>клиентов в отгрузках</div><div class="kpi"><b>'+transferredOrders.length+'</b>переносов</div><div class="kpi"><b>'+cancelledOrders.length+'</b>отмен</div><div class="kpi"><b>'+defects.length+'</b>записей о дефектах</div><div class="kpi"><b>'+returns.length+'</b>возвратов</div><div class="kpi"><b>'+defectOrders+'</b>заказов с дефектами</div></div></section>');
      sections.push('<h2>Средние показатели</h2><p class="section-note">Средние значения рассчитаны на календарный день выбранного периода. Показатели качества на 100 заказов — ориентировочные соотношения событий и выполненных заказов за период, не когортная статистика.</p><div class="summary"><div class="kpi"><b>'+avg(created.length)+'</b>новых заказов в день</div><div class="kpi"><b>'+avg(fulfilledOrders)+'</b>выполненных заказов в день</div><div class="kpi"><b>'+avg(cancelledOrders.length)+'</b>отмен в день</div><div class="kpi"><b>'+avg(shippedQty,shippedOrders.length)+'</b>деталей на одну отгрузку</div><div class="kpi"><b>'+avg(fulfilledQty,fulfilledOrders)+'</b>деталей на выполненный заказ</div><div class="kpi"><b>'+pickupShare+'%</b>выполнений через самовывоз</div><div class="kpi"><b>'+defectsPer100+'</b>событий дефекта на 100 отгрузок</div><div class="kpi"><b>'+returnsPer100+'</b>возвратных записей на 100 выполнений</div></div><p class="section-note">Самый активный период по отгрузкам и самовывозам: '+(peakWeek?esc(peakWeek.label)+' ('+(peakWeek.shipped+peakWeek.pickup)+' выполнений)':'нет данных')+'.</p>');
      sections.push('<h2>Динамика по неделям</h2><p class="section-note">Количество событий по неделям месяца. Данные показаны в сравнительном виде; шкала общая для всех серий.</p><div class="chart-legend"><span><i class="legend-created"></i>Создано</span><span><i class="legend-shipped"></i>Отгружено</span><span><i class="legend-pickup"></i>Самовывоз</span><span><i class="legend-cancelled"></i>Отменено</span></div>'+chartRows);
      sections.push('<h2>Перекупной товар на складе</h2><div class="summary"><div class="kpi"><b>'+buybackOnStock.length+'</b>перекупных позиций</div><div class="kpi"><b>'+buybackUnits+'</b>единиц перекупного товара</div></div><p class="section-note">Это состояние склада на момент формирования отчёта, а не исторический остаток на конец выбранного периода.</p>');
      sections.push('<h2>Сравнение с предыдущим периодом</h2><p class="section-note">Сравнение '+esc(fmtDate(previousStart)+' — '+fmtDate(previousEnd))+' '+esc(comparisonLabel)+'. Проценты показывают изменение количества; для доли проблемных заказов используется разница в процентных пунктах.</p><div class="summary"><div class="kpi"><b>'+currentMetrics.created+'</b>новых заказов<br>'+countComparison(currentMetrics.created,previousMetrics.created)+'</div><div class="kpi"><b>'+currentMetrics.shipped+'</b>отгрузок<br>'+countComparison(currentMetrics.shipped,previousMetrics.shipped)+'</div><div class="kpi"><b>'+currentMetrics.pickup+'</b>самовывозов<br>'+countComparison(currentMetrics.pickup,previousMetrics.pickup)+'</div><div class="kpi"><b>'+currentMetrics.cancelled+'</b>отмен<br>'+countComparison(currentMetrics.cancelled,previousMetrics.cancelled)+'</div><div class="kpi"><b>'+currentMetrics.problematic+'</b>проблемных заказов<br>'+countComparison(currentMetrics.problematic,previousMetrics.problematic)+'</div><div class="kpi"><b>'+problemShare+'%</b>доля проблемных заказов<br>'+percentagePointComparison(problemShare,previousProblemShare)+'</div></div><p class="section-note">Проблемным считается уникальный заказ, в котором за период зарегистрирован хотя бы один дефект или возврат. Доля рассчитана среди уникальных заказов, затронутых событиями периода (создание, отгрузка, самовывоз, перенос, отмена, дефект или возврат).</p>');
      sections.push('<h2>Пиковая нагрузка</h2><div class="summary"><div class="kpi"><b>'+avgFulfilledPerWeek+'</b>выполнений в среднем за неделю</div><div class="kpi"><b>'+(peakWeek?peakWeek.shipped+peakWeek.pickup:0)+'</b>максимум отгрузок и самовывозов за неделю</div><div class="kpi"><b>'+(peakCreatedWeek?peakCreatedWeek.created:0)+'</b>максимум новых заказов за неделю</div></div><p class="section-note">Пиковая неделя по выполнению: '+(peakWeek?esc(peakWeek.label)+' ('+esc(peakWeek.range)+')':'нет данных')+'. Пиковая неделя по созданию заказов: '+(peakCreatedWeek?esc(peakCreatedWeek.label)+' ('+esc(peakCreatedWeek.range)+')':'нет данных')+'.</p>');
      sections.push('<h2>Контроль качества и операций</h2><div class="summary"><div class="kpi"><b>'+defects.length+'</b>событий дефекта за период</div><div class="kpi"><b>'+defectOrders+'</b>заказов затронуто дефектами</div><div class="kpi"><b>'+returns.length+'</b>возвратных записей</div><div class="kpi"><b>'+returnUnits+'</b>единиц в возвратах</div></div><p class="section-note">Подробные построчные таблицы заказов, дефектов и возвратов скрыты в месячном отчёте, чтобы документ оставался компактным. Для разбора конкретной операции используйте карточку заказа и историю.</p>');
      sections.push('<div class="signatures"><div class="sign">Кладовщик: __________________________</div><div class="sign">Проверил: __________________________</div></div>');
    }else{
      sections.push('<h2>1. Сводка '+periodTitle+'</h2><div class="summary"><div class="kpi"><b>'+shippedOrders.length+'</b>отгруженных заказов</div><div class="kpi"><b>'+totalQty(shippedOrders)+'</b>деталей в отгруженных заказах</div><div class="kpi"><b>'+pickupOrders.length+'</b>самовывозов</div><div class="kpi"><b>'+created.length+'</b>заказов создано</div><div class="kpi"><b>'+uniqueClients(shippedOrders)+'</b>клиентов в отгрузках</div><div class="kpi"><b>'+transferredOrders.length+'</b>переносов за выбранный период</div><div class="kpi"><b>'+cancelledOrders.length+'</b>отмен за выбранный период</div><div class="kpi"><b>'+remaining.length+'</b>незакрытых заказов сейчас</div></div><p class="section-note">События определяются по записям истории заказа и сохранённым датам статусов. Если событие не записывалось отдельно, оно может не попасть в исторический счётчик.</p>');
      sections.push('<h2>2. Заказы, созданные '+dateLabel+'</h2>'+reportTable(['Номер заказа','Клиент','Текущий статус','Создан','Кол-во деталей'],createdRows));
      sections.push('<h2>3. Отгрузка кладовщиком</h2><p><b>Заказов:</b> '+shippedOrders.length+' · <b>клиентов:</b> '+uniqueClients(shippedOrders)+' · <b>деталей:</b> '+totalQty(shippedOrders)+'</p>'+reportTable(['Номер заказа','Клиент','Кто отгрузил*','Время','Кол-во деталей'],shipmentRows)+'<p class="section-note">*Сотрудник указан по записи события, если она сохранилась; иначе используется последнее сохранённое имя обновившего заказ.</p>');
      sections.push('<h2>4. Самовывоз — клиент забрал заказ</h2><p><b>Заказов:</b> '+pickupOrders.length+' · <b>клиентов:</b> '+uniqueClients(pickupOrders)+' · <b>деталей:</b> '+totalQty(pickupOrders)+'</p>'+reportTable(['Номер заказа','Клиент','Вид доставки','Время события'],pickupRows));
      sections.push('<h2>5. Заказы, перенесённые за выбранный период</h2>'+reportTable(['Номер заказа','Клиент','Время события','Запись / причина'],transferredRows));
      sections.push('<h2>6. Отменённые заказы</h2>'+reportTable(['Номер заказа','Клиент','Дата изменения','Причина отмены'],cancelledRows));
      sections.push('<h2>7. Незакрытые заказы на момент формирования отчёта</h2><p class="section-note">Это текущий остаток по базе на момент печати, а не исторический снимок на конец выбранного периода.</p>'+reportTable(['Номер заказа','Клиент','Текущий статус','Доставка','Кол-во деталей'],remainingRows));
      sections.push('<h2>8. Дефекты и возвраты за выбранный период</h2><div class="report-subsection"><h3>Дефекты</h3>'+reportTable(['Номер заказа','Клиент','Артикул','Описание / решение','Автор','Дата'],defectRows)+'</div><div class="report-subsection"><h3>Возвраты</h3>'+reportTable(['Номер заказа','Клиент','Детали','Причина','Автор'],returnRows)+'</div>');
      sections.push('<h2>9. Перекупной товар</h2><p><b>Всего позиций:</b> '+buybackRelevant.length+' · <b>на складе сейчас:</b> '+buybackOnStock.length+' · <b>единиц на складе:</b> '+buybackOnStock.reduce((sum,item)=>sum+(Number(item.quantity)||0),0)+'</p><p class="section-note">Показаны товары, оставшиеся на складе на момент печати, добавленные в выбранный день, а также проданные или отменённые за выбранный период. Старые отменённые и проданные записи не включаются.</p>'+reportTable(['Артикул','Количество','Поставщик','Статус','Дата поступления','Дней на складе','Дата события / добавления','Кто добавил'],buybackRows));
      sections.push('<h2>10. Проверка списка отгрузки</h2><p><b>Заказов в списке:</b> '+new Set(shippedForManifest.map(x=>x.order.id)).size+' · <b>позиций:</b> '+shippedForManifest.length+' · <b>проверено позиций:</b> '+checkedCount+' · <b>не проверено:</b> '+Math.max(0,shippedForManifest.length-checkedCount)+'</p><p class="section-note">Позиция считается проверенной по отметкам вкладки «Отгрузка» за выбранный период.</p>'+reportTable(['Номер заказа','Клиент','Артикул','Количество','Проверка'],shippedForManifest.map(x=>[esc(x.order.number||'—'),esc(x.order.client||'—'),esc(x.item.article||'—'),esc(x.item.quantity||1),esc(checked.has(x.key)?'Проверено':'Не проверено')])));
      sections.push('<div class="signatures"><div class="sign">Кладовщик: __________________________</div><div class="sign">Проверил: __________________________</div></div>');
  
    }
    const reportHtml='<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Отчёт склада '+dateLabel+'</title><style>body{font:12px Arial,sans-serif;color:#182230;margin:24px}h1{font-size:23px;margin:0 0 5px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #bbb;padding-bottom:5px}.report-hero{border-bottom:2px solid #23344d;padding-bottom:8px;margin-bottom:20px}.eyebrow{font-size:10px;letter-spacing:2px;color:#64748b;font-weight:bold;margin-bottom:8px}.chart-legend{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0;font-size:10px}.chart-legend span{display:inline-flex;align-items:center;gap:5px}.chart-legend i{display:inline-block;width:10px;height:10px;border-radius:2px}.legend-created,.bar-created{background:#4776a8}.legend-shipped,.bar-shipped{background:#25856b}.legend-pickup,.bar-pickup{background:#d49b36}.legend-cancelled,.bar-cancelled{background:#b85a5a}.week-row{display:grid;grid-template-columns:130px 1fr;gap:12px;border-bottom:1px solid #e1e6ec;padding:10px 0;break-inside:avoid}.week-label small{display:block;color:#687386;margin-top:4px}.week-bars{display:grid;gap:6px}.bar-line,.status-row{display:grid;grid-template-columns:78px 1fr 28px;align-items:center;gap:8px;font-size:10px}.bar-track{height:9px;background:#edf0f4;border-radius:5px;overflow:hidden}.bar-track i{display:block;height:100%;border-radius:5px}.bar-status{background:#64748b}.status-breakdown{display:grid;gap:9px}.status-row{grid-template-columns:minmax(130px,220px) 1fr 28px;padding:3px 0}@media(max-width:600px){.week-row{grid-template-columns:1fr}.status-row{grid-template-columns:110px 1fr 24px}}h3{font-size:13px;margin:14px 0 6px;break-after:avoid;page-break-after:avoid}.report-subsection{break-inside:avoid;page-break-inside:avoid}.muted,.empty{color:#5e6876}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.kpi{border:1px solid #cbd1d8;padding:9px}.kpi b{display:block;font-size:20px;margin-bottom:4px}.table-wrap{width:100%;overflow:visible}table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:10px}th,td{border:1px solid #cbd1d8;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f0f2f5}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:40px}.sign{border-top:1px solid #333;padding-top:7px}.section-note{font-size:10px;color:#555}.empty{padding:10px 0}@page{size:auto;margin:12mm}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}html,body{width:auto!important;max-width:none!important;margin:0!important;padding:0!important;background:#fff!important;color:#182230!important;font-size:10pt}.no-print{display:none!important}.summary{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important}.kpi{break-inside:avoid;page-break-inside:avoid;background:#fff!important;border:1px solid #9ca3af!important}.week-row{display:grid!important;grid-template-columns:130px minmax(0,1fr)!important;gap:10px!important;break-inside:avoid;page-break-inside:avoid}.week-bars{display:grid!important;grid-template-columns:minmax(0,1fr)!important}.bar-line,.status-row{display:grid!important;grid-template-columns:78px minmax(0,1fr) 28px!important;break-inside:avoid;page-break-inside:avoid}.status-row{grid-template-columns:minmax(130px,220px) minmax(0,1fr) 28px!important}.bar-track{background:#edf0f4!important;border:1px solid #d6dbe1!important}.bar-created,.legend-created{background:#4776a8!important}.bar-shipped,.legend-shipped{background:#25856b!important}.bar-pickup,.legend-pickup{background:#d49b36!important}.bar-cancelled,.legend-cancelled{background:#b85a5a!important}.bar-status{background:#64748b!important}.report-subsection,.status-breakdown,.chart-legend,.signatures{break-inside:avoid;page-break-inside:avoid}tr{break-inside:avoid;page-break-inside:avoid}h2,h3{break-after:avoid;page-break-after:avoid}h2{margin-top:16px}table{width:100%!important;table-layout:auto} .table-wrap{overflow:visible!important} .muted,.empty,.section-note,.week-label small{color:#4b5563!important}}@media screen{body{max-width:1100px;margin:28px auto}.no-print{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #ddd;margin-bottom:14px}.no-print button{padding:9px 15px;cursor:pointer}}</style></head><body><div class="no-print"><button onclick="window.print()">Печать</button> <button onclick="window.close()">Закрыть</button></div><h1>'+(periodIsMonth?'Месячный отчёт склада':'Дневной отчёт склада')+'</h1><p><b>Дата:</b> '+dateLabel+'</p><p class="muted">Сформирован: '+esc(fmtDateTime(new Date()))+' · Warehouse Orders</p>'+sections.join('')+'</body></html>';
    win.document.open();win.document.write(reportHtml);win.document.close();
    setTimeout(()=>{try{win.focus();win.print();}catch(err){console.warn('Не удалось открыть печать автоматически',err);}},450);
  }catch(err){
    console.error('Не удалось сформировать дневной отчёт',err);
    win.document.open();win.document.write('<!doctype html><meta charset="utf-8"><p>Не удалось сформировать отчёт. Закройте окно и повторите попытку.</p>');win.document.close();
    toast('Не удалось сформировать отчёт.');
  }
}

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
    for(const [itemIndex,item] of normalizeArticles(o.articles||[]).entries()){
      const key=String(item.article||'').trim().toUpperCase();
      if(!key)continue;
      const removedIndexes=new Set((o.entries||[]).filter(e=>e.kind==='defect'&&e.decision==='Удалена из заказа').map(e=>Number.isInteger(e.articleIndex)?e.articleIndex:-1));
      if(removedIndexes.has(itemIndex))continue;
      if(removedIndexes.has(-1)&&(o.entries||[]).some(e=>e.kind==='defect'&&e.decision==='Удалена из заказа'&&e.article===item.article))continue;
      const current=map.get(key)||{article:key,quantity:0,type:shipmentPartType(key),orders:[]};
      current.quantity+=Number(item.quantity)||1;
      if(!current.orders.includes(o.number))current.orders.push(o.number);
      map.set(key,current);
    }
  }
  const items=[...map.values()].sort((a,b)=>a.article.localeCompare(b.article,'ru',{numeric:true,sensitivity:'base'}));
  return categoryFilter ? items.filter(item=>item.type===categoryFilter) : items;
}
async function showAuditLog(){
  try{
    const snap=await getDocs(query(collection(db,'auditLog'),orderBy('createdAt','desc'),limit(500)));
    const auditRows=snap.docs.map(d=>({id:d.id,...d.data()}));
    // Recover readable numbers for orders that have already been deleted.
    const deletedNumberById=new Map();
    try{
      const deletedSnap=await getDocs(collection(db,'deletedOrders'));
      deletedSnap.docs.forEach(d=>{const data=d.data();if(data.number!==undefined&&data.number!==null)deletedNumberById.set(d.id,String(data.number));});
    }catch(archiveErr){console.warn('Не удалось загрузить номера архивных заказов',archiveErr);}
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
        const linkedOrder=state.orders.find(o=>o.id===a.orderId);
        const fromDetails=String(a.details||'').match(/заказ(?:а)?\s*№\s*([^·,;\n]+)/i);
        const visibleOrderNumber=a.orderNumber||linkedOrder?.number||deletedNumberById.get(String(a.orderId||''))||fromDetails?.[1]?.trim()||'';
        return '<article class="history-entry history-'+tone+'"><div class="history-entry-bar"></div><div class="timeline-top"><span><b>'+esc(a.actorName||'Сотрудник')+'</b> · '+fmtDateTime(a.createdAt)+'</span><span class="timeline-type">'+esc(roles[a.actorRole]||a.actorRole||'Действие')+'</span></div>'+(a.orderId?'<div class="timeline-article">Заказ №: '+esc(visibleOrderNumber||a.orderId)+'</div>':'')+'<div class="timeline-text"><b>'+esc(raw)+'</b>'+(a.details?'<br>'+esc(a.details):'')+'</div></article>';
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
async function toggleShipmentItemChecked(dateKey,orderId,article){
  if(!(canManageUsers||state.role==='warehouse')){toast('Отметить проверку может только кладовщик или администратор.');return;}
  const articleKey=String(article||'').trim().toUpperCase();
  const orderKey=String(orderId||'').trim();
  if(!articleKey||!orderKey)return;
  try{
    const ref=doc(db,'shipmentDays',dateKey);
    const snap=await getDoc(ref);
    const data=snap.exists()?snap.data():{};
    let checked=new Set(Array.isArray(data.checkedOrderArticles)?data.checkedOrderArticles.map(String):[]);
    if(!Array.isArray(data.checkedOrderArticles)){
      const legacy=new Set(Array.isArray(data.checkedArticles)?data.checkedArticles.map(x=>String(x).trim().toUpperCase()):[]);
      for(const order of state.orders.filter(o=>o.status==='Отгружен кладовщиком'&&shipmentOrderDateKey(o)===dateKey)){
        for(const item of normalizeArticles(order.articles||[])){
          if(legacy.has(String(item.article||'').trim().toUpperCase()))checked.add(String(order.id)+'::'+String(item.article||'').trim().toUpperCase());
        }
      }
    }
    const key=orderKey+'::'+articleKey;
    const nextChecked=!checked.has(key);
    if(nextChecked)checked.add(key);else checked.delete(key);
    await setDoc(ref,{date:dateKey,checkedOrderArticles:[...checked]},{merge:true});
    await writeAudit(nextChecked?'Проверена позиция на отгрузке':'Снята проверка позиции на отгрузке','Дата: '+dateKey+'; заказ: '+orderKey+'; артикул: '+articleKey);
    openShipmentManifest(dateKey,'',$('shipmentSearch')?.value||'');
  }catch(err){
    console.error('Не удалось сохранить отметку проверки отгрузки',err);
    toast('Не удалось сохранить отметку проверки.');
  }
}
async function openShipmentManifest(dateKey=localDateKey(new Date()),categoryFilter='',searchQuery=''){
  const expandedOrderIds=new Set([...document.querySelectorAll('.shipment-order-card[open]')].map(el=>el.dataset.orderId).filter(Boolean));
  await loadShipmentCategoryMap();
  let confirmation=null;
  try{const snap=await getDoc(doc(db,'shipmentDays',dateKey));if(snap.exists())confirmation=snap.data();}catch(err){console.warn(err);}
  const shipmentDaySnap=await getDoc(doc(db,'shipmentDays',dateKey)).catch(()=>null);
  const dayData=shipmentDaySnap?.exists()?(shipmentDaySnap.data()||{}):{};
  const checkedOrderArticles=new Set(Array.isArray(dayData.checkedOrderArticles)?dayData.checkedOrderArticles.map(String):[]);
  const legacyCheckedArticles=new Set(Array.isArray(dayData.checkedArticles)?dayData.checkedArticles.map(x=>String(x).trim().toUpperCase()):[]);
  const query=String(searchQuery||'').trim().toLocaleLowerCase('ru');
  const shippedOrders=state.orders.filter(o=>o.status==='Отгружен кладовщиком'&&shipmentOrderDateKey(o)===dateKey).map(o=>{
    const removedIndexes=new Set((o.entries||[]).filter(e=>e.kind==='defect'&&e.decision==='Удалена из заказа').map(e=>Number.isInteger(e.articleIndex)?e.articleIndex:-1));
    const articles=normalizeArticles(o.articles||[]).filter((item,index)=>{
      if(removedIndexes.has(index))return false;
      if(removedIndexes.has(-1)&&(o.entries||[]).some(e=>e.kind==='defect'&&e.decision==='Удалена из заказа'&&e.article===item.article))return false;
      return true;
    }).map(item=>{
      const article=String(item.article||'').trim().toUpperCase();
      const key=String(o.id)+'::'+article;
      return {...item,articleKey:article,checked:checkedOrderArticles.has(key)||( !Array.isArray(dayData.checkedOrderArticles)&&legacyCheckedArticles.has(article))};
    });
    const isChecked=articles.length>0&&articles.every(item=>item.checked);
    const clientMatch=(String(o.client||'')+' '+String(o.number||'')).toLocaleLowerCase('ru').includes(query);
    const matchingArticles=query?articles.filter(item=>(String(item.article||'')+' '+shipmentPartType(item.article)).toLocaleLowerCase('ru').includes(query)):articles;
    return {...o,shipmentArticles:articles,visibleArticles:(!query||clientMatch)?articles:matchingArticles,isShipmentChecked:isChecked,clientMatch};
  }).filter(o=>o.shipmentArticles.length&&(!query||o.clientMatch||o.visibleArticles.length));
  shippedOrders.sort((a,b)=>(a.isShipmentChecked===b.isShipmentChecked?0:a.isShipmentChecked?1:-1)||String(a.number||'').localeCompare(String(b.number||''),'ru',{numeric:true,sensitivity:'base'})||String(a.client||'').localeCompare(String(b.client||''),'ru',{sensitivity:'base'}));
  const visibleOrders=shippedOrders;
  const visibleItems=visibleOrders.reduce((sum,o)=>sum+o.visibleArticles.length,0);
  const checkedCount=visibleOrders.filter(o=>o.isShipmentChecked).length;
  let html='<div class="shipment-day-picker"><button type="button" class="shipment-day-nav" data-action="shipment-day-prev" aria-label="Предыдущий день">‹</button><div class="shipment-day-current"><label for="shipmentDate">День отгрузки</label><input id="shipmentDate" type="date" value="'+esc(dateKey)+'"></div><button type="button" class="shipment-day-nav" data-action="shipment-day-next" aria-label="Следующий день">›</button></div><div class="shipment-day-quick"><button type="button" class="small-button primary-soft" data-action="shipment-day-today">Сегодня</button><button type="button" class="small-button" data-action="shipment-day-prev">← Предыдущий</button><button type="button" class="small-button" data-action="shipment-day-next">Следующий →</button></div>';
  html+='<div class="shipment-search-wrap"><label for="shipmentSearch">Поиск по отгрузке</label><input id="shipmentSearch" type="search" value="'+esc(searchQuery||'')+'" placeholder="Клиент, номер заказа, артикул или название детали" autocomplete="off"></div>';
  const orderCount=new Set(visibleOrders.map(o=>o.id)).size,itemCount=visibleOrders.reduce((sum,o)=>sum+o.visibleArticles.reduce((s,item)=>s+(Number(item.quantity)||1),0),0);
  html+='<p class="stat-modal-hint">Заказов: <b>'+orderCount+'</b> · позиций: <b>'+visibleItems+'</b> · проверено заказов: <b>'+checkedCount+'</b></p>';
  if(visibleOrders.length){
    html+='<div class="shipment-order-list">';
    for(const order of visibleOrders){
      const orderQuantity=order.shipmentArticles.reduce((sum,item)=>sum+(Number(item.quantity)||1),0);
      const orderClass=order.isShipmentChecked?' shipment-order-complete':' shipment-order-pending';
      html+='<details data-order-id="'+esc(order.id)+'" class="shipment-order-card'+orderClass+'"'+(expandedOrderIds.has(String(order.id))?' open':'')+'><summary class="shipment-order-header"><div><strong class="shipment-client-name">'+esc(order.client||'Клиент не указан')+'</strong><span>Заказ № '+esc(order.number||'—')+'</span></div><span class="shipment-order-count">'+orderQuantity+' шт.</span></summary><div class="shipment-order-articles">';
      for(const item of order.visibleArticles){
        const checkControl=(canManageUsers||state.role==='warehouse')
          ? '<button type="button" class="small-button '+(item.checked?'good':'primary-soft')+'" data-action="toggle-shipment-checked:'+dateKey+'|'+encodeURIComponent(order.id)+'|'+encodeURIComponent(item.article)+'">'+(item.checked?'✓ Проверено':'Проверить')+'</button>'
          : '<span class="article-collected-state">'+(item.checked?'✓ Проверено':'Не проверено')+'</span>';
        html+='<div class="manifest-row"><span><b>'+esc(item.article)+'</b><small>'+esc(shipmentPartType(item.article))+'</small></span><span class="shipment-order-article-actions"><strong>'+(Number(item.quantity)||1)+' шт.</strong>'+checkControl+'</span></div>';
      }
      html+='</div></details>';
    }
    html+='</div>';
  }
  if(!visibleOrders.length)html+='<div class="danger-note">'+(query?'По вашему поиску ничего не найдено.':'На этот день нет заказов со статусом «Отгружен кладовщиком».')+'</div>';
  if(confirmation?.confirmed){
    html+='<div class="danger-note">✓ Список подтверждён: '+esc(confirmation.confirmedByName||'Сотрудник')+' · '+fmtDateTime(confirmation.confirmedAt)+'</div>';
    if(canManageUsers||state.role==='warehouse'||state.role==='manager')html+=button('↶ Снять подтверждение','revoke-shipment:'+dateKey,'small-button danger');
  }else if(confirmation?.revokedAt){
    html+='<div class="danger-note shipment-revoked">↶ Подтверждение снято: '+esc(confirmation.revokedByName||'Сотрудник')+' · '+fmtDateTime(confirmation.revokedAt)+'</div>';
    if(canManageUsers||state.role==='warehouse'||state.role==='manager')html+=button('✓ Подтвердить список снова','confirm-shipment:'+dateKey,'small-button good');
  }else if(canManageUsers||state.role==='warehouse'||state.role==='manager')html+=button('✓ Подтвердить список на отгрузку','confirm-shipment:'+dateKey,'small-button good');
  else html+='<div class="field-hint">Подтвердить список может кладовщик, менеджер или администратор.</div>';
  showModal('Список деталей на отгрузку',html,[button('Показать день','shipment-date','small-button primary-soft'),button('Закрыть','close')],'ОТГРУЗКА ПО ДНЯМ');
  $('shipmentSearch')?.addEventListener('input',e=>{const pos=e.target.selectionStart;openShipmentManifest(dateKey,'',e.target.value).then(()=>{const input=$('shipmentSearch');if(input){input.focus();input.setSelectionRange(pos,pos);}});});
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
      return '<article role="button" tabindex="0" aria-label="Отметить уведомление прочитанным" class="notification-entry notification-'+tone+' '+(n.read?'':'unread')+'" data-notice-id="'+esc(n.id)+'"><span class="notification-dot"></span><div><b>'+esc(n.title||'Уведомление')+'</b><p>'+esc(n.message||n.body||'Новое событие')+'</p><small>'+fmtDateTime(n.createdAt||n.at)+'</small></div>'+(n.orderId?'<button type="button" class="small-button primary-soft" data-open="'+esc(n.orderId)+'">Открыть</button>':'')+'</article>';
    }).join('');
    const listEl=$('notificationList');if(listEl)listEl.innerHTML=rows||'<div class="danger-note">Уведомлений по фильтрам нет.</div>';
    const summary=document.querySelector('.notification-summary b');
    if(summary)summary.textContent=String(state.notices.filter(n=>!n.read).length);
  };
  const unread=state.notices.filter(n=>!n.read).length;
  const pushGranted=typeof Notification!=='undefined'&&Notification.permission==='granted';
  const pushControls='<div class="push-device-controls"><div><b>Системные push-уведомления</b><small>'+((pushGranted)?'Разрешены в браузере':'Можно включить на этом устройстве')+'</small></div><div class="push-device-buttons"><button type="button" class="small-button good" data-action="enable-notifications">🔔 Включить уведомления</button><button type="button" class="small-button danger" data-action="disable-notifications">🔕 Отключить уведомления</button></div></div>'+'<button type="button" class="notification-setting '+(state.extraPhoneNotifications?'enabled':'disabled')+'" style="width:100%;margin:0 0 12px;text-align:left" data-action="toggle-extra-phone-notifications"><b>📱 Дополнительные уведомления на все устройства</b><small>'+(state.extraPhoneNotifications?'Включены — ваши действия тоже будут отправляться на все зарегистрированные устройства':'Выключены — ваши собственные действия не отправляют вам push')+'</small></button><p class="field-hint">Доставка на устройства независимая: открытый браузер на ПК не должен мешать уведомлениям на телефоне. На телефоне должны быть разрешены уведомления и зарегистрирован push-токен.</p>';
  const body=pushControls+'<div class="notification-toolbar"><label class="search-box"><span>⌕</span><input id="notificationSearch" type="search" placeholder="Поиск уведомлений"></label><select id="notificationFilter"><option value="">Все</option><option value="orders">Заказы</option><option value="chat">Общий чат</option><option value="replies">Ответы и упоминания</option><option value="likes">Лайки</option></select></div><div class="notification-settings-grid">'+['chat','replies','likes','orders'].map(k=>'<button type="button" class="notification-setting '+(state.notificationSettings[k]?'enabled':'disabled')+'" data-action="toggle-notification:'+k+'"><b>'+({chat:'💬 Чат',replies:'↩ Ответы',likes:'👍 Лайки',orders:'📦 Заказы'}[k])+'</b><small>'+(state.notificationSettings[k]?'Включены':'Выключены')+'</small></button>').join('')+'</div><div class="notification-summary"><b>'+unread+'</b> непрочитанных уведомлений</div><div id="notificationList" class="notification-list"></div>';
  showModal('Уведомления',body,[button('Прочитать всё','mark-notifications-read','small-button good'),button('Закрыть','close')],'ЦЕНТР УВЕДОМЛЕНИЙ');
  $('notificationSearch')?.addEventListener('input',render);$('notificationFilter')?.addEventListener('change',render);render();
  // Opening the notification center counts as viewing the notifications.
  void markNotificationItemsRead(state.notices.filter(n=>!n.read));
}
function profileMenu(){
  const themeAction=button(document.body.classList.contains('dark-theme')?'☀️ Светлая тема':'🌙 Тёмная тема','toggle-theme','small-button primary-soft');
  const indicatorAction=button(chatUnreadIndicatorMode()==='bell'?'🔔 Индикатор чата: колокольчик':'🟡 Индикатор чата: жёлтая точка','toggle-chat-indicator','small-button primary-soft');
  const adminAction=canManageUsers?button('Учётные записи сотрудников','open-staff','small-button primary-soft'):'';
  const historyAction=canManageUsers?button('История удалённых заказов','deleted-orders','small-button'):'';
  const hasPassword=signedInUser?.providerData.some(p=>p.providerId==='password');
  showModal('Учётная запись','<p style="font-size:13px;color:#52635a;margin:0 0 6px"><b>'+esc(profileName)+'</b><br>'+esc(signedInUser?.email||'')+' · '+esc(roles[state.role])+(canManageUsers?' · администратор':'')+'</p><p class="field-hint">Индикатор непрочитанных сообщений общего чата</p>',[themeAction,indicatorAction,adminAction,historyAction,...(!hasPassword?[button('Задать пароль для входа','set-login-password','small-button')]:[button('Сменить пароль','change-password','small-button')]),button('Выйти','sign-out','small-button danger'),button('Закрыть','close')],'ПРОФИЛЬ СОТРУДНИКА');
}
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
document.addEventListener('change',e=>{
  if(e.target?.id==='clientsExcelInput'){
    const file=e.target.files?.[0];if(file)importClientsExcel(file);
    e.target.value='';
  }
  if(e.target?.id==='productsExcelInput'){
    const file=e.target.files?.[0];if(file)importProductsExcel(file);
    e.target.value='';
  }
});
document.addEventListener('input',e=>{
  if(e.target?.id==='entryText')entryMentionSuggestions();
  if(e.target?.id==='clientName')clientNameSuggestions('clientName','clientNameSuggestions');
  if(e.target?.id==='editClientName')clientNameSuggestions('editClientName','editClientNameSuggestions');
  if(e.target?.classList?.contains('order-article-input'))showArticleSuggestions(e.target);
});
document.addEventListener('focusin',e=>{
  if(e.target?.id==='clientName')clientNameSuggestions('clientName','clientNameSuggestions');
  if(e.target?.id==='editClientName')clientNameSuggestions('editClientName','editClientNameSuggestions');
  if(e.target?.classList?.contains('order-article-input'))showArticleSuggestions(e.target);
});

document.addEventListener('keyup',e=>{
  if(e.target?.id==='entryText')entryMentionSuggestions();
  if(e.target?.id==='clientName')clientNameSuggestions('clientName','clientNameSuggestions');
  if(e.target?.id==='editClientName')clientNameSuggestions('editClientName','editClientNameSuggestions');
  if(e.target?.classList?.contains('order-article-input'))showArticleSuggestions(e.target);
});
document.addEventListener('focusout',e=>{
  if(['clientName','editClientName'].includes(e.target?.id)){
    const id=e.target.id==='clientName'?'clientNameSuggestions':'editClientNameSuggestions';
    setTimeout(()=>{const list=$(id);if(list&&!list.contains(document.activeElement))list.hidden=true;},120);
  }
});

document.addEventListener('click',e=>{
  const productSuggestion=e.target.closest('[data-product-article]');
  if(productSuggestion){e.preventDefault();chooseArticleSuggestion(productSuggestion);return;}
  const noticeCard=e.target.closest('[data-notice-id]');
  if(noticeCard){
    const notice=state.notices.find(n=>n.id===noticeCard.dataset.noticeId);
    const openButton=e.target.closest('[data-open]');
    if(notice&&!notice.read)markNotificationItemsRead([notice]).then(result=>{
      const summary=document.querySelector('.notification-summary b');
      if(summary)summary.textContent=String(state.notices.filter(n=>!n.read).length);
      if(result.failed===0){noticeCard.classList.remove('unread');noticeCard.setAttribute('aria-label','Прочитанное уведомление');}
    });
    if(openButton){e.preventDefault();openOrder(openButton.dataset.open);}
    return;
  }
  const statCard=e.target.closest('[data-stat-key]');
  if(statCard){e.preventDefault();openStatOrders(statCard.dataset.statKey||'');return;}
  const clientSuggestion=e.target.closest('.client-suggestion[data-client-suggestion]');
  if(clientSuggestion){
    e.preventDefault();
    const id=clientSuggestion.dataset.clientSuggestion||'';
    const isEdit=!!clientSuggestion.closest('#editOrderInfoForm');
    chooseClientSuggestion(isEdit?'editClientName':'clientName',isEdit?'editClientNameSuggestions':'clientNameSuggestions',id);
    return;
  }
  const orderClientSuggestion=e.target.closest('[data-order-client-suggestion]');
  if(orderClientSuggestion){
    e.preventDefault();
    const value=orderClientSuggestion.dataset.orderClientSuggestion||'';
    const isEdit=!!orderClientSuggestion.closest('#editOrderInfoForm');
    chooseOrderClientSuggestion(isEdit?'editClientName':'clientName',isEdit?'editClientNameSuggestions':'clientNameSuggestions',value);
    return;
  }
  const entryMention=e.target.closest('[data-entry-mention]');
  if(entryMention){e.preventDefault();insertEntryMention(entryMention.dataset.entryMention||'');return;}
  const mention=e.target.closest('[data-chat-mention]');
  if(mention){e.preventDefault();insertChatMention(mention.dataset.chatMention||'');return;}
  const like=e.target.closest('[data-action^="toggle-chat-like:"]');
  if(like){e.preventDefault();toggleChatLike(like.dataset.action.split(':').slice(1).join(':'));return;}
const notice=e.target.closest('[data-open-notification]');if(notice){const id=notice.dataset.openNotification,target=notice.dataset.notificationTarget;if(target==='chat'){closeModal();openChat();}else if(id)openOrder(id);return}const open=e.target.closest('[data-open]');if(open){e.preventDefault();openOrder(open.dataset.open);return}const nav=e.target.closest('.nav-item');if(nav){if(nav.dataset.action==='returns'){closeSidebar(true);history.replaceState({},'',location.pathname+location.search);showReturns();return;}if(nav.dataset.action==='clients'){closeSidebar(true);openClientsDirectory();return;}if(nav.dataset.action==='products'){closeSidebar(true);openProductsDirectory();return;}if(nav.dataset.filter){activeFilter=nav.dataset.filter;render();closeSidebar();return;}}if(e.target===$('sidebarBackdrop')){closeSidebar();return}if(e.target===$('imageViewer')||e.target===$('closeImageViewer')){$('imageViewer').hidden=true;$('imageViewerImage').removeAttribute('src');return}const defectArticle=e.target.closest('[data-defect-article]');if(defectArticle){const o=state.orders.find(x=>x.id===selectedId);const idx=Number(defectArticle.dataset.defectArticle);const pending=(o?.entries||[]).find(x=>x.kind==='defect'&&!x.decision&&(Number.isInteger(x.articleIndex)?x.articleIndex===idx:x.article===o?.articles?.[idx]?.article));if(pending){if(!(isManagerRole()||canManageUsers)){toast('Решение по дефекту может вынести менеджер.');return;}showModal('Решение по дефекту',`<div class="defect-decision-modal"><div class="defect-modal-intro"><span class="defect-modal-icon">⚠</span><div><div class="defect-modal-kicker">ТРЕБУЕТСЯ РЕШЕНИЕ</div><h3>${esc(pending.article||'Артикул не указан')}</h3><p>Позиция ${idx+1} · Заказ № ${esc(o?.number||'')}</p></div></div><section class="defect-modal-section"><div class="defect-modal-section-title">📝 Описание дефекта</div><div class="defect-modal-comment">${esc(pending.text||'Описание не добавлено.')}</div></section><section class="defect-modal-section"><div class="defect-modal-section-title">📷 Фотографии дефекта <span>${(pending.photos||[]).length}</span></div>${pending.photos?.length?`<div class="defect-modal-photos">${pending.photos.map((p,n)=>'<img src="'+esc(p)+'" alt="Фото дефекта '+(n+1)+'" data-photo="'+esc(p)+'">').join('')}</div>`:'<div class="defect-modal-no-photos">Фото к этому дефекту не прикреплены</div>'}</section><div class="defect-modal-action-hint">Выберите решение по этой позиции:</div></div>`,[button('← Назад к заказу','back-detail','small-button defect-action-back'),button('✓ Подтвердить дефект','defect-confirm:'+pending.id,'small-button good defect-action-button defect-action-approve'),button('↗ Удалить позицию из заказа','defect-remove:'+pending.id,'small-button danger defect-action-button defect-action-remove'),button('✕ Отменить заказ','defect-cancel:'+pending.id,'small-button danger defect-action-button defect-action-cancel')],'РЕШЕНИЕ ПО ДЕФЕКТУ');return;}}const clientCardLink=e.target.closest('[data-open-client-card]');if(clientCardLink){e.preventDefault();openClientCardByName(clientCardLink.dataset.openClientCard||'');return;}const act=e.target.closest('[data-action]')?.dataset.action;if(act){if(act==='close')closeModal();else if(act==='send-chat')sendChatMessage();else if(act==='create-order')saveOrder();else if(act==='add-order-article'){const rows=$('orderArticlesRows');if(rows)rows.insertAdjacentHTML('beforeend',articleRowHtml());}else if(act==='remove-order-article'){e.target.closest('.order-article-row')?.remove();}else if(act==='new-client'){openClientForm();}else if(act.startsWith('edit-client:')){openClientForm(act.slice(12));}else if(act.startsWith('delete-client:')){deleteClient(act.slice(14));}else if(act.startsWith('save-client:')){saveClient(act.slice(12));}else if(act==='import-clients'){$('clientsExcelInput')?.click();}else if(act==='import-products'){$('productsExcelInput')?.click();}else if(act==='clients'){openClientsDirectory();}else if(act==='products'){openProductsDirectory();}else if(act.startsWith('toggle-collected:')){toggleArticleCollected(Number(act.slice(17)));}else if(act==='open-edit-menu')openEditMenu();else if(act==='edit-articles')editArticles();else if(act==='edit-order-info')editOrderInfo();else if(act==='open-warehouse-actions')openOrderActionCategory('warehouse');else if(act==='open-manager-actions')openOrderActionCategory('manager');else if(act==='save-order-info')saveOrderInfo();else if(act==='save-articles')saveArticles();else if(act==='add-comment')addComment();else if(act.startsWith('reply-entry:'))replyToEntry(act.slice('reply-entry:'.length));else if(act==='add-defect')addDefect();else if(act==='open-return')openReturnForm();else if(act==='save-return')saveReturn();else if(act.startsWith('cancel-return:')){const parts=act.split(':');cancelReturnAction(parts[1],parts.slice(2).join(':'));}else if(act.startsWith('open-return-order:')){openOrder(act.slice('open-return-order:'.length));}else if(act==='back-detail')backDetail();else if(act==='save-entry')saveEntry();else if(act==='toggle-assembly'){toggleAssemblyProgress();}else if(act==='set-assembled'){setStatus('Собран','Кладовщик отметил заказ как собран.');}else if(act==='set-shipped'){setStatus('Отгружен кладовщиком','Кладовщик отметил заказ как отгруженный.');}else if(act.startsWith('toggle-shipment-checked:')){const raw=act.slice(24),parts=raw.split('|');if(parts.length>=3){const dateKey=parts[0],orderId=decodeURIComponent(parts[1]),article=decodeURIComponent(parts.slice(2).join('|'));toggleShipmentItemChecked(dateKey,orderId,article);}}else if(act.startsWith('set-status:')){const status=act.slice(11);setStatus(status,`Статус заказа изменён на «${status}».`)}else if(act==='show-on-map'){let article=e.target.closest('[data-map-article]')?.dataset.mapArticle||'';article=article.trim().split(/\s+/)[0];if(article)window.open('https://hlebish.github.io/warehouse-map/?article='+encodeURIComponent(article),'warehouseMap')}else if(act==='set-created'){setStatus('Создан','Кладовщик вернул заказ в статус «Создан».');}else if(act==='set-pickup-waiting'){if(isManagerRole()||canManageUsers){setStatus('Ожидает самовывоза','Менеджер отметил заказ как ожидающий самовывоза.');}}else if(act==='set-pickup-done'){if(isManagerRole()||canManageUsers){setStatus('Клиент забрал самовывозом','Клиент забрал заказ самовывозом.');}}else if(act==='set-transferred'){if(isManagerRole()||canManageUsers){setStatus('Перенесен','Заказ перенесен.');}}else if(act==='set-approval')setStatus('На согласовании','Начал согласование заказа с клиентом.');else if(act==='approve-order')approveOrder();else if(act==='confirm-approve')confirmApprove();else if(act==='cancel-order')cancelOrder();else if(act==='confirm-cancel')confirmCancel();else if(act==='mark-seen')markViewed();else if(act==='delete-order')deleteOrder();else if(act==='confirm-delete')confirmDelete();else if(act.startsWith('delete-entry:'))deleteEntry(act.split(':')[1]);else if(act.startsWith('confirm-delete-entry:'))confirmDeleteEntry(act.split(':')[1]);else if(act==='confirm-defect-cancel')confirmDefectCancel();else if(act==='sign-out'){closeModal();signOut(auth)}else if(act==='open-staff')showStaff();else if(act==='new-staff')newStaff();else if(act==='create-staff')createStaff();else if(act==='back-profile')backProfile();else if(act==='change-password')changePassword();else if(act==='save-password')savePassword();else if(act==='set-login-password')setLoginPassword();else if(act==='save-login-password')saveLoginPassword();else if(act==='deleted-orders')showDeletedOrders();else if(act==='site-history')showAuditLog();else if(act==='analytics')showWarehouseAnalytics();else if(act==='returns')showReturns();else if(act==='returns-date'){showReturns($('returnsDateFrom')?.value||'', $('returnsDateTo')?.value||'');}else if(act==='shipment-manifest')openShipmentManifest();else if(act==='daily-report')openDailyReport();else if(act==='print-daily-report'){const mode=$('reportPeriodMode')?.value||'day';if(mode==='month'){const month=$('monthlyReportMonth')?.value||'';if(!/^\d{4}-\d{2}$/.test(month)){toast('Выберите месяц отчёта.');return;}const [year,monthNumber]=month.split('-').map(Number);const start=month+'-01',end=localDateKey(new Date(year,monthNumber,0));generateDailyReport(start,end);}else{const day=$('dailyReportDate')?.value||localDateKey(new Date());generateDailyReport(day,day);}}else if(act==='shipment-date'){openShipmentManifest($('shipmentDate')?.value||localDateKey(new Date()));}else if(act==='shipment-day-prev'){openShipmentDayOffset(-1);}else if(act==='shipment-day-next'){openShipmentDayOffset(1);}else if(act==='shipment-day-today'){openShipmentManifest(localDateKey(new Date()));}else if(act.startsWith('confirm-shipment:'))confirmShipmentManifest(act.slice(17));else if(act.startsWith('revoke-shipment:'))revokeShipmentManifest(act.slice(16));else if(act==='toggle-theme'){applyTheme(document.body.classList.contains('dark-theme')?'light':'dark');profileMenu();}else if(act==='toggle-chat-indicator'){if(signedInUser){const key='warehouse_chat_indicator_'+signedInUser.uid;localStorage.setItem(key,chatUnreadIndicatorMode()==='bell'?'dot':'bell');paintChatBadge();profileMenu();toast(chatUnreadIndicatorMode()==='bell'?'Индикатор чата изменён на колокольчик.':'Индикатор чата изменён на жёлтую точку.');}}else if(act.startsWith('view-deleted-order:'))showDeletedOrder(act.slice('view-deleted-order:'.length));else if(act.startsWith('save-role:'))changeStaffRole(act.slice('save-role:'.length));else if(act.startsWith('toggle-user:')){const[,uid,mode]=act.split(':');toggleStaff(uid,mode==='on')}else if(act==='enable-notifications'){enablePush()}else if(act==='disable-notifications'){disablePush()}else if(act==='toggle-extra-phone-notifications'){toggleExtraPhoneNotifications()}else if(act==='mark-notifications-read'){markNotificationsRead()}else if(act.startsWith('toggle-notification:')){toggleNotificationSetting(act.slice('toggle-notification:'.length))}else if(act.startsWith('reply-chat:')){startChatReply(act.slice('reply-chat:'.length))}else if(act==='cancel-chat-reply'){cancelChatReply()}else if(act.startsWith('defect-confirm:'))decideDefect(act.split(':')[1],'Подтверждён');else if(act.startsWith('defect-remove:'))decideDefect(act.split(':')[1],'Удалена из заказа');else if(act.startsWith('edit-defect:'))editDefect(act.split(':')[1]);else if(act==='confirm-defect-remove')confirmDefectRemove();else if(act==='save-defect-edit')saveDefectEdit();else if(act.startsWith('defect-cancel:')){pendingDefectId=act.split(':')[1];decideDefect(pendingDefectId,'Отменён')}return}/* Backdrop clicks intentionally do not close the modal; use the × button. */const photo=e.target.closest('[data-photo]');if(photo){$('imageViewerImage').src=photo.dataset.photo;$('imageViewer').hidden=false}});
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
$('newOrderButton').addEventListener('click',openNewOrder);$('newOrderHintButton').addEventListener('click',openNewOrder);$('emptyAddButton').addEventListener('click',openNewOrder);$('closeModal').addEventListener('click',closeModal);$('searchInput').addEventListener('input',()=>{currentOrdersPage=1;render()});$('dateFromFilter').addEventListener('change',()=>{currentOrdersPage=1;render()});$('dateToFilter').addEventListener('change',()=>{currentOrdersPage=1;render()});$('clearDateButton').addEventListener('click',()=>{$('dateFromFilter').value='';$('dateToFilter').value='';currentOrdersPage=1;render()});$('ordersPagination').addEventListener('click',e=>{const button=e.target.closest('[data-orders-page]');if(!button||button.disabled)return;currentOrdersPage=Math.max(1,currentOrdersPage+(button.dataset.ordersPage==='next'?1:-1));render();});$('notificationButton').addEventListener('click',showNotifications);$('profileButton').addEventListener('click',profileMenu);$('chatSidebarButton').addEventListener('click',openChat);$('mobileMenu').addEventListener('click',openSidebar);function positionFilterMenu(){const button=$('filterButton'),menu=$('filterMenu');if(!button||!menu||menu.hidden)return;const r=button.getBoundingClientRect();const gap=6;const menuWidth=Math.max(205,r.width);let left=Math.min(r.right-menuWidth,window.innerWidth-8);left=Math.max(8,left);let top=r.bottom+gap;const menuHeight=menu.offsetHeight;if(top+menuHeight>window.innerHeight-8&&r.top-menuHeight-gap>=8)top=r.top-menuHeight-gap;menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';menu.style.minWidth=Math.round(menuWidth)+'px'}$('filterButton').addEventListener('click',e=>{e.stopPropagation();const menu=$('filterMenu');const isOpen=!menu.hidden;menu.hidden=isOpen;$('filterButton').setAttribute('aria-expanded',String(!isOpen));if(!isOpen){updateFilterMenu();requestAnimationFrame(positionFilterMenu)}});document.querySelectorAll('[data-menu-filter]').forEach(btn=>btn.addEventListener('click',()=>{activeFilter=btn.dataset.menuFilter;currentOrdersPage=1;render();updateFilterMenu();$('filterMenu').hidden=true;$('filterButton').setAttribute('aria-expanded','false')}));document.addEventListener('click',e=>{if(!e.target.closest('.filter-menu-wrap')){$('filterMenu').hidden=true;$('filterButton').setAttribute('aria-expanded','false')}});window.addEventListener('resize',positionFilterMenu);window.addEventListener('scroll',positionFilterMenu,true);function updateFilterMenu(){document.querySelectorAll('[data-menu-filter]').forEach(btn=>btn.classList.toggle('active',btn.dataset.menuFilter===activeFilter));}document.addEventListener('keydown',e=>{
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
document.addEventListener('click',e=>{
  const oc=e.target.closest('[data-open-order-comment]');if(oc){e.preventDefault();openOrder(oc.dataset.openOrderComment);return;}
  const mi=e.target.closest('[data-mention-notice]');if(mi){const n=state.notices.find(x=>x.id===mi.dataset.mentionNotice);if(n){markNotificationItemsRead([n]);openMentionNotice(n)}return;}
  if(e.target.closest('#mentionCenterButton')){openMentionCenter();return;}
  if(e.target.closest('[data-action="show-notifications"]')){showNotifications();return;}
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
  window.addEventListener('load',async()=>{try{const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});await registration.update();}catch(err){console.warn('Не удалось проверить обновление приложения',err);}});
}
showAuth();
