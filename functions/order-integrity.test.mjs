import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {prepareArticleEdit, remapDefectIndex, availableReturnItems, appendOrderReturn, cancelOrderReturn} from '../order-integrity.mjs';
import {shipmentItemsForDate} from '../warehouse-operations.mjs';
import {orderEditSnapshot, assertOrderUnchanged} from '../editing-state.mjs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const between=(a,b)=>{
  const start=source.indexOf(a),end=source.indexOf(b,start);
  assert.ok(start>=0&&end>start,`Missing source boundary: ${a}`);
  return source.slice(start,end);
};
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const lines=()=>[{article:'A',quantity:1,collected:true},{article:'B',quantity:2,collected:true}];

test('removing a defective line keeps the surviving SKU in shipment and preserves its collection',()=>{
  const previous=lines(),edited=prepareArticleEdit(previous,[{...previous[1],sourceIndex:1}]);
  const defect={kind:'defect',article:'A',articleIndex:0,decision:'Удалена из заказа'};
  defect.articleIndex=remapDefectIndex(defect,previous,edited);
  assert.equal(defect.articleIndex,-1);
  assert.equal(edited[0].collected,true);
  const order={number:'42',status:'Отгружен кладовщиком',shippedAt:'2026-11-27',articles:edited,entries:[defect]};
  assert.deepEqual(shipmentItemsForDate([order],'2026-11-27','',x=>x,()=>'',x=>x).map(x=>[x.article,x.quantity]),[['B',2]]);
});

test('defects follow the original row when duplicate SKU rows are removed or replaced',()=>{
  const previous=[{article:'A',quantity:1},{article:'A',quantity:1},{article:'B',quantity:1}];
  const edited=prepareArticleEdit(previous,[{article:'A',quantity:1,sourceIndex:1},{article:'C',quantity:1,sourceIndex:2}]);
  assert.equal(remapDefectIndex({article:'A',articleIndex:0},previous,edited),-1);
  assert.equal(remapDefectIndex({article:'A',articleIndex:1},previous,edited),0);
  assert.equal(remapDefectIndex({article:'B',articleIndex:2},previous,edited),-1);
  assert.equal(remapDefectIndex({article:'A',articleIndex:-1},previous,edited),null);
  assert.equal(remapDefectIndex({article:'A'},previous,edited),null);
  assert.throws(()=>prepareArticleEdit(previous,[{article:'A',quantity:1,sourceIndex:1},{article:'A',quantity:1,sourceIndex:1}]));
});

test('article drafts retain row origins and keep an unresolved legacy-draft warning across saves',()=>{
  const row={dataset:{sourceIndex:'3'},querySelector:selector=>({value:selector==='.order-article-input'?'B':'2'})};
  const context={$:id=>id==='orderArticlesRows'?{querySelectorAll:()=>[row]}:null,modal:{dataset:{orderBaseline:'baseline'}}};
  vm.createContext(context);vm.runInContext(between('function readOrderFormDraft(', 'function persistOrderFormDraft('),context);
  const draft=context.readOrderFormDraft({ids:[],sourceConflict:true});
  assert.equal(draft.articles[0].sourceIndex,3);
  assert.equal(draft.sourceConflict,true);
});

function documentStore(initial){
  const records=new Map(Object.entries(clone(initial))),versions=new Map();
  let rejectedEntry=false;
  const runTransaction=async(_db,callback)=>{
    for(let attempt=0;attempt<6;attempt++){
      const reads=new Map(),writes=[];
      const result=await callback({
        get:async ref=>{
          assert.equal(writes.length,0,'Reads must precede transaction writes');
          reads.set(ref,versions.get(ref)||0);
          const data=clone(records.get(ref));
          return {ref,id:ref.split('/').at(-1),exists:()=>data!==undefined,data:()=>data};
        },
        update:(ref,value)=>writes.push({ref,value:clone(value),merge:true}),
        set:(ref,value)=>writes.push({ref,value:clone(value)})
      });
      if([...reads].some(([ref,version])=>(versions.get(ref)||0)!==version))continue;
      if(rejectedEntry&&writes.some(write=>write.ref.includes('/entries/')))throw Error('History write rejected');
      for(const write of writes){
        records.set(write.ref,write.merge?{...records.get(write.ref),...write.value}:write.value);
        versions.set(write.ref,(versions.get(write.ref)||0)+1);
      }
      return result;
    }
    throw Error('Too many transaction retries');
  };
  return {records,runTransaction,rejectEntries:()=>{rejectedEntry=true;}};
}

