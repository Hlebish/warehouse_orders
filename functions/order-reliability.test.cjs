const {test}=require('node:test');
const assert=require('node:assert/strict');
const {orderEvent,entryEvent,serverManagedPush}=require('./order-notification-events');

test('persisted orders classify actions without notifying on individual checkboxes',()=>{
 const base={status:'Создан',createdBy:'author',updatedBy:'author',articles:[{article:'APBM2802',quantity:1}]};
 assert.equal(orderEvent(null,base).category,'orders');
 assert.equal(orderEvent(base,{...base,status:'Собран',updatedBy:'warehouse'}).authorId,'warehouse');
 assert.equal(orderEvent(base,{...base,articles:[{article:'APBM2802',quantity:1,collected:true}]}),null);
 assert.equal(orderEvent(base,{...base,status:'Дефект'}),null);
 assert.equal(entryEvent({kind:'defect',authorId:'author',text:'defect'}).category,'defects');
});
test('addressed comments do not duplicate personal cards, old clients do not duplicate server events',()=>{
 assert.deepEqual(entryEvent({kind:'comment',authorId:'author'},['peer','peer']).excludedRecipientIds,['peer']);
 assert.equal(entryEvent({kind:'comment',authorId:'author',replyToEntryId:'e'}),null);
 assert.equal(serverManagedPush({target:'site',category:'orders',orderId:'1'}),true);
 assert.equal(serverManagedPush({target:'site',category:'orders',orderId:'1',forceAll:true}),false);
 assert.equal(serverManagedPush({target:'site',category:'editing',orderId:'1',body:'Удалена запись из истории заказа'}),false);
});
test('order window renders progressively, deduplicates and rejects older overlapping snapshots',async()=>{
 const {watchOrderWindow}=await import('../orders-window.mjs');
 const listeners=[],out=[];let stopped=0;
 const stop=watchOrderWindow({db:{},collection:()=>({}),query:(...q)=>q,where:(...q)=>q,onSnapshot:(q,opts,cb)=>{listeners.push(cb);return()=>stopped++;}},s=>out.push({docs:s.docs.map(d=>[d.id,d.data().status]),cache:s.metadata.fromCache,changes:s.docChanges().map(c=>[c.type,c.doc.id])}),err=>{throw err;});
 const doc=(id,status,updatedAt='2026-11-25T00:00:00Z')=>({id,data:()=>({status,updatedAt}),metadata:{hasPendingWrites:false}});
 const emit=(i,docs,fromCache=false)=>listeners[i]({docs,metadata:{fromCache,hasPendingWrites:false}});
 emit(0,[doc('a','Создан')]);assert.equal(out.at(-1).docs.length,1);assert.equal(out.at(-1).cache,true);
 emit(1,[doc('a','Создан'),doc('b','Отменён')]);for(let i=2;i<5;i++)emit(i,[]);
 assert.equal(out.at(-1).docs.length,2);assert.equal(out.at(-1).cache,false);
 emit(0,[doc('a','Собран','2026-11-26T00:00:00Z')]);emit(1,[doc('a','Создан'),doc('b','Отменён')]);
 assert.equal(out.at(-1).docs.find(x=>x[0]==='a')[1],'Собран');
 emit(0,[]);emit(1,[]);assert.equal(out.at(-1).docs.length,0);stop();assert.equal(stopped,5);
});
test('order list preserves transfers and separate Kamyanske, filters before sorting',async()=>{
 const {sortOrderRows}=await import('../orders-window.mjs');
 const orders=[{id:'1',status:'Создан',createdAt:'2026-11-26'},{id:'2',status:'Перенесен',createdAt:'2026-11-01'},{id:'3',status:'Камянское',createdAt:'2026-11-26'},{id:'4',status:'Собран',createdAt:'2026-11-26'}];
 const options={activeFilter:'all',search:'',dateFrom:'',dateTo:'',orderDisplayDate:o=>o.createdAt,localDateKey:d=>String(d).slice(0,10),orderSearchText:o=>o.id,isDateInRange:()=>true,asDate:v=>new Date(v)};
 assert.deepEqual(sortOrderRows(orders,options).map(o=>o.id),['2','1','4']);
 assert.equal(sortOrderRows(orders,{...options,search:'4'}).length,1);
});

