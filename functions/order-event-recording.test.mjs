import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {orderEditSnapshot,assertOrderUnchanged} from '../editing-state.mjs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const between=(start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'Missing source boundary: '+start);
  return source.slice(a,b);
};
const clone=value=>JSON.parse(JSON.stringify(value));
const base=()=>({id:'order-1',number:'101',status:'Создан',entries:[],articles:[
  {article:'A',quantity:1,collected:true},{article:'B',quantity:2,collected:false}
]});

// Execute the actual browser handlers against an atomic document store. A retry
// discards all writes from its previous attempt, just as a Firestore transaction.
function harness(order=base(),options={}){
  const parent=clone(order);delete parent.entries;
  const store=new Map([['orders/'+order.id,parent]]),attempts=[],effects=[];
  let sequence=0,tick=0;
  for(const entry of order.entries||[])store.set(`orders/${order.id}/entries/${entry.id}`,clone(entry));
  const context={
    state:{role:'warehouse',orders:[clone(order)]},selectedId:order.id,
    signedInUser:{uid:'warehouse-worker'},canManageUsers:false,profileName:'Анна',roles:{warehouse:'Кладовщик'},
    db:{},auth:{currentUser:{uid:'warehouse-worker'}},serverCache:new Map(),pendingOrderData:new Map(),
    modal:{hidden:false,dataset:{orderDetail:order.id}},console:{error(){},warn(){}},
    crypto:{randomUUID:()=>`event-${++sequence}`},doc:(_db,...parts)=>parts.join('/'),
    isoNow:()=>new Date(Date.UTC(2026,10,17,12,0,tick++)).toISOString(),
    isShipmentLocked:value=>['Отгружен кладовщиком','Клиент забрал самовывозом'].includes(value.status),
    render:()=>effects.push(['render']),openOrder:()=>effects.push(['open']),saveOrdersCache:()=>effects.push(['cache']),
    toast:message=>effects.push(['toast',message]),writeAudit:async(...args)=>effects.push(['audit',...args]),
    queuePush:async(...args)=>effects.push(['push',...args])
  };
  context.runTransaction=async(_db,callback)=>{
    for(let attempt=0;;attempt++){
      const operations=[];
      const result=await callback({
        get:async ref=>{
          assert.equal(operations.length,0,'Transaction must read before writing');
          const data=store.get(ref);
          return {exists:()=>!!data,data:()=>clone(data)};
        },
        update:(ref,value)=>operations.push({method:'update',ref,value:clone(value)}),
        set:(ref,value)=>operations.push({method:'set',ref,value:clone(value)})
      });
      attempts.push(operations);
      if(options.retryOnce&&attempt===0){
        Object.assign(store.get('orders/'+order.id),clone(options.retryOnce));
        continue;
      }
      if(options.rejectEntryWrite&&operations.some(op=>op.ref.includes('/entries/'))){
        throw Object.assign(new Error('Entry permission denied'),{code:'permission-denied'});
      }
      for(const operation of operations){
        store.set(operation.ref,operation.method==='update'?{...store.get(operation.ref),...operation.value}:operation.value);
      }
      return result;
    }
  };
  vm.createContext(context);
  vm.runInContext(between('function entryToCloud(', 'function entryFromCloud('),context);
  vm.runInContext(between('function normalizeArticles(', 'function parseOrderClipboardText('),context);
  vm.runInContext(between('function isArticleRemovedByDefect(', 'async function saveArticles('),context);
  return {
    context,store,attempts,effects,
    remote:()=>store.get('orders/'+order.id),
    entries:()=>[...store.entries()].filter(([key])=>key.startsWith(`orders/${order.id}/entries/`)).map(([,entry])=>entry)
  };
}

test('last collected position commits its action and assembled milestone with the order',async()=>{
  const h=harness();await h.context.toggleArticleCollected(1);
  assert.equal(h.remote().status,'Собран');
  assert.equal(h.remote().articles[1].collected,true);
  assert.equal(h.attempts.length,1);
  assert.deepEqual(h.attempts[0].map(op=>op.method),['update','set','set']);
  const events=h.entries();assert.equal(events.length,2);
  assert.equal(events[0].article,'B');assert.equal(events[0].articleIndex,1);
  assert.match(events[0].text,/Артикул B: собран/);
  assert.match(events[1].text,/^Заказ собран\./);
  for(const event of events){
    assert.equal(event.kind,'system');assert.equal(event.authorId,'warehouse-worker');
    assert.equal(event.authorName,'Анна');assert.equal(event.createdAt,h.remote().assembledAt);
  }
  assert.equal(h.context.state.orders[0].entries.length,2);
  assert.equal(h.context.serverCache.get('order-1').entries.length,2);
});

