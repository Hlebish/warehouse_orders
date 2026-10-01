import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential, GoogleAuthProvider, signInWithPopup, linkWithCredential } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, getDoc, updateDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import { getMessaging, getToken, deleteToken, onMessage } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';
import { firebaseConfig, vapidKey } from './firebase-config.js';
const firebaseApp=initializeApp(firebaseConfig),auth=getAuth(firebaseApp),db=getFirestore(firebaseApp),messaging=getMessaging(firebaseApp),storage=getStorage(firebaseApp),staffAuth=getAuth(initializeApp(firebaseConfig,'amp-staff-provisioner'));
let signedInUser=null,profileName='',canManageUsers=false,profileUnsubscribe=null,ordersUnsubscribe=null,entryUnsubscribes=new Map(),serverCache=new Map(),pendingWrites=new Set(),initialCloudLoad=true;
const roles={warehouse:'Кладовщик',manager:'Менеджер',director:'Директор'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isoNow=()=>new Date().toISOString();
const fmtDate=d=>new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(d));
const fmtDateTime=d=>new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(d));
let state={orders:[],notices:[],role:'warehouse',seen:{}};
let activeFilter='all', selectedId=null, pendingDefectId=null;
const $=id=>document.getElementById(id), modal=$('modalBackdrop');
const savedTheme=localStorage.getItem('ampTheme')||'light';
function applyTheme(theme){
  const next=theme==='dark'?'dark':'light';
  document.body.classList.toggle('dark-theme',next==='dark');
  localStorage.setItem('ampTheme',next);
  return next;
}
applyTheme(savedTheme);

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
function orderToCloud(o,isNew=false){return{number:o.number,client:o.client||'',status:o.status,createdAt:o.createdAt,createdBy:o.createdBy||auth.currentUser.uid,createdByName:o.author||profileName,updatedAt:o.updatedAt||o.createdAt,...(!isNew&&o.updatedBy?{updatedBy:o.updatedBy,updatedByName:o.updatedByName}:{})}}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b)}
async function save(){
 if(!signedInUser)return;
 try{
 const currentIds=new Set(state.orders.map(o=>o.id));
 for(const o of state.orders){
   const base=serverCache.get(o.id),newOrder=!base;
   const next=orderToCloud(o,newOrder),prev=base?orderToCloud(base):null;
   if(!base||!equal(next,prev)){
     if(base){next.updatedAt=isoNow();next.updatedBy=signedInUser.uid;next.updatedByName=profileName;o.updatedAt=next.updatedAt;o.updatedBy=next.updatedBy;o.updatedByName=profileName}
     pendingWrites.add(o.id);await setDoc(doc(db,'orders',o.id),next);pendingWrites.delete(o.id);
     await queuePush(newOrder?`Новый заказ № ${o.number}`:`Заказ № ${o.number} изменён`,newOrder?(o.client||'Создан новый заказ'):`Статус: ${next.status}`,signedInUser.uid);
     serverCache.set(o.id,{...o,...next,entries:base?.entries||[]});
   }
   const oldEntries=new Map((base?.entries||[]).map(e=>[e.id,e]));
   for(const e of o.entries||[]){const cloud=entryToCloud(e),old=oldEntries.get(e.id);if(!old||!equal(cloud,entryToCloud(old))){await setDoc(doc(db,'orders',o.id,'entries',e.id),cloud);if(!newOrder&&e.kind!=='viewed'){const label=e.kind==='decision'?'Решение':e.kind==='defect'?'Дефект':e.kind==='question'?'Вопрос':'Комментарий';const body=e.kind==='decision'&&e.decision?`Решение: ${e.decision}. ${e.decisionText||e.text||''}`:e.text||label;await queuePush(`Заказ № ${o.number}: ${label}`,body,signedInUser.uid)}oldEntries.delete(e.id)}else oldEntries.delete(e.id)}
   for(const removedId of oldEntries.keys()){await deleteDoc(doc(db,'orders',o.id,'entries',removedId));await queuePush(`Заказ № ${o.number} изменён`,'Запись из истории была удалена директором.',signedInUser.uid)}
   serverCache.set(o.id,{...(serverCache.get(o.id)||o),...o,entries:[...(o.entries||[])]});
 }
 for(const [id,old] of serverCache){if(!currentIds.has(id)&&state.role==='director'){for(const e of old.entries||[])await deleteDoc(doc(db,'orders',id,'entries',e.id));await deleteDoc(doc(db,'orders',id));serverCache.delete(id)}}
 }catch(err){
   console.error('Ошибка сохранения заказа:',err);
   const code=String(err?.code||'unknown');
   const message=String(err?.message||'Неизвестная ошибка');
   toast(`Ошибка сохранения: ${code}. ${message.slice(0,180)}`);
 }
}
async function queuePush(title,body,authorId){try{await setDoc(doc(db,'pushQueue',crypto.randomUUID()),{title:String(title||'Заказы · Склад'),body:String(body||'Новое изменение в заказе.'),authorId,createdAt:isoNow(),sentAt:null})}catch(err){console.warn('Push event was not queued',err)}}
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
      userAgent:navigator.userAgent
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
onMessage(messaging,payload=>{const n=payload.notification||payload.data||{};if(n.title)toast(`${n.title}${n.body?`: ${n.body}`:''}`)});
function stopCloud(){profileUnsubscribe?.();ordersUnsubscribe?.();profileUnsubscribe=ordersUnsubscribe=null;for(const stop of entryUnsubscribes.values())stop();entryUnsubscribes.clear();serverCache.clear();state.orders=[]}
function watchOrders(){
 ordersUnsubscribe?.();
 ordersUnsubscribe=onSnapshot(collection(db,'orders'),snap=>{
   const oldIds=new Set(state.orders.map(o=>o.id)),remoteIds=new Set();
   for(const d of snap.docs){remoteIds.add(d.id);const data=d.data(),prior=serverCache.get(d.id);const order={id:d.id,number:data.number,client:data.client||'',status:data.status,createdAt:data.createdAt,updatedAt:data.updatedAt,author:data.createdByName||'Сотрудник',createdBy:data.createdBy,updatedBy:data.updatedBy,updatedByName:data.updatedByName,entries:prior?.entries||[]};
     const at=state.orders.findIndex(o=>o.id===d.id);if(at<0)state.orders.push(order);else state.orders[at]={...order,entries:state.orders[at].entries||[]};serverCache.set(d.id,{...order,entries:prior?.entries||[]});
     if(!entryUnsubscribes.has(d.id)){let firstEntries=true;entryUnsubscribes.set(d.id,onSnapshot(collection(db,'orders',d.id,'entries'),es=>{const entries=es.docs.map(x=>entryFromCloud(x.id,x.data())).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));const item=state.orders.find(o=>o.id===d.id);if(!item)return;const before=JSON.stringify(item.entries||[]);item.entries=entries;serverCache.set(d.id,{...serverCache.get(d.id),entries:entries.map(x=>({...x}))});if(!initialCloudLoad&&!firstEntries&&before!==JSON.stringify(entries)){const last=entries.at(-1);toast(`Обновлён заказ № ${item.number}${last?`: ${last.author} добавил запись`:''}`);}firstEntries=false;render()}));}
     if(!initialCloudLoad&&!oldIds.has(d.id)){const message=`Поступил заказ № ${order.number}`;toast(message);notify(message,d.id)}
   }
   for(const o of [...state.orders])if(!remoteIds.has(o.id)&&!pendingWrites.has(o.id)){state.orders=state.orders.filter(x=>x.id!==o.id);entryUnsubscribes.get(o.id)?.();entryUnsubscribes.delete(o.id);serverCache.delete(o.id)}
   initialCloudLoad=false;render();
 },err=>{console.error(err);toast('Не удалось загрузить общую историю. Проверьте доступ к Firestore.')});
}
onAuthStateChanged(auth,user=>{
 stopCloud();signedInUser=user;initialCloudLoad=true;
 if(!user){showAuth();return}
 showAuth('Проверяем доступ…');
 profileUnsubscribe=onSnapshot(doc(db,'users',user.uid),snap=>{
   if(!snap.exists()){showAuth('Учётная запись создана, но профиль не найден. Обратитесь к администратору.');$('authError').textContent=`UID: ${user.uid}`;return}
   const profile=snap.data();if(profile.active!==true||!roles[profile.role]){showAuth('Доступ отключён или роль не назначена. Обратитесь к администратору.');return}
   state.role=profile.role;canManageUsers=profile.admin===true||profile.role==='director';profileName=profile.displayName||user.email||roles[profile.role];$('userName').textContent=profileName;$('userRole').textContent=canManageUsers?`Администратор · ${roles[profile.role]}`:roles[profile.role];hideAuth();watchOrders();render();syncPushToken(false);
 },err=>{console.error(err);showAuth('Не удалось проверить профиль сотрудника. Проверьте правила доступа Firestore.')});
});
 $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('authError').textContent='';try{await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value)}catch(err){$('authError').textContent=err.code==='auth/invalid-credential'?'Неверная почта или пароль.':err.code==='auth/too-many-requests'?'Слишком много попыток. Попробуйте позже.':'Не удалось войти. Проверьте почту и пароль.'}});
 $('googleLoginButton').addEventListener('click',async()=>{ $('authError').textContent='';try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(err){console.error(err);$('authError').textContent=err.code==='auth/popup-closed-by-user'?'Окно входа закрыто.':'Не удалось войти через Google.'}});