test('partial push failure retries only devices not accepted by FCM',async()=>{
 const vm=require('node:vm'),{readFileSync}=require('node:fs'),{createHash}=require('node:crypto');
 const source=readFileSync(require('node:path').join(__dirname,'index.js'),'utf8');
 const begin=source.indexOf('exports.sendWarehousePush ='),end=source.indexOf('function buybackEventDocId',begin);
 assert.ok(begin>=0&&end>begin);
 const queue={authorId:'a',target:'site',category:'orders',createdAt:new Date().toISOString(),expiresAt:Date.now()+60000};
 const accepted=[],attempts=[],exports={};let failAndroid=true;
 const ref={async update(fields){for(const [k,v] of Object.entries(fields)){if(v?.union)queue[k]=[...new Set([...(queue[k]||[]),...v.union])];else queue[k]=v;}}};
 const devices=[{token:'desktop-token',platform:'web',userId:'b'},{token:'phone-token',platform:'android',userId:'b'}];
 const context={exports,onDocumentCreated:(_config,fn)=>fn,createHash,claimEvent:async()=>({...queue}),createNotificationHistory:async()=>{},markDone:async(_ref,fields)=>Object.assign(queue,fields),notificationTagFor:()=> 'tag',collectTokens:async()=>devices,registerNotificationBurst:async()=>1,notificationCopy:()=>({title:'order',body:'new'}),INVALID_TOKEN_CODES:new Set(),FieldValue:{arrayUnion:(...union)=>({union}),delete:()=>null},logger:{info(){},error(){},warn(){}},messaging:{async sendEachForMulticast(message){attempts.push(...message.tokens);return {responses:message.tokens.map(token=>{if(token==='phone-token'&&failAndroid)return {success:false,error:{code:'messaging/server-unavailable'}};accepted.push(token);return {success:true};})};}}};
 vm.createContext(context);vm.runInContext(source.slice(begin,end),context);
 const event={data:{ref,data:()=>({})},params:{eventId:'event'}};
 await assert.rejects(exports.sendWarehousePush(event),/retry remaining devices/);
 assert.equal(queue.deliveryStatus,'retrying');assert.equal(queue.acceptedCount,1);
 failAndroid=false;await exports.sendWarehousePush(event);
 assert.deepEqual(attempts,['desktop-token','phone-token','phone-token']);assert.deepEqual(accepted,['desktop-token','phone-token']);
 assert.equal(queue.deliveryStatus,'sent');assert.equal(queue.acceptedCount,2);
 assert.equal(queue.platformDelivery.web.accepted,1);assert.equal(queue.platformDelivery.android.accepted,1);
});

