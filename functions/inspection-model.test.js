const test=require('node:test'),assert=require('node:assert/strict');
const {inspectionMatches,articleKey,clientKey}=require('./inspection-model');
const item=(id,article='APMA2506',patch={})=>({id,article,articleKey:articleKey(article),client:'',clientId:'',clientKey:'',status:'checked',createdAt:'2026-11-18T10:00:00Z',...patch});
const order=(patch={})=>({status:'Создан',client:'Иван Петренко',articles:[{article:'APMA2506 Бампер передний',quantity:1}],...patch});
test('full SKU prefixes with imported descriptions match; longer suffixes stay distinct',()=>{
 assert.deepEqual(inspectionMatches(order(),[item('a'),item('b','APMA25060'),item('c','APMA2506A')]).map(x=>x.id),['a']);
 assert.equal(inspectionMatches(order({articles:[{article:'ОПТ TZ 1.12.020.20.0 Накладка',quantity:1}]}),[item('spaced','ОПТ TZ 1.12.020.20.0')]).length,1);
});
test('the intended customer wins over unassigned stock; another customer is not removed',()=>{
 const clients=[item('other','APMA2506',{clientKey:clientKey('Мария')}),item('generic'),item('same','APMA2506',{clientKey:clientKey('ИВАН   Петренко')})];
 assert.deepEqual(inspectionMatches(order(),clients).map(x=>x.id),['same']);
 assert.deepEqual(inspectionMatches(order(),clients.slice(0,2)).map(x=>x.id),['generic']);
 assert.equal(inspectionMatches(order(),clients.slice(0,1)).length,0);
});
test('stable customer IDs can match a renamed client',()=>{
 assert.equal(inspectionMatches(order({clientId:'client-1'}),[item('a','APMA2506',{client:'Старое имя',clientKey:'old',clientId:'client-1'})]).length,1);
 assert.equal(inspectionMatches(order({clientId:'client-1'}),[item('a','APMA2506',{clientKey:clientKey('Иван Петренко'),clientId:'client-2'})]).length,0);
});
test('verified items are used first and quantities limit how many requests disappear',()=>{
 const items=[item('pending','APMA2506',{status:'pending'}),item('checked')];
 assert.deepEqual(inspectionMatches(order(),items).map(x=>x.id),['checked']);assert.equal(inspectionMatches(order({articles:[{article:'APMA2506',quantity:2}]}),items).length,2);
});
test('a delayed event never consumes requests created after the order',()=>{
 assert.equal(inspectionMatches(order(),[item('a')],Date.parse('2026-11-18T09:00:00Z')).length,0);
});
test('unrelated edits and quantity reductions do not consume fresh checks',()=>{
 assert.equal(inspectionMatches(order(),[item('a')],Infinity,order()).length,0);
 assert.equal(inspectionMatches(order(),[item('a')],Infinity,order({articles:[{article:'APMA2506',quantity:2}]})).length,0);
 assert.equal(inspectionMatches(order({articles:[{article:'APMA2506',quantity:2}]}),[item('a')],Infinity,order()).length,1);
});
test('chunk retries subtract quantities already matched and honour the current order',()=>{
 const many=Array.from({length:60},(_,i)=>item(String(i))),data=order({articles:[{article:'APMA2506',quantity:25}]});
 assert.equal(inspectionMatches(data,many,Infinity,null,{APMA2506:20}).length,5);
 assert.equal(inspectionMatches(data,many,Infinity,null,{},new Map([['APMA2506',1]])).length,1);
});
test('cancelled requests and orders do not consume checks',()=>{
 assert.equal(inspectionMatches(order({status:'Отменён'}),[item('a')]).length,0);
 assert.equal(inspectionMatches(order(),[item('a','APMA2506',{status:'ordered'})]).length,0);
});

test('linking resolved inspection defects changes the parent version without changing its status',async()=>{
 const {createInspectionHandlers}=require('./inspection-items');
 const {orderEditSnapshot,assertOrderUnchanged}=await import('../editing-state.mjs');
 const initial=order({number:'101',updatedAt:'2099-01-01T00:00:00.000Z'}),baseline=orderEditSnapshot(initial);
 const checked=item('checked','APMA2506',{defects:[{id:'defect',text:'Царапина',photos:[],authorId:'warehouse',authorName:'Кладовщик',createdAt:'2026-11-18T10:00:00Z',decision:'Подтверждён',decidedAt:'2026-11-18T10:01:00Z',decidedBy:'manager',decidedByName:'Менеджер'}]});
 const data=new Map([['orders/o',initial],['inspectionItems/checked',checked]]),writes=[];
 const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});
 const snapshot=target=>({ref:target,exists:data.has(target.path),data:()=>data.get(target.path)});
 const db={collection:name=>({doc:id=>ref(name+'/'+id),where:()=>({active:true})}),runTransaction:async callback=>{
  const operations=[];
  const result=await callback({get:async target=>target.active?{docs:[...data].filter(([path,item])=>path.startsWith('inspectionItems/')&&['pending','checked'].includes(item.status)).map(([path])=>({id:path.split('/').at(-1),data:()=>data.get(path)}))}:snapshot(target),
   update:(target,patch)=>operations.push({target,patch,merge:true}),set:(target,patch)=>operations.push({target,patch})});
  for(const operation of operations){writes.push(operation);data.set(operation.target.path,operation.merge?{...data.get(operation.target.path),...operation.patch}:operation.patch);}
  return result;
 }};
 const handlers=createInspectionHandlers({db,FieldValue:{serverTimestamp:()=> 'server-time'},HttpsError:Error});
 await handlers.syncOrder({...snapshot(ref('orders/o')),createTime:{toMillis:()=>Date.parse('2026-11-19')}},'resolved-defect');
 const current=data.get('orders/o');
 assert.equal(current.status,initial.status);
 assert.equal(current.updatedBy,'system');
 assert.equal(current.updatedAt,'2099-01-01T00:00:00.001Z');
 assert.throws(()=>assertOrderUnchanged(baseline,current),{code:'order-conflict'});
 assert.equal(data.get('orders/o/entries/inspection_checked_defect').articleIndex,0);
 assert.equal(data.get('orders/o/entries/inspection_checked_defect').decision,'Подтверждён');
 const count=writes.length;await handlers.syncOrder({...snapshot(ref('orders/o')),createTime:{toMillis:()=>Date.parse('2026-11-19')}},'resolved-defect');
 assert.equal(writes.length,count,'A retried inspection event must not bump the version twice');
});