test('transaction retry preserves another worker collection and uses stable event ids',async()=>{
  const order=base();order.articles[0].collected=false;
  const h=harness(order,{retryOnce:{articles:[{article:'A',quantity:1,collected:true},{article:'B',quantity:2,collected:false}]}});
  await h.context.toggleArticleCollected(1);
  assert.equal(h.attempts.length,2);
  assert.equal(h.remote().status,'Собран');assert.equal(h.remote().articles[0].collected,true);
  const firstId=h.attempts[0].find(op=>op.method==='set').ref;
  assert.equal(h.attempts[1].find(op=>op.method==='set').ref,firstId);
  assert.equal(h.entries().length,2);assert.equal(h.context.state.orders[0].entries.length,2);
  assert.equal(h.effects.filter(effect=>effect[0]==='push').length,1);
});

test('uncollecting and assembling again retain both milestone cycles',async()=>{
  const order=base();order.status='Собран';order.assembledAt='2026-11-16T10:00:00Z';
  order.articles[1].collected=true;
  order.entries=[{id:'old-assembly',kind:'system',text:'Заказ собран.',createdAt:order.assembledAt,authorId:'previous-worker',author:'Олег'}];
  const h=harness(order);await h.context.toggleArticleCollected(1);
  assert.equal(h.remote().status,'Создан');assert.equal(h.remote().assembledAt,'');
  await h.context.toggleArticleCollected(1);
  assert.equal(h.remote().status,'Собран');assert.equal(h.entries().length,5);
  assert.equal(h.entries().filter(event=>/^Заказ собран\./.test(event.text)).length,2);
  assert.equal(h.entries().filter(event=>/^Заказ возвращён в сборку\./.test(event.text)).length,1);
  assert.equal(h.entries()[0].authorId,'previous-worker');
});

test('denied history write rolls back collection and leaves local state untouched',async()=>{
  const order=base(),h=harness(order,{rejectEntryWrite:true});
  await h.context.toggleArticleCollected(1);
  assert.equal(h.remote().status,'Создан');assert.equal(h.remote().articles[1].collected,false);
  assert.deepEqual(clone(h.context.state.orders[0]),order);assert.equal(h.entries().length,0);
  assert.equal(h.effects.some(effect=>['audit','push','cache'].includes(effect[0])),false);
});

test('a transaction retry finding the desired collection already saved adds no duplicate event',async()=>{
  const h=harness(base(),{retryOnce:{status:'Собран',articles:[{article:'A',quantity:1,collected:true},{article:'B',quantity:2,collected:true}]}});
  await h.context.toggleArticleCollected(1);
  assert.equal(h.attempts.length,2);assert.equal(h.attempts[1].length,0);
  assert.equal(h.entries().length,0);assert.equal(h.effects.some(effect=>effect[0]==='audit'),false);
});

test('each start, finish and restart gets an actor and time without claiming assembled status',async()=>{
  const h=harness();
  await h.context.toggleAssemblyProgress();await h.context.toggleAssemblyProgress();await h.context.toggleAssemblyProgress();
  const events=h.entries();assert.equal(events.length,3);
  assert.deepEqual(events.map(event=>event.text),['Начата сборка заказа.','Сборка заказа завершена.','Начата сборка заказа.']);
  assert.equal(new Set(events.map(event=>event.createdAt)).size,3);
  assert.equal(h.remote().status,'Создан');assert.equal(h.remote().assemblyInProgress,true);
  assert.equal(h.remote().assemblyStartedAt,events[0].createdAt);
  assert.equal(h.context.state.orders[0].entries.length,3);
  for(const event of events){assert.equal(event.authorId,'warehouse-worker');assert.equal(event.authorName,'Анна');}
});

test('assembly progress retries commit only one event with one stable id',async()=>{
  const h=harness(base(),{retryOnce:{client:'Updated by another worker'}});
  await h.context.toggleAssemblyProgress();
  assert.equal(h.attempts.length,2);assert.equal(h.entries().length,1);
  assert.equal(h.attempts[0][1].ref,h.attempts[1][1].ref);
  assert.equal(h.remote().client,'Updated by another worker');
  assert.equal(h.remote().assemblyStartedAt,h.entries()[0].createdAt);
});