test('text drafts are isolated by employee and form, survive reopening and expire',async()=>{
 const {createFormDraftStore}=await import('../client-reliability.mjs');
 let now=10;const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
 const draft={fields:{clientName:{value:'Client'}},articles:[{article:'AP',quantity:'2'}]};
 const store=createFormDraftStore(storage,{now:()=>now,maxAge:100});
 store.save('a','','new',draft);
 assert.deepEqual(createFormDraftStore(storage,{now:()=>now,maxAge:100}).load('a','','new'),draft);
 assert.equal(store.load('b','','new'),null);assert.equal(store.load('a','other','info'),null);
 store.remove('a','','new');assert.equal(store.load('a','','new'),null);
 store.save('a','order','info',draft);now=111;assert.equal(store.load('a','order','info'),null);
});
test('photo preparation memoizes successful results and retries failures',async()=>{
 const {memoizeByObject,mapLimited}=await import('../client-reliability.mjs');
 let calls=0;const image={},fn=memoizeByObject(async()=>{calls++;if(calls===1)throw Error('decode');return 'compressed';});
 await assert.rejects(fn(image),/decode/);assert.equal(await fn(image),'compressed');assert.equal(await fn(image),'compressed');assert.equal(calls,2);
 let active=0,peak=0;const output=await mapLimited([1,2,3,4],2,async n=>{active++;peak=Math.max(active,peak);await Promise.resolve();active--;return n*2;});
 assert.deepEqual(output,[2,4,6,8]);assert.equal(peak,2);
});
test('diagnostic distinguishes Firebase acceptance from actual receipt',async()=>{
 const {pushDiagnosticText}=await import('../client-reliability.mjs');
 assert.match(pushDiagnosticText({status:'sent',acceptedCount:2}),/Firebase принял отправку/);
 assert.match(pushDiagnosticText({status:'retrying',acceptedCount:1,failedCount:1,platformDelivery:{android:{accepted:0,selected:1}}}),/Android: 0\/1/);
});
test('push diagnostic only exposes own explicit test and never returns tokens',async()=>{
 const vm=require('node:vm'),{readFileSync}=require('node:fs');
 const source=readFileSync(require('node:path').join(__dirname,'index.js'),'utf8');
 const begin=source.indexOf('exports.getWarehousePushDiagnostic='),end=source.indexOf('async function forwardAddressedMessage(',begin);
 assert.ok(begin>=0&&end>begin);
 const exports={};let item={authorId:'a',recipientUserId:'a',forceAll:true,deliveryStatus:'sent',sentAt:1,acceptedCount:2,acceptedDeviceHashes:['private-hash'],body:'private body',platformDelivery:{android:{selected:1,accepted:1,failed:0}}};
 const context={exports,onCall:fn=>fn,HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},db:{collection:name=>({doc:id=>({get:async()=>({exists:true,data:()=>name==='users'?{active:true}:item})})})}};
 vm.createContext(context);vm.runInContext(source.slice(begin,end),context);
 const call=exports.getWarehousePushDiagnostic;
 assert.equal((await call({auth:{uid:'a'},data:{}})).protocol,2);
 const result=await call({auth:{uid:'a'},data:{eventId:'test'}});assert.equal(result.acceptedCount,2);assert.equal(result.acceptedDeviceHashes,undefined);assert.equal(result.body,undefined);
 await assert.rejects(call({auth:{uid:'b'},data:{eventId:'test'}}),error=>error.code==='permission-denied');
 item={...item,forceAll:false};await assert.rejects(call({auth:{uid:'a'},data:{eventId:'test'}}),error=>error.code==='permission-denied');
});