const baseOrder=()=>({id:'o',number:'42',status:'Собран',articles:[{article:'A',quantity:4}],returns:[],entries:[]});
function browser(store,order=baseOrder(),{id='return-1',quantity=1,admin=false}={}){
  const effects=[];
  const context={state:{role:'warehouse',orders:[clone(order)]},selectedId:order.id,signedInUser:{uid:id},canManageUsers:admin,
    profileName:id,roles:{warehouse:'Кладовщик'},db:{},modal:{hidden:false,dataset:{returnDraftId:id,returnDraftCreatedAt:'2026-11-27T10:00:00Z'}},
    crypto:{randomUUID:()=>id},isoNow:()=> '2026-11-27T11:00:00Z',serverCache:new Map(),console:{warn(){},error(){}},
    doc:(_db,...parts)=>parts.join('/'),collection:(_db,...parts)=>parts.join('/'),where:(...args)=>args,query:(ref)=>ref,
    getDocsFromServer:async ref=>({docs:[...store.records].filter(([path,data])=>path.startsWith(ref+'/')&&data.kind==='defect').map(([path])=>({ref:path}))}),
    runTransaction:store.runTransaction,entryToCloud:entry=>clone(entry),entryFromCloud:(id,data)=>({id,...data}),
    orderEditSnapshot,assertOrderUnchanged,remapDefectIndex,canEditOrder:()=>true,
    appendOrderReturn,cancelOrderReturn,availableReturnItems,
    document:{querySelectorAll:()=>[{value:String(quantity),dataset:{article:'A',max:'4'}}]},
    $:()=>({value:''}),confirm:()=>true,render(){},saveOrdersCache(){},closeModal(){},openOrder(){},showReturns(){},
    writeAudit:async()=>{},notify(){},toast:message=>effects.push(message),
    startModalSave:()=>({success(){},fail(error){effects.push(error.message);},finish(){},isCurrent:()=>false})};
  vm.createContext(context);
  vm.runInContext(between('function applyCommittedOrder(', 'async function commitOrderEdit('),context);
  vm.runInContext(between('async function commitArticleEdit(', 'let modalHistoryEntry='),context);
  vm.runInContext(between('const returnWritesInFlight=', 'const WAREHOUSE_MAP_LOOKUP_URL='),context);
  vm.runInContext(between('async function cancelReturnAction(', 'let transferredInsightsExpanded='),context);
  return {context,effects};
}

test('article edit commits defect references and order lines atomically without changing decisions',async()=>{
  const order={...baseOrder(),articles:lines(),entries:[{id:'defect',kind:'defect',article:'B',articleIndex:1,decision:'Удалена из заказа',text:'Damage'}]};
  const store=documentStore({'orders/o':order,'orders/o/entries/defect':order.entries[0]});
  const {context}=browser(store,order),edited=prepareArticleEdit(order.articles,[{...order.articles[1],sourceIndex:1}]);
  await context.commitArticleEdit(order,orderEditSnapshot(order),edited,{articles:edited.map(({sourceIndex,...line})=>line)}, {id:'history',kind:'system'});
  assert.equal(store.records.get('orders/o/entries/defect').articleIndex,0);
  assert.equal(store.records.get('orders/o/entries/defect').decision,'Удалена из заказа');
  assert.equal(store.records.get('orders/o/entries/defect').text,'Damage');
  assert.equal(context.state.orders[0].entries.find(entry=>entry.id==='defect').articleIndex,0);
  const failure=documentStore({'orders/o':order,'orders/o/entries/defect':order.entries[0]});failure.rejectEntries();
  await assert.rejects(browser(failure,order).context.commitArticleEdit(order,orderEditSnapshot(order),edited,{articles:[]},{id:'history'}));
  assert.deepEqual(failure.records.get('orders/o').articles,order.articles);
  assert.equal(failure.records.get('orders/o/entries/defect').articleIndex,1);
});