function initials(name){return String(name).split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}
function notify(message,orderId){state.notices.unshift({id:crypto.randomUUID(),message,orderId,at:isoNow(),read:false});state.notices=state.notices.slice(0,50);paintNotices()}
function statusClass(s){return({'Собран':'status-assembled','Под вопросом':'status-question','На согласовании':'status-approval','Одобрен на отгрузку клиенту':'status-ready','Отменён':'status-cancel'})[s]||'status-neutral'}
function statusPill(s){return `<span class="status-pill ${statusClass(s)}">${esc(s)}</span>`}
function entriesCount(o){return(o.entries||[]).length}
function localDateKey(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return '';return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function render(){const search=$('searchInput').value.toLocaleLowerCase('ru');const dateFilter=$('dateFilter').value;let orders=[...state.orders].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));if(activeFilter!=='all')orders=orders.filter(o=>o.status===activeFilter);if(search)orders=orders.filter(o=>(o.number+' '+o.client).toLocaleLowerCase('ru').includes(search));if(dateFilter)orders=orders.filter(o=>localDateKey(o.createdAt)===dateFilter);$('clearDateButton').hidden=!dateFilter;$('ordersBody').innerHTML=orders.map(o=>`<tr data-order="${esc(o.id)}"><td><a class="order-number" href="#" data-open="${esc(o.id)}">№ ${esc(o.number)}</a><span class="client-sub">создал ${esc(o.author||'Кладовщик')}</span></td><td><span class="client-name">${esc(o.client)}</span><span class="client-sub">${fmtDateTime(o.createdAt)}</span></td><td>${statusPill(o.status)}</td><td><span class="entry-count">${entriesCount(o)}</span></td><td class="time-cell">${fmtDate(o.createdAt)}</td><td><button class="row-menu" title="Открыть карточку" data-open="${esc(o.id)}">···</button></td></tr>`).join('');const empty=orders.length===0;$('emptyState').classList.toggle('visible',empty);$('ordersBody').style.display=empty?'none':'';$('statTotal').textContent=state.orders.length;$('statQuestions').textContent=state.orders.filter(o=>o.status==='Под вопросом').length;$('statApproval').textContent=state.orders.filter(o=>o.status==='На согласовании').length;$('statReady').textContent=state.orders.filter(o=>o.status==='Одобрен на отгрузку клиенту').length;$('allCount').textContent=state.orders.length;$('questionCount').textContent=state.orders.filter(o=>o.status==='Под вопросом').length;$('listSummary').textContent=`${orders.length} ${plural(orders.length,'заказ','заказа','заказов')}`;$('userName').textContent=profileName||roles[state.role];$('userRole').textContent=canManageUsers?`Администратор · ${roles[state.role]}`:roles[state.role];$('modeLabel').textContent='Общая история';$('modeSub').textContent='Синхронизация включена';$('today').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'long'}).format(new Date());document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.filter===activeFilter));paintNotices()}
function plural(n,a,b,c){n=Math.abs(n)%100;const d=n%10;return n>10&&n<20?c:d>1&&d<5?b:d===1?a:c}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;$('toastStack').append(t);setTimeout(()=>t.remove(),3500)}
function showModal(title,body,buttons=[],eyebrow='КАРТОЧКА ЗАКАЗА'){ $('modalTitle').textContent=title;$('modalEyebrow').textContent=eyebrow;$('modalBody').innerHTML=body;$('modalFoot').innerHTML=buttons.join('');modal.hidden=false;document.body.style.overflow='hidden'}
function closeModal(){modal.hidden=true;document.body.style.overflow=''}
function button(label,action,cls='small-button'){return `<button class="${cls}" data-action="${action}">${label}</button>`}
function openNewOrder(){if(state.role==='manager'){toast('Создавать карточки в этой версии может кладовщик.');return}showModal('Добавить заказ',`<form id="newOrderForm"><div class="form-grid"><div class="field"><label for="orderNumber">Номер заказа *</label><input id="orderNumber" required placeholder="Например, ЗК-18472" autocomplete="off"></div><div class="field"><label for="clientName">Имя клиента *</label><input id="clientName" required placeholder="Имя или название компании"></div></div><div class="field"><label for="startStatus">Начальный статус</label><select id="startStatus"><option>Собран</option><option>Под вопросом</option></select><span class="field-hint">Выберите «Под вопросом», если добавите дефект или вопрос менеджеру.</span></div><div class="field"><label for="initialComment">Комментарий (необязательно)</label><textarea id="initialComment" placeholder="Короткая заметка по заказу"></textarea></div></form>`,[button('Отмена','close'),button('Создать карточку','create-order','primary-button')],'НОВЫЙ ЗАКАЗ')}
function openOrder(id){const o=state.orders.find(x=>x.id===id);if(!o)return;selectedId=id;const isManager=state.role==='manager'||canManageUsers,isDirector=state.role==='director';let actions=button('＋ Добавить комментарий','add-comment','small-button primary-soft');
 if(isManager||isDirector){actions+=button('Отметить просмотренным','mark-seen','small-button');if(o.status==='Под вопросом'||o.status==='Собран'||o.status==='На согласовании')actions+=button('На согласовании','set-approval','small-button');if(o.status==='На согласовании'||o.status==='Под вопросом'||o.status==='Собран')actions+=button('Одобрить к отгрузке','approve-order','small-button good');if(o.status!=='Отменён')actions+=button('Отменить заказ','cancel-order','small-button danger')}
 if(canManageUsers)actions+=button('Удалить карточку','delete-order','small-button danger');let entries=(o.entries||[]).map(e=>`<article class="timeline-item"><div class="timeline-top"><span><b>${esc(e.author)}</b> · ${fmtDateTime(e.createdAt)}</span><span style="display:flex;align-items:center;gap:7px"><span class="timeline-type">${esc(({defect:'ДЕФЕКТ',question:'ВОПРОС',decision:'РЕШЕНИЕ',comment:'КОММЕНТАРИЙ',viewed:'ПРОСМОТРЕНО',system:'СИСТЕМА'})[e.kind]||'ЗАПИСЬ')}</span>${isDirector?`<button class="row-menu" title="Удалить запись (директор)" data-action="delete-entry:${e.id}">×</button>`:''}</span></div>${e.article?`<div class="timeline-article">Артикул: ${esc(e.article)}</div>`:''}<div class="timeline-text">${esc(e.text)}</div>${e.photos?.length?`<div class="photo-grid">${e.photos.map(p=>`<img src="${p}" alt="Фото к записи" data-photo="${p}">`).join('')}</div>`:''}${e.kind==='defect'&&isManager?`<div class="decision-row"><span>Решение по дефекту: <b>${esc(e.decision||'ожидает ответа')}</b>${e.decisionText?`<br>${esc(e.decisionText)}`:''}</span><span class="decision-actions">${button('Подтвердить','defect-confirm:'+e.id,'small-button good')}${button('Отменить','defect-cancel:'+e.id,'small-button danger')}</span></div>`:''}${e.kind==='defect'&&e.decision&&!isManager?`<div class="decision-row"><span>Решение менеджера: <b>${esc(e.decision)}</b>${e.decisionText?`<br>${esc(e.decisionText)}`:''}</span></div>`:''}</article>`).join('');const reviewed=(o.entries||[]).some(e=>e.kind==='viewed');let badge=reviewed?'<span class="status-pill status-neutral">Просмотрен менеджером</span>':'';showModal(`Заказ № ${o.number}`,`<div class="order-detail-head"><div><div class="detail-number">${esc(o.client)}</div><div class="detail-client">Заказ № ${esc(o.number)}</div><div class="detail-meta">Создан ${fmtDateTime(o.createdAt)} · ${esc(o.author||'Кладовщик')}</div></div><div>${statusPill(o.status)}<div style="margin-top:6px">${badge}</div></div></div><div class="detail-actions">${actions}</div><div class="detail-section-title">История · ${entriesCount(o)} ${plural(entriesCount(o),'запись','записи','записей')}</div><div class="timeline">${entries||'<div class="danger-note">Записей пока нет. Добавьте комментарий или описание дефекта.</div>'}</div>`,[button('Закрыть','close')],'КАРТОЧКА ЗАКАЗА')}
