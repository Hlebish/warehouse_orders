import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { canTransitionOrderStatus, statusAfterDefectDecision } from '../order-workflow.mjs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,'Missing source boundary: '+start);return source.slice(a,b);};
const clone=value=>JSON.parse(JSON.stringify(value));
function harness(order,overrides={}){
 const data=clone(order),events=[];
 const context={
   state:{role:'warehouse',orders:[clone(order)]},selectedId:order.id,signedInUser:{uid:'worker'},canManageUsers:false,
   profileName:'Сотрудник',roles:{warehouse:'Кладовщик'},db:{},serverCache:new Map(),pendingWrites:new Set(),pendingOrderData:new Map(),
   console:{error(){},warn(){}},crypto:{randomUUID:()=> 'entry-id'},modal:{hidden:false,dataset:{orderDetail:order.id}},
   isoNow:()=> '2026-11-12T12:00:00Z',doc:(_db,...parts)=>parts.join('/'),
   isShipmentLocked:o=>['Отгружен кладовщиком','Клиент забрал самовывозом'].includes(o.status),
   render(){},saveOrdersCache(){},openOrder(){},notify:(...args)=>events.push(['notify',...args]),
   toast:message=>events.push(['toast',message]),queuePush:async(...args)=>events.push(['push',...args]),
   writeAudit:async(...args)=>events.push(['audit',...args]),$:()=>null,
   entryToCloud:entry=>({...entry}),canTransitionOrderStatus,statusAfterDefectDecision,
   ...overrides
 };
 context.runTransaction=async(_db,callback)=>{
   const operations=[];
   const result=await callback({get:async()=>({exists:()=>true,data:()=>clone(data)}),
     update:(_ref,patch)=>operations.push(patch),set:(_ref,patch)=>operations.push(patch)});
   if(context.retryWith){Object.assign(data,context.retryWith);context.retryWith=null;return context.runTransaction(_db,callback);}
   for(const patch of operations)Object.assign(data,clone(patch));
   return result;
 };
 if(overrides.runTransaction)context.runTransaction=overrides.runTransaction;
 vm.createContext(context);
 vm.runInContext(between('function normalizeArticles(', 'function parseOrderClipboardText('),context);
 vm.runInContext(between('function isArticleRemovedByDefect(', 'async function toggleAssemblyProgress('),context);
 return {context,data,events};
}
const base=()=>({id:'o',number:'1',status:'Создан',entries:[],articles:[{article:'A',quantity:1,collected:true},{article:'B',quantity:1,collected:false}]});
test('checking the last position still automatically changes Created to Assembled',async()=>{
 const {context,data,events}=harness(base());await context.toggleArticleCollected(1);
 assert.equal(data.status,'Собран');assert.equal(data.assemblyInProgress,false);
 assert.equal(events.filter(event=>event[0]==='push').length,1);
});
test('partial collection does not mark the order assembled',async()=>{
 const order=base();order.articles[0].collected=false;
 const {context,data}=harness(order);await context.toggleArticleCollected(1);assert.equal(data.status,'Создан');
});
test('warehouse can keep collecting while a defect awaits a manager decision',async()=>{
 const order=base();order.status='Дефект';order.entries=[{kind:'defect',articleIndex:0}];
 const {context,data}=harness(order);await context.toggleArticleCollected(1);
 assert.equal(data.articles[1].collected,true);assert.equal(data.status,'Дефект');
});
test('collection never overwrites approvals, cancellations or other business statuses',async()=>{
 for(const status of ['Одобрен на отгрузку клиенту','Ожидает оплаты','Отменён']){
   const order=base();order.status=status;
   const {context,data}=harness(order);await context.toggleArticleCollected(1);assert.equal(data.status,status);
 }
});
test('a retry preserves a second worker collection mark',async()=>{
 const order=base();order.articles[0].collected=false;
 const {context,data}=harness(order);context.retryWith={articles:[{article:'A',quantity:1,collected:true},{article:'B',quantity:1,collected:false}]};
 await context.toggleArticleCollected(1);
 assert.equal(data.status,'Собран');assert.equal(data.articles[0].collected,true);assert.equal(data.articles[1].collected,true);
});
test('failed collection writes leave local data unchanged',async()=>{
 const order=base();const {context,events}=harness(order,{runTransaction:async()=>{throw Error('offline');}});
 await context.toggleArticleCollected(1);assert.deepEqual(clone(context.state.orders[0]),order);
 assert.equal(events.some(event=>event[0]==='push'),false);
});
test('shipment checklist retries preserve other workers marks and confirmation fields',async()=>{
 const order=base(),{context,data}=harness(order);Object.assign(data,{checkedOrderArticles:[],confirmed:true});
 vm.runInContext(between('async function toggleShipmentItemChecked(', 'let shipmentSearchDebounce='),context);
 context.openShipmentManifest=()=>{};context.retryWith={checkedOrderArticles:['other::A']};
 await context.toggleShipmentItemChecked('2026-11-12','o','B');
 assert.deepEqual(data.checkedOrderArticles,['other::A','o::B']);assert.equal(data.confirmed,true);
});
test('a failed view receipt does not claim success or alter local history',async()=>{
 const {context,events}=harness(base(),{setDoc:async()=>{throw Error('permission-denied');}});
 vm.runInContext(between('const viewedWritesInFlight=', 'const defectDecisionFields='),context);
 await context.markViewed();assert.equal(context.state.orders[0].entries.length,0);
 assert.equal(events.some(event=>event[0]==='notify'),false);
});
test('a failed history deletion preserves the entry and does not write audit success',async()=>{
 const order=base();order.entries=[{id:'c',kind:'comment',text:'Keep me'}];
 const {context,events}=harness(order,{deleteDoc:async()=>{throw Error('offline');}});context.state.role='director';
 vm.runInContext(between('async function confirmDeleteEntry(', 'async function confirmDelete(){'),context);
 await context.confirmDeleteEntry('c');assert.equal(context.state.orders[0].entries.length,1);
 assert.equal(events.some(event=>event[0]==='audit'),false);
});