test('concurrent return handlers preserve both returns and create their histories atomically',async()=>{
  const store=documentStore({'orders/o':baseOrder()});
  const a=browser(store,baseOrder(),{id:'a',quantity:1}),b=browser(store,baseOrder(),{id:'b',quantity:2});
  await Promise.all([a.context.saveReturn(),b.context.saveReturn()]);
  assert.deepEqual(store.records.get('orders/o').returns.map(item=>item.id).sort(),['a','b']);
  assert.equal([...store.records.keys()].filter(path=>path.includes('/entries/')).length,2);
  assert.equal(availableReturnItems(store.records.get('orders/o'))[0].available,1);
});

test('double clicks and confirmation retries save one return; concurrent over-return is rejected',async()=>{
  const store=documentStore({'orders/o':baseOrder()}),a=browser(store);
  await Promise.all([a.context.saveReturn(),a.context.saveReturn()]);
  await a.context.saveReturn();
  assert.equal(store.records.get('orders/o').returns.length,1);
  assert.equal([...store.records.keys()].filter(path=>path.includes('/entries/')).length,1);
  const other=documentStore({'orders/o':baseOrder()});
  await Promise.all([browser(other,baseOrder(),{id:'a',quantity:3}).context.saveReturn(),browser(other,baseOrder(),{id:'b',quantity:3}).context.saveReturn()]);
  assert.equal(other.records.get('orders/o').returns.length,1);
  assert.equal(availableReturnItems(other.records.get('orders/o'))[0].available,1);
});

test('a rejected history write also rolls back its return and keeps the form retryable',async()=>{
  const store=documentStore({'orders/o':baseOrder()});store.rejectEntries();
  const a=browser(store);await a.context.saveReturn();
  assert.equal(store.records.get('orders/o').returns.length,0);
  assert.ok(a.effects.some(message=>message.includes('History write rejected')));
});

test('cancellation rereads the order and preserves a concurrently added return',async()=>{
  const order={...baseOrder(),status:'Возврат',returns:[{id:'original',items:[{article:'A',quantity:1}],previousStatus:'Собран'}]};
  const store=documentStore({'orders/o':order}),cancel=browser(store,order,{admin:true}),add=browser(store,order,{admin:true,id:'new'});
  await Promise.all([cancel.context.cancelReturnAction('o','original'),add.context.saveReturn()]);
  const saved=store.records.get('orders/o');
  assert.equal(saved.returns.length,2);
  assert.equal(saved.returns.find(record=>record.id==='original').status,'cancelled');
  assert.notEqual(saved.returns.find(record=>record.id==='new').status,'cancelled');
  assert.equal(saved.status,'Возврат');
});

test('duplicate SKUs share their remaining quantity and cancelling the last partial return restores the original status',()=>{
  const order={articles:[{article:'A',quantity:2},{article:'a',quantity:2}],status:'Возврат',returns:[
    {id:'first',items:[{article:'A',quantity:2}],previousStatus:'Собран',status:'cancelled'},
    {id:'last',items:[{article:'A',quantity:1}],previousStatus:'Возврат'}]};
  assert.deepEqual(availableReturnItems(order).map(item=>item.available),[3]);
  assert.equal(cancelOrderReturn(order,'last',{}).status,'Собран');
  assert.throws(()=>appendOrderReturn(order,{id:'too-many',items:[{article:'A',quantity:4}]}));
});

test('numeric and prefixed order searches use indexed lookups; text searches load history',async()=>{
  for(const text of ['12345','A-123','ЗК 42','Клиент']){
    let timer,fullReads=0,exactReads=0;
    const context={signedInUser:{uid:'u'},fullOrderHistoryRequested:false,db:{},clearTimeout(){},
      setTimeout:fn=>{timer=fn;return 1;},requestFullOrderHistory:()=>fullReads++,scheduleRender(){},
      query(){},collection(){},where(){},getDocsFromServer:async()=>{exactReads++;return {docs:[{id:'o',data:()=>({number:text})}]};}};
    vm.createContext(context);vm.runInContext(between('let archiveLookupTimer=', 'function renderOrdersUI()'),context);
    context.scheduleArchiveSearch(text);await timer();
    assert.equal(fullReads,text==='Клиент'?1:0,text);
    assert.equal(exactReads,text==='Клиент'?0:1,text);
  }
});