function addComment(){const isManager=state.role==='manager'||canManageUsers,typeOptions=isManager?'<option value="comment">Обычное сообщение</option>':'<option value="comment">Обычное сообщение</option><option value="defect">Дефект детали</option>';showModal('Добавить комментарий',`<form id="entryForm"><div class="field"><label for="entryKind">Тип записи</label><select id="entryKind">${typeOptions}</select></div><div class="field" id="articleField" hidden><label for="article">Артикул детали *</label><input id="article" placeholder="Артикул"></div><div class="field"><label for="entryText">Сообщение *</label><textarea id="entryText" required placeholder="Напишите комментарий"></textarea></div><div class="field"><label for="entryPhotos">Фото (необязательно)</label><div class="upload-box">Прикрепить фотографии<input id="entryPhotos" type="file" accept="image/*" multiple></div><span class="field-hint">Можно отправить обычный текст без артикула и фотографий.</span></div></form>`,[button('Назад','back-detail'),button('Отправить','save-entry','primary-button')],'КОММЕНТАРИЙ');$('entryKind').addEventListener('change',e=>{$('articleField').hidden=e.target.value!=='defect'})}
function saveOrder(){const n=$('orderNumber').value.trim(),client=$('clientName').value.trim();if(!n||!client){toast('Укажите номер заказа и имя клиента.');return}if(state.orders.some(o=>o.number.toLowerCase()===n.toLowerCase())){toast('Карточка с таким номером уже есть.');return}const status=$('startStatus').value,comment=$('initialComment').value.trim();const o={id:crypto.randomUUID(),number:n,client,status,createdAt:isoNow(),author:profileName||roles[state.role],createdBy:signedInUser.uid,entries:[]};if(comment)o.entries.push({id:crypto.randomUUID(),kind:'comment',text:comment,author:profileName||roles[state.role],createdAt:isoNow(),photos:[]});state.orders.unshift(o);save();closeModal();render();toast('Карточка заказа создана.');notify(`Создан заказ № ${n}`,o.id)}
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
async function saveEntry(){const kind=$('entryKind').value,text=$('entryText').value.trim(),article=$('article')?.value.trim()||'';if(!text){toast('Напишите сообщение.');return}if(kind==='defect'&&!article){toast('Для дефекта укажите артикул детали.');return}try{const photoBlobs=await readPhotos($('entryPhotos').files);
const o=state.orders.find(x=>x.id===selectedId);
const entryId=crypto.randomUUID();
const photos=await uploadPhotos(o.id,entryId,photoBlobs);
o.entries.push({id:entryId,kind,article:kind==='defect'?article:'',text,author:profileName||roles[state.role],createdAt:isoNow(),photos});if(kind==='defect')o.status='Под вопросом';save();closeModal();render();toast('Запись добавлена в историю заказа.');notify(`${kind==='defect'?'Дефект':'Комментарий'} к заказу № ${o.number}`,o.id);openOrder(o.id)}catch(e){toast(e.message)}}
function setStatus(status,text,kind='system'){const o=state.orders.find(x=>x.id===selectedId);if(!o)return;o.status=status;o.entries.push({id:crypto.randomUUID(),kind,text,author:roles[state.role],createdAt:isoNow(),photos:[]});save();render();toast(`Статус: ${status}`);notify(`Заказ № ${o.number}: ${status}`,o.id);openOrder(o.id)}
function cancelOrder(){const o=state.orders.find(x=>x.id===selectedId);showModal('Отменить заказ',`<p style="font-size:12px;color:#697382;margin:0 0 14px">Укажите причину отмены заказа № ${esc(o.number)}. Причина сохранится в истории.</p><div class="field"><label for="cancelReason">Причина отмены *</label><textarea id="cancelReason" required placeholder="Почему заказ отменён?"></textarea></div>`,[button('Назад','back-detail'),button('Отменить заказ','confirm-cancel','small-button danger')],'РЕШЕНИЕ МЕНЕДЖЕРА')}
function approveOrder(){showModal('Одобрить на отгрузку',`<p style="font-size:12px;color:#697382;margin:0 0 12px">Заказ № ${esc(state.orders.find(x=>x.id===selectedId)?.number||'')} будет отмечен как одобренный к отгрузке клиенту.</p><div class="field"><label for="approvalComment">Комментарий менеджера (необязательно)</label><textarea id="approvalComment" placeholder="Добавьте пояснение для кладовщика"></textarea></div>`,[button('Назад','back-detail'),button('Одобрить','confirm-approve','small-button good')],'РЕШЕНИЕ МЕНЕДЖЕРА')}
function confirmApprove(){const note=$('approvalComment').value.trim()||'Согласовано к отгрузке клиенту.';setStatus('Одобрен на отгрузку клиенту',note,'decision')}
function confirmCancel(){const reason=$('cancelReason').value.trim();if(!reason){toast('Напишите причину отмены.');return}setStatus('Отменён',reason,'decision')}
function markViewed(){const o=state.orders.find(x=>x.id===selectedId);if(o.entries.some(e=>e.kind==='viewed'&&e.authorId===signedInUser.uid)){toast('Вы уже отмечали этот заказ просмотренным.');return}o.entries.push({id:crypto.randomUUID(),kind:'viewed',text:'Менеджер отметил, что увидел собранный заказ.',author:roles[state.role],createdAt:isoNow(),photos:[]});save();render();notify(`Менеджер просмотрел заказ № ${o.number}`,o.id);openOrder(o.id)}
function decideDefect(entryId,decision){const o=state.orders.find(x=>x.id===selectedId),e=o.entries.find(x=>x.id===entryId);if(decision==='Отменён'){showModal('Отменить заказ',`<p style="font-size:12px;color:#697382;margin:0 0 12px">Напишите причину отмены заказа № ${esc(o.number)} по дефекту артикула ${esc(e.article)}.</p><div class="field"><label for="defectReason">Причина отмены *</label><textarea id="defectReason" required placeholder="Почему заказ отменён?"></textarea></div>`,[button('Назад','back-detail'),button('Отменить заказ','confirm-defect-cancel','small-button danger')],'ОТМЕНА ЗАКАЗА');return}e.decision='Подтверждён';e.decisionText='Дефект согласован менеджером.';e.decidedBy=roles[state.role];e.decidedAt=isoNow();const defects=o.entries.filter(x=>x.kind==='defect');if(defects.every(x=>x.decision==='Подтверждён'))o.status='Одобрен на отгрузку клиенту';save();render();notify(`Дефект артикула ${e.article} по заказу № ${o.number} подтверждён${o.status==='Одобрен на отгрузку клиенту'?' — заказ одобрен к отгрузке':''}`,o.id);openOrder(o.id)}
function confirmDefectCancel(){const reason=$('defectReason').value.trim();if(!reason){toast('Укажите причину решения.');return}const o=state.orders.find(x=>x.id===selectedId),e=o.entries.find(x=>x.id===pendingDefectId);if(!e)return;e.decision='Отменён';e.decisionText=reason;e.decidedBy=roles[state.role];e.decidedAt=isoNow();o.status='Отменён';pendingDefectId=null;save();render();notify(`Заказ № ${o.number} отменён по дефекту артикула ${e.article}: ${reason}`,o.id);toast('Кладовщик получит уведомление об отмене заказа.');openOrder(o.id)}
function deleteOrder(){if(!canManageUsers)return;const o=state.orders.find(x=>x.id===selectedId);if(!o)return;showModal('Удалить карточку?',`<div class="danger-note">Заказ № ${esc(o.number)} и его записи сначала сохранятся в отдельной истории удалённых заказов, а затем исчезнут из общего списка.</div>`,[button('Назад','back-detail'),button('Удалить карточку','confirm-delete','small-button danger')],'УДАЛЕНИЕ ЗАКАЗА')}
function deleteEntry(entryId){const o=state.orders.find(x=>x.id===selectedId),entry=o.entries.find(x=>x.id===entryId);if(!entry||state.role!=='director')return;showModal('Удалить запись?',`<div class="danger-note">Комментарий и прикреплённые к нему фото будут удалены. Действие попадёт в журнал директора.</div>`,[button('Назад','back-detail'),button('Удалить запись','confirm-delete-entry:'+entryId,'small-button danger')],'ДЕЙСТВИЕ ДИРЕКТОРА')}
function confirmDeleteEntry(entryId){const o=state.orders.find(x=>x.id===selectedId),entry=o.entries.find(x=>x.id===entryId);if(!entry)return;const label=entry.article?`дефект артикула ${entry.article}`:({comment:'комментарий',question:'вопрос',decision:'решение',viewed:'отметку о просмотре'})[entry.kind]||'запись';o.entries=o.entries.filter(x=>x.id!==entryId);state.notices.unshift({id:crypto.randomUUID(),message:`Директор удалил ${label} из заказа № ${o.number}`,orderId:null,at:isoNow(),read:false,kind:'audit'});save();render();toast('Удаление внесено в журнал действий.');openOrder(o.id)}
async function confirmDelete(){if(!canManageUsers)return;const o=state.orders.find(x=>x.id===selectedId);if(!o)return;let archived=false;try{const sourceRef=doc(db,'orders',o.id),sourceSnap=await getDoc(sourceRef);if(!sourceSnap.exists()){toast('Заказ уже удалён или недоступен.');return}const sourceEntries=await getDocs(collection(db,'orders',o.id,'entries')),archiveRef=doc(db,'deletedOrders',o.id),archiveSnap=await getDoc(archiveRef);if(!archiveSnap.exists()||archiveSnap.data().complete!==true){if(!archiveSnap.exists()){const data=sourceSnap.data();await setDoc(archiveRef,{sourceOrderId:o.id,number:data.number||o.number,client:data.client||o.client||'',status:data.status||o.status,createdAt:data.createdAt||o.createdAt,createdBy:data.createdBy||'',createdByName:data.createdByName||o.author||'',entriesCount:sourceEntries.size,deletedAt:isoNow(),deletedBy:signedInUser.uid,deletedByName:profileName,deletedByEmail:signedInUser.email||'',complete:false})}for(let i=0;i<sourceEntries.docs.length;i+=450){const batch=writeBatch(db);for(const entrySnap of sourceEntries.docs.slice(i,i+450)){const entry=entryFromCloud(entrySnap.id,entrySnap.data());batch.set(doc(db,'deletedOrders',o.id,'entries',entrySnap.id),entryToCloud(entry))}await batch.commit()}await updateDoc(archiveRef,{complete:true})}archived=true;for(let i=0;i<sourceEntries.docs.length;i+=450){const batch=writeBatch(db);for(const entrySnap of sourceEntries.docs.slice(i,i+450))batch.delete(entrySnap.ref);await batch.commit()}await queuePush(`Заказ № ${o.number} удалён`,`Заказ удалён администратором ${profileName || 'сотрудником'}.`,signedInUser.uid);await deleteDoc(sourceRef);entryUnsubscribes.get(o.id)?.();entryUnsubscribes.delete(o.id);serverCache.delete(o.id);state.orders=state.orders.filter(x=>x.id!==o.id);state.notices.unshift({id:crypto.randomUUID(),message:`Администратор ${profileName} удалил заказ № ${o.number}`,orderId:null,at:isoNow(),read:false,kind:'audit'});closeModal();render();toast('Заказ удалён и сохранён в истории.')}catch(err){console.error('Не удалось удалить заказ с архивированием',err);toast(archived?'Заказ сохранён в истории, но оригинал удалить не удалось. Повторите операцию позже.':'Не удалось заархивировать заказ. Оригинал сохранён. Проверьте правила Firestore и повторите попытку.')}}
async function showDeletedOrders(){if(!canManageUsers)return;try{const snap=await getDocs(collection(db,'deletedOrders')),archives=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.complete===true).sort((a,b)=>String(b.deletedAt||'').localeCompare(String(a.deletedAt||'')));const rows=archives.map(a=>`<div class="notice-item"><b>Заказ № ${esc(a.number||'—')} · ${esc(a.client||'без клиента')}</b><small>${esc(a.status||'')} · удалил ${esc(a.deletedByName||a.deletedByEmail||'администратор')} · ${fmtDateTime(a.deletedAt)} · записей: ${Number(a.entriesCount)||0}</small>${button('Открыть историю','view-deleted-order:'+esc(a.id),'small-button primary-soft')}</div>`).join('');showModal('История удалённых заказов',`<div class="notice-list">${rows||'<div class="danger-note">Удалённых заказов пока нет.</div>'}</div>`,[button('Назад','back-profile'),button('Закрыть','close')],'АРХИВ');}catch(err){console.error('Не удалось загрузить архив заказов',err);toast('Не удалось загрузить историю. Проверьте опубликованные правила Firestore.')}}
async function showDeletedOrder(id){if(!canManageUsers)return;try{const archiveSnap=await getDoc(doc(db,'deletedOrders',id));if(!archiveSnap.exists()||archiveSnap.data().complete!==true){toast('Запись истории не найдена.');showDeletedOrders();return}const a=archiveSnap.data(),entriesSnap=await getDocs(collection(db,'deletedOrders',id,'entries')),entries=entriesSnap.docs.map(d=>({id:d.id,...entryFromCloud(d.id,d.data())})).sort((x,y)=>new Date(x.createdAt)-new Date(y.createdAt)),timeline=entries.map(e=>`<article class="timeline-item"><div class="timeline-top"><span><b>${esc(e.author||'Сотрудник')}</b> · ${fmtDateTime(e.createdAt)}</span><span class="timeline-type">${esc(({defect:'ДЕФЕКТ',question:'ВОПРОС',decision:'РЕШЕНИЕ',comment:'КОММЕНТАРИЙ',viewed:'ПРОСМОТРЕНО',system:'СИСТЕМА'})[e.kind]||'ЗАПИСЬ')}</span></div>${e.article?`<div class="timeline-article">Артикул: ${esc(e.article)}</div>`:''}<div class="timeline-text">${esc(e.text||'')}</div>${e.photos?.length?`<div class="photo-grid">${e.photos.map(p=>`<img src="${esc(p)}" alt="Фото из удалённого заказа" data-photo="${esc(p)}">`).join('')}</div>`:''}</article>`).join('');showModal(`Архив · заказ № ${a.number||'—'}`,`<div class="order-detail-head"><div><div class="detail-number">${esc(a.client||'')}</div><div class="detail-meta">Создан ${fmtDateTime(a.createdAt)} · удалил ${esc(a.deletedByName||a.deletedByEmail||'администратор')} · ${fmtDateTime(a.deletedAt)}</div></div><div>${statusPill(a.status||'Удалён')}</div></div><div class="timeline">${timeline||'<div class="danger-note">У заказа не было записей.</div>'}</div>`,[button('Назад к архиву','deleted-orders'),button('Закрыть','close')],'ИСТОРИЯ УДАЛЁННЫХ ЗАКАЗОВ')}catch(err){console.error('Не удалось открыть архивный заказ',err);toast('Не удалось открыть заказ из истории.')}}
function paintNotices(){const unread=state.notices.some(n=>!n.read);$('notificationButton').classList.toggle('has-notice',unread)}
async function disablePush(){try{if(!signedInUser)throw new Error('User is not signed in');const installationId=localStorage.getItem('ampPushInstallationId');const tokensRef=collection(db,'users',signedInUser.uid,'pushTokens');const snap=await getDocs(tokensRef);const batch=writeBatch(db);for(const tokenDoc of snap.docs){const data=tokenDoc.data()||{};if(installationId&&data.installationId===installationId)batch.delete(tokenDoc.ref)}await batch.commit();await deleteToken(messaging).catch(()=>{});toast('Push-уведомления выключены на этом устройстве.')}catch(err){console.error('Не удалось выключить push',err);toast('Не удалось выключить уведомления. Попробуйте ещё раз.')}}

