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