test('denied assembly event leaves both remote and local progress unchanged',async()=>{
  const order=base(),h=harness(order,{rejectEntryWrite:true});
  await h.context.toggleAssemblyProgress();
  assert.equal(h.remote().assemblyInProgress,undefined);assert.equal(h.entries().length,0);
  assert.deepEqual(clone(h.context.state.orders[0]),order);
  assert.equal(h.effects.some(effect=>['audit','push','cache','open'].includes(effect[0])),false);
});

test('assembly progress rechecks shipment on the server before writing',async()=>{
  const h=harness();h.remote().status='Клиент забрал самовывозом';
  await h.context.toggleAssemblyProgress();
  assert.equal(h.remote().assemblyInProgress,undefined);assert.equal(h.entries().length,0);
  assert.equal(h.effects.some(effect=>effect[0]==='audit'),false);
});

test('concurrent local toggles share a guard until the transaction commits',async()=>{
  const h=harness();let release;
  const original=h.context.runTransaction;
  h.context.runTransaction=async(...args)=>{await new Promise(resolve=>{release=resolve;});return original(...args);};
  const first=h.context.toggleAssemblyProgress();
  await h.context.toggleAssemblyProgress();await h.context.toggleArticleCollected(1);
  assert.equal(h.entries().length,0);assert.equal(h.context.state.orders[0].assemblyInProgress,undefined);
  release();await first;
  assert.equal(h.entries().length,1);assert.equal(h.attempts.length,1);
});

function prepareClientLink(h){
  const c=h.context;
  c.clients=[{id:'client-1',name:'Клиент'}];c.clientLinksInFlight=new Set();
  c.$=()=>null;c.modal.querySelectorAll=()=>[];
  c.canEditOrder=value=>!c.isShipmentLocked(value);c.openClientCardByName=async()=>{};
  h.store.set('clients/client-1',{name:'Клиент'});
  vm.runInContext(between('function applyCommittedOrder(', 'async function commitOrderEdit('),c);
  vm.runInContext(between('async function chooseOrderClientRecord(', 'async function openClientsDirectory('),c);
}

test('client link selection commits the factual actor entry with its chosen client',async()=>{
  const h=harness(base(),{retryOnce:{updatedAt:'other-worker-update'}});prepareClientLink(h);
  await h.context.chooseOrderClientRecord('client-1','order-1');
  assert.equal(h.remote().clientId,'client-1');assert.equal(h.entries().length,1);
  assert.match(h.entries()[0].text,/Выбрана карточка клиента: Клиент/);
  assert.equal(h.entries()[0].authorId,'warehouse-worker');
  assert.equal(h.entries()[0].createdAt,h.remote().updatedAt);
  assert.equal(h.attempts[0][1].ref,h.attempts[1][1].ref);
  assert.equal(h.context.state.orders[0].clientId,'client-1');
  assert.equal(h.context.state.orders[0].entries.length,1);
  assert.deepEqual(h.effects.find(effect=>effect[0]==='audit').slice(1),['Выбрана карточка клиента','Клиент','order-1']);
});

test('client selection cannot commit when its history entry is denied',async()=>{
  const order=base(),h=harness(order,{rejectEntryWrite:true});prepareClientLink(h);
  await h.context.chooseOrderClientRecord('client-1','order-1');
  assert.equal(h.remote().clientId,undefined);assert.equal(h.entries().length,0);
  assert.deepEqual(clone(h.context.state.orders[0]),order);
  assert.equal(h.effects.some(effect=>effect[0]==='audit'),false);
});

function prepareDefectEdit(h){
  const c=h.context,order=c.state.orders[0],entry=order.entries[0];
  c.canEditOrder=value=>!c.isShipmentLocked(value);c.assertOrderUnchanged=assertOrderUnchanged;
  c.modal.dataset.editDefectId=entry.id;c.modal.dataset.orderBaseline=JSON.stringify(orderEditSnapshot(order));
  c.modal.dataset.defectEditBaseline=JSON.stringify({article:entry.article,articleIndex:entry.articleIndex,text:entry.text,photos:entry.photos||[],decision:entry.decision||''});
  c.$=id=>({editDefectArticleIndex:{value:'1'},editDefectText:{value:'Уточнённое описание'},editDefectPhotos:{files:[]}})[id];
  c.filesForInput=()=>[];c.uploadPhotos=async()=>[];c.readPhotos=async()=>[];
  c.startModalSave=()=>({success:()=>h.effects.push(['success']),fail:()=>h.effects.push(['fail']),finish(){},isCurrent:()=>false});
  vm.runInContext(between('function applyCommittedOrder(', 'async function commitOrderEdit('),c);
  vm.runInContext(between('async function saveDefectEdit(', 'async function saveOrder('),c);
}
const orderWithDefect=()=>({...base(),entries:[{id:'defect-1',kind:'defect',article:'A',articleIndex:0,text:'Первое описание',photos:[],authorId:'original-worker',author:'Олег',createdAt:'2026-11-16T10:00:00Z'}]});