test('manager confirmation and removal use readiness rather than blindly resetting Created',async()=>{
 for(const decision of ['Подтверждён','Удалена из заказа']){
   const order=base();order.status='Дефект';order.entries=[{id:'defect',kind:'defect',article:'B',articleIndex:1}];
   const {context}=harness(order);context.state.role='manager';context.isManagerRole=()=>true;
   context.$=()=>({value:''});context.pendingDefectId='defect';
   vm.runInContext(between('const defectDecisionFields=', 'function deleteOrder(){'),context);
   context.persistDefectDecision=async()=>true;
   if(decision==='Подтверждён')await context.decideDefect('defect',decision);
   else await context.confirmDefectRemove();
   assert.equal(context.state.orders[0].status,'Одобрен на отгрузку клиенту');
   assert.equal(context.state.orders[0].entries[0].decision,decision);
 }
});

test('failed defect decisions restore the old status and remain undecided',async()=>{
 const order=base();order.status='Дефект';order.entries=[{id:'defect',kind:'defect',article:'B',articleIndex:1}];
 const {context}=harness(order);context.state.role='manager';context.isManagerRole=()=>true;
 context.writeBatch=()=>({update(){},commit:async()=>{throw Error('offline');}});
 vm.runInContext(between('const defectDecisionFields=', 'function deleteOrder(){'),context);
 await context.decideDefect('defect','Подтверждён');
 assert.equal(context.state.orders[0].status,'Дефект');
 assert.equal(context.state.orders[0].entries[0].decision,undefined);
});

test('multiple defects persist independent position IDs, descriptions and photos',async()=>{
 const order=base();order.entries=[{id:'older',kind:'comment',text:'Keep history'}];
 const {context}=harness(order);let saved=[];
 const drafts=[0,1].map(index=>({dataset:{entryId:'defect-'+index,createdAt:'2026-11-12T12:00:00Z'},querySelector:selector=>({
   '[data-defect-position]':{value:String(index)},'[data-defect-text]':{value:'Damage '+index},'[data-defect-photos]':{files:['photo-'+index]}
 })[selector]}));
 context.document={querySelectorAll:()=>drafts};
 context.modal.querySelector=()=>({});context.modal.querySelectorAll=()=>[];
 context.canEditOrder=()=>true;context.readPhotos=async files=>files;
 context.uploadPhotos=async(_order,id,files)=>files.map(file=>id+'/'+file);
 context.runTransaction=async(_db,callback)=>callback({get:async()=>({exists:()=>true,data:()=>order}),update(){},set:(_ref,value)=>saved.push(value)});
 vm.runInContext('let entrySending=false;'+between('function defectDraftHtml(', 'function editDefect('),context);
 await context.saveDefectEntries();
 assert.equal(saved.length,2);assert.notEqual(saved[0].id,saved[1].id);
 assert.equal(saved[0].text,'Damage 0');assert.equal(saved[1].text,'Damage 1');
 assert.deepEqual(clone(saved.map(entry=>entry.photos)),[['defect-0/photo-0'],['defect-1/photo-1']]);
 assert.deepEqual(clone(saved.map(entry=>entry.articleIndex)),[0,1]);
 assert.equal(context.state.orders[0].entries.length,3);
});

test('manager gets a clear explanation instead of attempting to decide a shipped defect',async()=>{
 const order=base();order.status='Отгружен кладовщиком';order.entries=[{id:'defect',kind:'defect',article:'B',articleIndex:1}];
 const {context,events}=harness(order);context.state.role='manager';context.isManagerRole=()=>true;
 vm.runInContext(between('const defectDecisionFields=', 'function deleteOrder(){'),context);
 let attempted=false;context.persistDefectDecision=async()=>{attempted=true;return true;};
 await context.decideDefect('defect','Подтверждён');
 assert.equal(attempted,false);assert.equal(context.state.orders[0].entries[0].decision,undefined);
 assert.ok(events.some(event=>event[0]==='toast'&&event[1].includes('уже отгружен')));
});