const {isRoutine,nextDue,appendOrderPush,sealOrderPush,deliveryFor,dispatchOrderPush}=require('./order-push-batches');
const routine=(category='status',body='Статус: Собран',extra={})=>({target:'site',category,body,authorId:'a',orderId:'o',orderNumber:'42',title:'Клиент · № 42',...extra});
function batchDb(){
 const records=new Map(),clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
 const snapshot=ref=>({exists:records.has(ref.path),data:()=>clone(records.get(ref.path))});
 const ref=(collection,id)=>({id,path:collection+'/'+id,async create(data){if(records.has(this.path))throw Object.assign(Error('exists'),{code:6});records.set(this.path,clone(data));}});
 const db={collection:name=>({doc:id=>ref(name,id),where:()=>({get:async()=>({docs:[{id:'a',data:()=>({})},{id:'b',data:()=>({})},{id:'c',data:()=>({notificationSettings:{comments:false}})}]})})}),async runTransaction(fn){
  const operations=[];
  const result=await fn({get:async r=>snapshot(r),create:(r,data)=>operations.push(()=>{if(records.has(r.path))throw Error('duplicate');records.set(r.path,clone(data));}),set:(r,data)=>operations.push(()=>records.set(r.path,clone(data))),update:(r,data)=>operations.push(()=>records.set(r.path,{...records.get(r.path),...clone(data)}))});
  operations.forEach(op=>op());return result;
 }};
 return {db,records};
}
test('routine orders batch across categories; urgent and addressed messages bypass debounce',()=>{
 for(const category of ['orders','assembly','status','editing','comments'])assert.equal(isRoutine(routine(category)),true);
 for(const category of ['defects','questions','decisions','replies'])assert.equal(isRoutine(routine(category)),false);
 for(const extra of [{isUrgent:true},{isMention:true},{forceAll:true},{recipientUserId:'b'},{mentionRecipientIds:['b']},{target:'chat'},{isDeleted:true}])assert.equal(isRoutine(routine('comments','x',extra)),false);
 assert.equal(nextDue(1000,1000),6000);assert.equal(nextDue(1000,9000),11000);
});
test('durable window extends after new events, deduplicates retries and seals at ten seconds',async()=>{
 const {db,records}=batchDb();let now=1000;
 const add=(eventId,category,extra={})=>appendOrderPush({db,eventId,data:routine(category,'actual '+category,extra),eventAt:now,now:()=>now});
 const id=await add('first','orders');now=4000;assert.equal(await add('second','editing'),id);
 now=8000;assert.equal(await add('third','comments'),id);
 const key='orderPushBatches/'+id;
 assert.equal(records.get(key).dueAt,11000);
 assert.equal(await add('first','orders'),id);assert.equal(records.get(key).events.length,3);
 const other=await add('other','status',{authorId:'another'});assert.notEqual(other,id);
 const different=await add('different','status',{orderId:'different'});assert.notEqual(different,id);
 const ref=db.collection('orderPushBatches').doc(id);
 const waits=[];
 const sealed=await sealOrderPush({db,ref,now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;}});
 assert.deepEqual(waits,[3000]);assert.equal(sealed.events.length,3);assert.equal(sealed.sealedAt,11000);
 assert.notEqual(await add('late','status'),id);
});
test('one recipient gets one readable summary, with per-category settings and no self notifications',async()=>{
 const {db,records}=batchDb();let now=1000;
 const id=await appendOrderPush({db,eventId:'new',data:routine('orders','Новый заказ'),eventAt:now,now:()=>now});
 now+=1000;await appendOrderPush({db,eventId:'comment',data:routine('comments','Позвонить перед приездом',{excludedRecipientIds:[]}),eventAt:now,now:()=>now});
 now+=1000;await appendOrderPush({db,eventId:'status',data:routine(),eventAt:now,now:()=>now});
 const ref=db.collection('orderPushBatches').doc(id),enabled=(settings,category)=>settings[category]!==false;
 const options={db,ref,enabled,now:()=>now,sleep:async ms=>{now+=ms;},markDone:async()=>{}};
 await dispatchOrderPush(options);await dispatchOrderPush(options);
 const deliveries=[...records.entries()].filter(([key])=>key.startsWith('pushQueue/')).map(([,value])=>value);
 assert.equal(deliveries.length,2);assert.equal(deliveries.some(x=>x.recipientUserId==='a'),false);
 const b=deliveries.find(x=>x.recipientUserId==='b'),c=deliveries.find(x=>x.recipientUserId==='c');
 assert.equal(b.batchCount,3);assert.equal(b.title,'Клиент · № 42');assert.match(b.body,/^3 действия: Позвонить перед приездом/);assert.match(b.body,/Статус: Собран/);assert.equal(b.batchEvents.length,3);
 assert.equal(c.batchCount,2);assert.doesNotMatch(c.body,/Позвонить/);
 const batch=records.get(ref.path);batch.events[1].excludedRecipientIds=['b'];
 assert.doesNotMatch(deliveryFor(batch,'b',{},enabled).body,/Позвонить/);
});
test('notification copy contains actual comments, article differences and changed delivery fields',()=>{
 assert.equal(entryEvent({kind:'comment',authorId:'a',text:'Клиент заберёт в 15:00'}).body,'Клиент заберёт в 15:00');
 assert.equal(entryEvent({kind:'comment',authorId:'a',text:'Важно',important:true}).isUrgent,true);
 const base={status:'Создан',createdBy:'a',updatedBy:'a',number:'42',client:'Клиент',articles:[{article:'AAA',quantity:1}]};
 assert.match(orderEvent(base,{...base,articles:[{article:'AAA',quantity:2},{article:'BBB',quantity:1}]}).body,/AAA: 1 → 2.*BBB/);
 assert.match(orderEvent(base,{...base,mainComment:'Позвонить клиенту'}).body,/Комментарий: Позвонить клиенту/);
});