test('defect edit preserves its original author and adds a separate editing event atomically',async()=>{
  const h=harness(orderWithDefect());prepareDefectEdit(h);await h.context.saveDefectEdit();
  const defect=h.store.get('orders/order-1/entries/defect-1');
  assert.equal(defect.text,'Уточнённое описание');assert.equal(defect.article,'B');
  assert.equal(defect.authorId,'original-worker');assert.equal(h.entries().length,2);
  const event=h.entries().find(entry=>entry.kind==='system');
  assert.match(event.text,/Описание дефекта изменено.*B.*Уточнённое описание/);
  assert.equal(event.authorId,'warehouse-worker');assert.equal(event.authorName,'Анна');
  assert.deepEqual(h.attempts[0].map(op=>op.method),['update','set']);
  assert.equal(h.context.state.orders[0].entries.length,2);
  assert.equal(h.context.state.orders[0].entries[0].text,'Уточнённое описание');
});

test('failed editing event rolls back the defect update and retains the original local history',async()=>{
  const order=orderWithDefect(),h=harness(order,{rejectEntryWrite:true});prepareDefectEdit(h);
  await h.context.saveDefectEdit();
  assert.equal(h.store.get('orders/order-1/entries/defect-1').text,'Первое описание');
  assert.equal(h.entries().length,1);assert.deepEqual(clone(h.context.state.orders[0]),order);
  assert.equal(h.effects.some(effect=>['audit','success'].includes(effect[0])),false);
});

function prepareHistoryDeletion(h,failCommit=false){
  const c=h.context;c.state.role='director';
  c.serverCache.set('order-1',clone(c.state.orders[0]));
  c.writeBatch=()=>{
    const operations=[];
    return {
      delete:ref=>operations.push({method:'delete',ref}),
      set:(ref,value)=>operations.push({method:'set',ref,value:clone(value)}),
      commit:async()=>{
        h.attempts.push(operations);
        if(failCommit)throw new Error('offline');
        for(const operation of operations){
          if(operation.method==='delete')h.store.delete(operation.ref);
          else h.store.set(operation.ref,operation.value);
        }
      }
    };
  };
  vm.runInContext(between('function applyCommittedOrder(', 'async function commitOrderEdit('),c);
  vm.runInContext(between('async function confirmDeleteEntry(', 'async function confirmDelete(){'),c);
}
const orderWithComment=()=>({...base(),entries:[{id:'comment-1',kind:'comment',text:'Удаляемое содержимое',authorId:'original-worker',author:'Олег',createdAt:'2026-11-16T10:00:00Z'}]});

test('history deletion atomically removes content and leaves a factual actor event',async()=>{
  const h=harness(orderWithComment());prepareHistoryDeletion(h);await h.context.confirmDeleteEntry('comment-1');
  assert.equal(h.store.has('orders/order-1/entries/comment-1'),false);
  assert.equal(h.entries().length,1);assert.deepEqual(h.attempts[0].map(op=>op.method),['delete','set']);
  const event=h.entries()[0];assert.equal(event.kind,'system');assert.match(event.text,/Удалена запись заказа: комментарий/);
  assert.doesNotMatch(event.text,/Удаляемое содержимое/);assert.equal(event.authorId,'warehouse-worker');
  assert.equal(h.context.state.orders[0].entries.length,1);
  assert.equal(h.context.state.orders[0].entries[0].id,'event-1');
  assert.equal(h.context.serverCache.get('order-1').entries[0].id,'event-1');
});

test('failed deletion batch preserves the original content and adds no removal event',async()=>{
  const order=orderWithComment(),h=harness(order);prepareHistoryDeletion(h,true);
  await h.context.confirmDeleteEntry('comment-1');
  assert.equal(h.entries().length,1);assert.equal(h.entries()[0].text,'Удаляемое содержимое');
  assert.deepEqual(clone(h.context.state.orders[0]),order);
  assert.deepEqual(clone(h.context.serverCache.get('order-1')),order);
  assert.equal(h.effects.some(effect=>effect[0]==='audit'),false);
});