function showNotifications(){state.notices.forEach(n=>n.read=true);paintNotices();showModal('Уведомления',state.notices.length?`<div class="notice-list">${state.notices.map(n=>`<div class="notice-item">${esc(n.message)}<small>${fmtDateTime(n.at)}</small></div>`).join('')}</div>`:'<div class="danger-note">Новых уведомлений пока нет.</div>',[button('🔔 Разрешить на этом устройстве','enable-notifications','small-button'),button('🔕 Выключить на этом устройстве','disable-notifications','small-button danger'),button('Готово','close')],'ЦЕНТР УВЕДОМЛЕНИЙ')}
function profileMenu(){const themeAction=button(document.body.classList.contains('dark-theme')?'☀️ Светлая тема':'🌙 Тёмная тема','toggle-theme','small-button primary-soft'),adminAction=canManageUsers?button('Учётные записи сотрудников','open-staff','small-button primary-soft'):'',historyAction=canManageUsers?button('История удалённых заказов','deleted-orders','small-button'):'',hasPassword=signedInUser?.providerData.some(p=>p.providerId==='password');showModal('Учётная запись',`<p style="font-size:13px;color:#52635a;margin:0 0 6px"><b>${esc(profileName)}</b><br>${esc(signedInUser?.email||'')} · ${esc(roles[state.role])}${canManageUsers?' · администратор':''}</p>`,[themeAction,adminAction,historyAction,...(!hasPassword?[button('Задать пароль для входа','set-login-password','small-button')]:[button('Сменить пароль','change-password','small-button')]),button('Выйти','sign-out','small-button danger'),button('Закрыть','close')],'ПРОФИЛЬ СОТРУДНИКА')}
function setLoginPassword(){showModal('Задать пароль для входа',`<p class="field-hint">Это подключит вход по почте и паролю к этой учётной записи. Текущий вход Google продолжит работать.</p><div class="field"><label for="linkPassword">Новый пароль *</label><input id="linkPassword" type="password" minlength="6" autocomplete="new-password" required></div>`,[button('Назад','back-profile'),button('Задать пароль','save-login-password','primary-button')],'БЕЗОПАСНОСТЬ')}
async function saveLoginPassword(){const password=$('linkPassword').value;if(password.length<6){toast('Пароль должен содержать минимум 6 символов.');return}try{await linkWithCredential(signedInUser,EmailAuthProvider.credential(signedInUser.email,password));toast('Вход по почте и паролю подключён.');profileMenu()}catch(err){console.error('Не удалось подключить пароль',err);toast(err.code==='auth/credential-already-in-use'?'Эта почта уже связана с другой учётной записью.':'Не удалось задать пароль. Выйдите и войдите через Google заново.') }}
function changePassword(){showModal('Сменить пароль',`<form id="changePasswordForm"><div class="field"><label for="currentPassword">Текущий пароль *</label><input id="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label for="newPassword">Новый пароль *</label><input id="newPassword" type="password" minlength="6" autocomplete="new-password" required><span class="field-hint">Не менее 6 символов.</span></div><div class="field"><label for="confirmPassword">Повторите новый пароль *</label><input id="confirmPassword" type="password" minlength="6" autocomplete="new-password" required></div></form>`,[button('Назад','back-profile'),button('Сохранить пароль','save-password','primary-button')],'БЕЗОПАСНОСТЬ')}
async function savePassword(){const current=$('currentPassword').value,next=$('newPassword').value,confirm=$('confirmPassword').value;if(!signedInUser.providerData.some(p=>p.providerId==='password')){toast('Сначала задайте пароль для входа в меню профиля.');return}if(next.length<6){toast('Новый пароль должен содержать минимум 6 символов.');return}if(next!==confirm){toast('Новые пароли не совпадают.');return}try{await reauthenticateWithCredential(signedInUser,EmailAuthProvider.credential(signedInUser.email,current));await updatePassword(signedInUser,next);closeModal();toast('Пароль успешно изменён.')}catch(err){console.error('Не удалось сменить пароль',err);toast(err.code==='auth/invalid-credential'||err.code==='auth/wrong-password'?'Текущий пароль указан неверно.':err.code==='auth/weak-password'?'Пароль слишком простой.':err.code==='auth/requires-recent-login'?'Войдите заново и повторите смену пароля.':'Не удалось сменить пароль. Проверьте текущий пароль и соединение.')}}
async function showStaff(){if(!canManageUsers)return;try{const snap=await getDocs(collection(db,'users'));const people=snap.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>String(a.displayName||'').localeCompare(String(b.displayName||''),'ru'));const rows=people.map(p=>`<div class="notice-item"><b>${esc(p.displayName||'Без имени')}</b><small>${esc(p.email||'')} · ${esc(roles[p.role]||'роль не задана')} · ${p.active?'Активен':'Отключён'}${p.admin?' · Администратор':''}</small>${p.uid!==signedInUser.uid?`<div class="staff-actions"><select id="staff-role-${esc(p.uid)}" aria-label="Роль сотрудника ${esc(p.displayName||p.email||'')}"><option value="warehouse" ${p.role==='warehouse'?'selected':''}>Кладовщик</option><option value="manager" ${p.role==='manager'?'selected':''}>Менеджер</option><option value="director" ${p.role==='director'?'selected':''}>Директор</option></select><button class="small-button primary-soft" data-action="save-role:${esc(p.uid)}">Сохранить роль</button><button class="small-button ${p.active?'danger':'good'}" data-action="toggle-user:${esc(p.uid)}:${p.active?'off':'on'}">${p.active?'Отключить':'Включить'}</button></div>`:''}</div>`).join('');showModal('Учётные записи сотрудников',`<div class="notice-list">${rows||'<div class="danger-note">Пока нет сотрудников.</div>'}</div>`,[button('Назад','back-profile'),button('＋ Добавить сотрудника','new-staff','primary-button')],'АДМИНИСТРИРОВАНИЕ') }catch(err){console.error(err);toast('Не удалось загрузить список сотрудников.')}}
function newStaff(){if(!canManageUsers)return;const rolesOptions=`<option value="warehouse">Кладовщик</option><option value="manager">Менеджер</option><option value="director">Директор</option>`;showModal('Добавить сотрудника',`<form id="staffForm"><div class="field"><label for="staffName">Имя сотрудника *</label><input id="staffName" required autocomplete="off"></div><div class="field"><label for="staffEmail">Почта *</label><input id="staffEmail" type="email" required autocomplete="email"></div><div class="field"><label for="staffPassword">Пароль *</label><input id="staffPassword" type="password" minlength="6" autocomplete="new-password" required><span class="field-hint">Минимум 6 символов. Сотрудник сможет сменить пароль после входа.</span></div><div class="field"><label for="staffRole">Роль</label><select id="staffRole">${rolesOptions}</select></div></form>`,[button('Назад','open-staff'),button('Добавить сотрудника','create-staff','primary-button')],'НОВЫЙ СОТРУДНИК')}
async function createStaff(){const displayName=$('staffName').value.trim(),email=$('staffEmail').value.trim().toLowerCase(),password=$('staffPassword').value,role=$('staffRole').value;if(!displayName||!email||!password){toast('Заполните имя, почту и пароль.');return}if(password.length<6){toast('Пароль должен содержать минимум 6 символов.');return}if(!canManageUsers){toast('У вас нет прав назначить эту роль.');return}let createdUser=null;try{const result=await createUserWithEmailAndPassword(staffAuth,email,password);createdUser=result.user;await setDoc(doc(db,'users',createdUser.uid),{displayName,email,role,active:true,admin:false});toast('Сотрудник добавлен. Можно войти с указанными почтой и паролем.');showStaff()}catch(err){console.error('Не удалось добавить сотрудника',err);toast(createdUser?'Аккаунт создан, но профиль не сохранился. Проверьте правила Firestore и удалите аккаунт в Firebase Console.':err.code==='auth/email-already-in-use'?'Эта почта уже зарегистрирована. Удалите старый аккаунт в Firebase Console → Authentication → Users.':err.code==='auth/weak-password'?'Пароль слишком простой. Используйте не менее 6 символов.':`Не удалось добавить сотрудника: ${err.code||err.message||'ошибка'}`)}finally{if(staffAuth.currentUser)await signOut(staffAuth).catch(()=>{})}}
function backProfile(){closeModal();profileMenu()}
async function toggleStaff(uid,active){if(!canManageUsers||uid===signedInUser.uid)return;try{await updateDoc(doc(db,'users',uid),{active});toast(active?'Доступ сотрудника включён.':'Доступ сотрудника отключён.');showStaff()}catch(err){console.error(err);toast('Не удалось изменить доступ сотрудника.')}}
async function changeStaffRole(uid){if(!canManageUsers||uid===signedInUser.uid)return;const role=$(`staff-role-${uid}`)?.value;if(!roles[role])return;try{await updateDoc(doc(db,'users',uid),{role});toast(`Роль изменена: ${roles[role]}.`);showStaff()}catch(err){console.error(err);toast('Не удалось изменить роль. Проверьте права администратора и правила Firestore.')}}
function backDetail(){closeModal();openOrder(selectedId)}
document.addEventListener('click',e=>{const open=e.target.closest('[data-open]');if(open){e.preventDefault();openOrder(open.dataset.open);return}const nav=e.target.closest('.nav-item');if(nav){activeFilter=nav.dataset.filter;render();closeSidebar();return}if(e.target===$('sidebarBackdrop')){closeSidebar();return}if(e.target===$('imageViewer')||e.target===$('closeImageViewer')){$('imageViewer').hidden=true;$('imageViewerImage').removeAttribute('src');return}const act=e.target.closest('[data-action]')?.dataset.action;if(act){if(act==='close')closeModal();else if(act==='create-order')saveOrder();else if(act==='add-comment')addComment();else if(act==='back-detail')backDetail();else if(act==='save-entry')saveEntry();else if(act==='set-approval')setStatus('На согласовании','Начал согласование заказа с клиентом.');else if(act==='approve-order')approveOrder();else if(act==='confirm-approve')confirmApprove();else if(act==='cancel-order')cancelOrder();else if(act==='confirm-cancel')confirmCancel();else if(act==='mark-seen')markViewed();else if(act==='delete-order')deleteOrder();else if(act==='confirm-delete')confirmDelete();else if(act.startsWith('delete-entry:'))deleteEntry(act.split(':')[1]);else if(act.startsWith('confirm-delete-entry:'))confirmDeleteEntry(act.split(':')[1]);else if(act==='confirm-defect-cancel')confirmDefectCancel();else if(act==='sign-out'){closeModal();signOut(auth)}else if(act==='open-staff')showStaff();else if(act==='new-staff')newStaff();else if(act==='create-staff')createStaff();else if(act==='back-profile')backProfile();else if(act==='change-password')changePassword();else if(act==='save-password')savePassword();else if(act==='set-login-password')setLoginPassword();else if(act==='save-login-password')saveLoginPassword();else if(act==='deleted-orders')showDeletedOrders();else if(act==='toggle-theme'){applyTheme(document.body.classList.contains('dark-theme')?'light':'dark');profileMenu();}else if(act.startsWith('view-deleted-order:'))showDeletedOrder(act.slice('view-deleted-order:'.length));else if(act.startsWith('save-role:'))changeStaffRole(act.slice('save-role:'.length));else if(act.startsWith('toggle-user:')){const[,uid,mode]=act.split(':');toggleStaff(uid,mode==='on')}else if(act==='enable-notifications'){enablePush()}else if(act==='disable-notifications'){disablePush()}else if(act.startsWith('defect-confirm:'))decideDefect(act.split(':')[1],'Подтверждён');else if(act.startsWith('defect-cancel:')){pendingDefectId=act.split(':')[1];decideDefect(pendingDefectId,'Отменён')}return}if(e.target===modal)closeModal();const photo=e.target.closest('[data-photo]');if(photo){$('imageViewerImage').src=photo.dataset.photo;$('imageViewer').hidden=false}});
let sidebarHistoryEntry=false,handlingSidebarPop=false;function closeSidebar(fromPop=false){$('sidebar').classList.remove('open');$('sidebarBackdrop').hidden=true;if(sidebarHistoryEntry&&!fromPop){handlingSidebarPop=true;history.back()}sidebarHistoryEntry=false}
function openSidebar(){if($('sidebar').classList.contains('open')){closeSidebar();return}$('sidebar').classList.add('open');$('sidebarBackdrop').hidden=false;history.pushState({mobileSidebar:true},'','#menu');sidebarHistoryEntry=true}
window.addEventListener('popstate',()=>{if($('sidebar').classList.contains('open'))closeSidebar(true);else if(handlingSidebarPop)handlingSidebarPop=false});document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSidebar();if(!$('imageViewer').hidden){$('imageViewer').hidden=true;$('imageViewerImage').removeAttribute('src')}}});$('closeImageViewer').addEventListener('click',()=>{$('imageViewer').hidden=true;$('imageViewerImage').removeAttribute('src')});
$('newOrderButton').addEventListener('click',openNewOrder);$('emptyAddButton').addEventListener('click',openNewOrder);$('closeModal').addEventListener('click',closeModal);$('searchInput').addEventListener('input',render);$('dateFilter').addEventListener('change',render);$('clearDateButton').addEventListener('click',()=>{$('dateFilter').value='';render()});$('notificationButton').addEventListener('click',showNotifications);$('profileButton').addEventListener('click',profileMenu);$('mobileMenu').addEventListener('click',openSidebar);$('filterButton').addEventListener('click',()=>{const filters=['all','Под вопросом','На согласовании','Одобрен на отгрузку клиенту','Отменён'];const idx=filters.indexOf(activeFilter);activeFilter=filters[(idx+1)%filters.length];render();toast(activeFilter==='all'?'Показаны все заказы':`Фильтр: ${activeFilter}`)});document.addEventListener('submit',e=>e.preventDefault());
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
showAuth();
