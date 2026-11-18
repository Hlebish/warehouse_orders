const {createHash}=require('node:crypto');
const {inspectionMatches,clientKey,millis,articleKey}=require('./inspection-model');
const {resolveBuybackArticle}=require('./buyback-articles');
const ROLES=['warehouse','manager','accountant','chief_accountant','director'];
function createInspectionHandlers({db,FieldValue,HttpsError}){
 const activeQuery=()=>db.collection('inspectionItems').where('status','in',['pending','checked']);
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 const string=(value,max,required=false)=>{if(value!==undefined&&typeof value!=='string')fail('invalid-argument','Некорректный формат данных.');const text=String(value||'').trim();if((required&&!text)||text.length>max)fail('invalid-argument',required?'Заполните обязательные поля.':'Слишком длинное значение.');return text;};
 const identifier=value=>{const id=string(value,100,true);if(!/^[A-Za-z0-9_-]+$/.test(id))fail('invalid-argument','Некорректный идентификатор.');return id;};
 async function manage(request){
  if(!request.auth?.uid)fail('unauthenticated','Войдите в приложение.');
  const uid=request.auth.uid,profile=(await db.collection('users').doc(uid).get()).data();
  if(profile?.active!==true||!ROLES.includes(profile.role))fail('permission-denied','Доступ сотрудника отключён.');
  const admin=profile.admin===true||profile.role==='director',warehouse=profile.role==='warehouse'||admin,manager=['manager','accountant','chief_accountant'].includes(profile.role)||admin;
  const data=request.data||{},action=data.action,id=identifier(data.id),ref=db.collection('inspectionItems').doc(id),name=String(profile.displayName||'Сотрудник').slice(0,200),now=new Date().toISOString();
  if(action==='create'){
   const article=string(data.article,160,true),key=articleKey(article),itemName=string(data.name,200),client=string(data.client,200),clientId=string(data.clientId,128);
   if(!key)fail('invalid-argument','Укажите корректный артикул.');
   return db.runTransaction(async tx=>{
    const existing=await tx.get(ref);if(existing.exists){const item=existing.data();if(item.createdBy===uid&&item.articleKey===key&&item.client===client&&item.name===itemName)return {id};fail('already-exists','Эта позиция уже сохранена.');}
    tx.create(ref,{article,articleKey:key,name:itemName,client,clientId,clientKey:clientKey(client),status:'pending',createdAt:FieldValue.serverTimestamp(),createdBy:uid,createdByName:name,updatedAt:FieldValue.serverTimestamp(),defects:[]});return {id};
   });
  }
  if(!['check','reopen','reportDefect','decideDefect','remove'].includes(action))fail('invalid-argument','Неизвестное действие.');
  if(['check','reopen','reportDefect'].includes(action)&&!warehouse)fail('permission-denied','Проверку и дефекты отмечает кладовщик.');
  if(action==='decideDefect'&&!manager)fail('permission-denied','Решение по дефекту принимает менеджер или бухгалтер.');
  let defect;
  if(action==='reportDefect'){
   const defectId=identifier(data.defectId),text=string(data.text,2000,true),photos=data.photos||[];
   if(!Array.isArray(photos)||photos.length>5||photos.some(url=>{try{const parsed=new URL(url);return parsed.protocol!=='https:'||parsed.hostname!=='firebasestorage.googleapis.com'||!['/v0/b/sklad-18f38.firebasestorage.app/o/','/v0/b/sklad-18f38.appspot.com/o/'].some(prefix=>parsed.pathname.startsWith(prefix))||!decodeURIComponent(parsed.pathname.split('/o/')[1]||'').startsWith(`inspectionItems/${id}/${uid}/${defectId}/`);}catch{return true;}}))fail('invalid-argument','Можно прикрепить до пяти фотографий этой позиции.');
   defect={id:defectId,text,photos,authorId:uid,authorName:name,createdAt:now,decision:''};
  }
  return db.runTransaction(async tx=>{
   const snap=await tx.get(ref);if(!snap.exists)fail('not-found','Позиция не найдена.');const item=snap.data();
   if(!['pending','checked'].includes(item.status))fail('failed-precondition','Позиция уже снята с проверки или добавлена в заказ.');
   const patch={updatedAt:FieldValue.serverTimestamp()},defects=Array.isArray(item.defects)?item.defects:[];
   if(action==='check'&&item.status==='checked')return {id};
   if(action==='reopen'&&item.status==='pending')return {id};
   if(action==='check'){
    if(defects.some(d=>!d.decision))fail('failed-precondition','Сначала дождитесь решения по дефекту.');
    Object.assign(patch,{status:'checked',checkedAt:now,checkedBy:uid,checkedByName:name});
   }
   if(action==='reopen')Object.assign(patch,{status:'pending',checkedAt:null,checkedBy:'',checkedByName:''});
   if(action==='reportDefect'){
    if(defects.some(d=>d.id===defect.id))return {id};
    if(defects.some(d=>!d.decision))fail('failed-precondition','По этой позиции уже ожидается решение по дефекту.');
    if(defects.length>=10)fail('failed-precondition','Для этой позиции уже сохранено 10 дефектов.');
    Object.assign(patch,{status:'pending',defects:[...defects,defect],checkedAt:null,checkedBy:'',checkedByName:''});
   }
   if(action==='decideDefect'){
    const defectId=identifier(data.defectId),index=defects.findIndex(d=>d.id===defectId);if(index<0)fail('not-found','Дефект не найден.');
    if(!['approve','cancel'].includes(data.decision))fail('invalid-argument','Неизвестное решение.');
    if(defects[index].decision)fail('failed-precondition','Решение уже принято.');
    defects[index]={...defects[index],decision:data.decision==='approve'?'Подтверждён':'Отменён',decidedAt:now,decidedBy:uid,decidedByName:name};patch.defects=defects;
    if(data.decision==='cancel')Object.assign(patch,{status:'removed',removedAt:now,removedBy:uid});
   }
   if(action==='remove'){
    if(!manager&&item.createdBy!==uid)fail('permission-denied','Снять позицию может её автор или менеджер.');
    Object.assign(patch,{status:'removed',removedAt:now,removedBy:uid});
   }
   tx.update(ref,patch);return {id};
  });
 }
 async function syncOrder(snapshot,eventId,before=null){
  if(!snapshot?.exists)return;
  const eventOrder=snapshot.data(),cutoff=millis(before?snapshot.updateTime:snapshot.createTime)||Date.now(),orderRef=snapshot.ref;
  const markerRef=orderRef.collection('inspectionSync').doc(createHash('sha256').update(eventId).digest('hex'));
  let more=true;
  while(more){more=await db.runTransaction(async tx=>{
   const marker=await tx.get(markerRef);if(marker.data()?.complete)return false;
   const orderSnap=await tx.get(orderRef);if(!orderSnap.exists)return false;const order=orderSnap.data();
   const active=await tx.get(activeQuery()),items=active.docs.map(doc=>({id:doc.id,...doc.data()}));
   // Match only the article additions from this event that still exist in the
   // current order. Later status edits cannot consume newly added checks.
   const known=new Set(items.map(item=>item.articleKey));
   const live=new Map();for(const line of order.articles||[]){const key=resolveBuybackArticle(line.article,known);live.set(key,(live.get(key)||0)+Math.max(1,Math.floor(Number(line.quantity)||1)));}
   const consumed={...(marker.data()?.consumed||{})};
   const matches=inspectionMatches({...eventOrder,client:order.client,clientId:order.clientId,status:order.status},items,cutoff,before,consumed,live);
   const chunk=matches.slice(0,20),count=Number(marker.data()?.count)||0;let hasPendingDefect=false;
   for(const item of chunk){
    consumed[item.articleKey]=(consumed[item.articleKey]||0)+1;
    tx.update(db.collection('inspectionItems').doc(item.id),{status:'ordered',orderId:orderRef.id,orderNumber:String(order.number||''),orderedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
    const articleIndex=(order.articles||[]).findIndex(line=>resolveBuybackArticle(line.article,known)===item.articleKey);
    for(const defect of item.defects||[]){
     const entryId=`inspection_${item.id}_${defect.id}`,entry={kind:'defect',article:order.articles[articleIndex].article,articleIndex,text:defect.text,photos:defect.photos||[],important:false,authorId:defect.authorId,authorName:defect.authorName,createdAt:defect.createdAt};
     if(defect.decision)Object.assign(entry,{decision:defect.decision,decidedAt:defect.decidedAt,decidedBy:defect.decidedBy,decidedByName:defect.decidedByName});
     else hasPendingDefect=true;
     tx.set(orderRef.collection('entries').doc(entryId),entry);
    }
   }
   if(hasPendingDefect&&!['Отгружен кладовщиком','Клиент забрал самовывозом','Отменён','Возврат'].includes(order.status))tx.update(orderRef,{status:'Дефект',updatedAt:new Date().toISOString(),updatedBy:'system',updatedByName:'Проверка товара'});
   tx.set(markerRef,{complete:matches.length<=20,count:count+chunk.length,consumed,processedAt:FieldValue.serverTimestamp()});
   return matches.length>20;
  });}
 }
 return {manage,syncOrder};
}
module.exports={createInspectionHandlers};
