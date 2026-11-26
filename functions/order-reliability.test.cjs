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
