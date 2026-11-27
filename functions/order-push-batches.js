// Server-only trailing-edge debounce. All batch state and receipts are durable.
// The first event opens a window, later events extend it by 5s, at most 10s.
const {createHash}=require('node:crypto');
const QUIET_MS=5000,MAX_MS=10000,MAX_EVENTS=30;
const ROUTINE=new Set(['orders','assembly','status','editing','comments']);
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const isRoutine=data=>data.target==='site'&&!!data.orderId&&!!data.authorId&&ROUTINE.has(data.category)&&!data.isDeleted&&!data.forceAll&&!data.isMention&&!data.isReply&&!data.isUrgent&&!data.recipientUserId&&!data.directChatThreadId&&!data.buybackItemId&&!(data.mentionRecipientIds||[]).length;
function canAppend(batch,now){
 return !!batch&&!batch.sentAt&&!batch.sealedAt&&Array.isArray(batch.events)&&batch.events.length<MAX_EVENTS&&now<Number(batch.dueAt);
}
function nextDue(firstAt,now){return Math.min(firstAt+MAX_MS,now+QUIET_MS);}
function cleanEvent(eventId,data,eventAt){
 return {eventId:String(eventId),eventAt:Number(eventAt)||0,authorId:String(data.authorId),orderId:String(data.orderId),orderNumber:String(data.orderNumber||'').slice(0,80),title:String(data.title||'Заказы · Склад').slice(0,120),body:String(data.body||'Новое изменение').slice(0,500),category:data.category,entryId:String(data.entryId||''),excludedRecipientIds:[...new Set((data.excludedRecipientIds||[]).map(String))].slice(0,20)};
}
async function appendOrderPush({db,eventId,data,eventAt,now=Date.now}){
 const item=cleanEvent(eventId,data,eventAt);
 const receipt=db.collection('orderPushEventReceipts').doc(digest(eventId));
 const pointer=db.collection('orderPushWindows').doc(digest(JSON.stringify([item.authorId,item.orderId])));
 const fresh=db.collection('orderPushBatches').doc('order-batch-'+digest(eventId));
 return db.runTransaction(async tx=>{
  const existing=await tx.get(receipt);
  if(existing.exists)return existing.data().batchId;
  const window=await tx.get(pointer);
  const id=window.data()?.batchId;
  const current=id?db.collection('orderPushBatches').doc(id):null;
  const snap=current?await tx.get(current):null;
  const batch=snap?.data(),at=now();
  const append=canAppend(batch,at);
  const ref=append?current:fresh;
  const firstAt=append?Number(batch.firstAt):at;
  const dueAt=nextDue(firstAt,at);
  if(append)tx.update(ref,{events:[...batch.events,item],lastAt:at,dueAt});
  else{
   tx.create(ref,{orderBatch:true,firstAt,lastAt:at,dueAt,events:[item],sentAt:null,sealedAt:null,createdAt:new Date(at).toISOString(),expiresAt:at+60000});
   tx.set(pointer,{batchId:ref.id});
  }
  tx.create(receipt,{batchId:ref.id,createdAt:new Date(at).toISOString()});
  return ref.id;
 });
}
async function sealOrderPush({db,ref,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 for(;;){
  const result=await db.runTransaction(async tx=>{
   const snap=await tx.get(ref),batch=snap.data();
   if(!snap.exists||!batch?.orderBatch||batch.sentAt)return {done:true};
   if(batch.sealedAt)return {batch};
   const at=now(),wait=Number(batch.dueAt)-at;
   if(wait>0)return {wait};
   tx.update(ref,{sealedAt:at});
   return {batch:{...batch,sealedAt:at}};
  });
  if(result.done)return null;
  if(result.batch)return result.batch;
  await sleep(Math.max(1,Math.min(MAX_MS,result.wait)));
 }
}
function deliveryFor(batch,userId,settings,enabled){
 const events=(batch.events||[]).filter(e=>e.authorId!==userId&&!(e.excludedRecipientIds||[]).includes(userId)&&enabled(settings||{},e.category)).sort((a,b)=>a.eventAt-b.eventAt||a.eventId.localeCompare(b.eventId));
 if(!events.length)return null;
 const last=events[events.length-1],single=events.length===1;
 const forms=n=>n%100>=11&&n%100<=14?'действий':n%10===1?'действие':n%10>=2&&n%10<=4?'действия':'действий';
 const prefix=events.length+' '+forms(events.length)+': ';
 // Put actual comment text first for a collapsed mobile notification, not a
 // generic "comment added" label. The remaining actions follow in full view.
 const comments=events.filter(e=>e.category==='comments');
 const other=events.filter(e=>e.category!=='comments');
 const details=[...comments.slice().reverse().map(e=>e.body),...other.map(e=>e.body)];
 let body=details.join('\n');
 if(body.length>500-prefix.length)body=body.slice(0,499-prefix.length)+'…';
 return {title:last.title,body:single?last.body:(prefix+body).slice(0,500),authorId:last.authorId,orderId:last.orderId,orderNumber:last.orderNumber,entryId:single?last.entryId:'',target:'site',category:last.category,recipientUserId:userId,orderBatchDelivery:true,batchCount:events.length,batchCategories:[...new Set(events.map(e=>e.category))],batchEvents:events.map(e=>({category:e.category,body:e.body,entryId:e.entryId})),mentionRecipientIds:[],excludedRecipientIds:[],isMention:false,isReply:false,isUrgent:false,createdAt:new Date(batch.lastAt).toISOString(),expiresAt:Number(batch.lastAt)+60000,sentAt:null};
}
async function dispatchOrderPush({db,ref,enabled,markDone,now=Date.now,sleep}){
 const batch=await sealOrderPush({db,ref,now,sleep});
 if(!batch)return;
 const users=await db.collection('users').where('active','==',true).get();
 let recipients=0;
 await Promise.all(users.docs.map(async user=>{
  const data=deliveryFor(batch,user.id,user.data()?.notificationSettings,enabled);
  if(!data)return;
  recipients++;
  const child=db.collection('pushQueue').doc('order-delivery-'+digest(JSON.stringify([ref.id,user.id])));
  try{await child.create(data);}catch(error){if(![6,'already-exists','ALREADY_EXISTS'].includes(error.code))throw error;}
 }));
 await markDone(ref,{deliveryStatus:'batched',batchRecipientCount:recipients,batchCount:batch.events.length});
}
module.exports={isRoutine,canAppend,nextDue,appendOrderPush,sealOrderPush,deliveryFor,dispatchOrderPush};
