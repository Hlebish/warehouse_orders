const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const helpers=require('./buyback-articles'),source=fs.readFileSync(require.resolve('./index'),'utf8');
const lifecycle=source.slice(source.indexOf('async function markBuybackItemsSold('),source.indexOf('exports.syncBuybackFromOrder ='));
const deadlines=source.slice(source.indexOf('async function checkOneBuybackDeadline('),source.indexOf('exports.checkBuybackDeadlines ='));
function harness(lot){
 const records=new Map([['buybackItems/lot',{...lot}]]),versions=new Map();let beforeCommit;
 const collection=path=>({path,doc:id=>({path:path+'/'+id,id,collection:name=>collection(path+'/'+id+'/'+name)}),where:(field,op,value)=>({path,field,op,value})});
 const snap=ref=>({id:ref.id,ref,exists:records.has(ref.path),data:()=>({...records.get(ref.path)}),get:key=>records.get(ref.path)?.[key]});
 const write=(ref,patch,merge)=>{const next=merge?{...records.get(ref.path)}:{};for(const[k,v]of Object.entries(patch))next[k]=v?.union?[...new Set([...(next[k]||[]),...v.union])]:v;records.set(ref.path,next);versions.set(ref.path,(versions.get(ref.path)||0)+1);};
 const context={...helpers,console,FieldValue:{delete:()=>null,serverTimestamp:()=> 'now',arrayUnion:(...union)=>({union})},buybackEventDocId:(p,e)=>p+'_'+e,logger:{info(){}},db:{collection,runTransaction:async callback=>{
  for(let attempt=0;attempt<5;attempt++){
   const reads=new Map(),writes=[];const result=await callback({get:async ref=>{
    if(ref.field||!ref.id){return {docs:[...records].filter(([path,value])=>path.startsWith(ref.path+'/')&&!path.slice(ref.path.length+1).includes('/')&&(!ref.field||(ref.op==='in'?ref.value.includes(value[ref.field]):value[ref.field]===ref.value))).map(([path])=>snap({path,id:path.split('/').at(-1)}))};}
    reads.set(ref.path,versions.get(ref.path)||0);return snap(ref);
   },set:(ref,patch)=>writes.push(()=>write(ref,patch,false)),update:(ref,patch)=>writes.push(()=>write(ref,patch,true)),delete:ref=>writes.push(()=>records.delete(ref.path))});
   if(beforeCommit){const run=beforeCommit;beforeCommit=null;run();}if([...reads].some(([key,version])=>(versions.get(key)||0)!==version))continue;writes.forEach(run=>run());return result;
  }throw Error('retry limit');
 }}};
 vm.createContext(context);vm.runInContext(lifecycle+'\n'+deadlines,context);
 return {records,context,ref:collection('buybackItems').doc('lot'),race(patch){beforeCommit=()=>write(collection('buybackItems').doc('lot'),patch,true);}};
}
const stocked=()=>({article:'A1',quantity:3,status:'stocked',receivedAt:'2026-10-01',stockedAt:'2026-11-12',stockedBy:'accountant',stockedByName:'Анна'});
test('accepted warehouse stock is sold by order and retains the acceptance record on a partial sale',async()=>{
 const h=harness(stocked());await h.context.markBuybackItemsSold({id:'o',number:'1',articles:[{article:'A1',quantity:1}]},'ship');
 const sold=[...h.records.values()].find(row=>row.status==='sold');assert.equal(sold.quantity,1);assert.equal(sold.stockedAt,'2026-11-12');assert.equal(h.records.get('buybackItems/lot').status,'stocked');assert.equal(h.records.get('buybackItems/lot').quantity,2);
});
test('a customer return and its cancellation preserve owned-stock status without restarting deadlines',async()=>{
 const h=harness({...stocked(),status:'sold',soldByOrderId:'o'});
 await h.context.restoreBuybackItemsForReturn({id:'o',number:'1'},{id:'r',createdAt:'2026-11-12',items:[{article:'A1',quantity:1}]},'return');
 assert.equal([...h.records.values()].find(row=>row.returnedFromReturnId==='r').status,'stocked');
 await h.context.reverseBuybackReturn('o','r','cancel');assert.equal(h.records.get('buybackItems/lot').quantity,3);assert.equal(h.records.get('buybackItems/lot').status,'sold');assert.equal([...h.records.values()].some(row=>row.status==='active'),false);
});
test('overdue stock becomes expired without emitting critical reminders',async()=>{
 const h=harness({article:'A1',quantity:1,status:'active',receivedAt:'2026-10-01',sentMilestones:[]});await h.context.checkOneBuybackDeadline(h.ref,Date.parse('2026-11-12T00:00:00Z'));assert.equal(h.records.get(h.ref.path).status,'expired');assert.equal([...h.records.keys()].some(path=>path.startsWith('pushQueue/')),false);
});
test('a concurrent warehouse acceptance cannot be overwritten by a scheduled deadline check',async()=>{
 const h=harness({article:'A1',quantity:1,status:'active',receivedAt:'2026-11-02',sentMilestones:[3,6]});h.race({status:'stocked',stockedAt:'2026-11-12'});await h.context.checkOneBuybackDeadline(h.ref,Date.parse('2026-11-12T00:00:00Z'));assert.equal(h.records.get(h.ref.path).status,'stocked');assert.equal([...h.records.keys()].some(path=>path.startsWith('pushQueue/')),false);
});
test('a critical active lot queues one reminder and a repeated check does not queue another event',async()=>{
 const h=harness({article:'A1',quantity:1,status:'active',receivedAt:'2026-11-02',sentMilestones:[3,6]});await h.context.checkOneBuybackDeadline(h.ref,Date.parse('2026-11-12T00:00:00Z'));await h.context.checkOneBuybackDeadline(h.ref,Date.parse('2026-11-12T00:00:00Z'));assert.equal([...h.records.keys()].filter(path=>path.startsWith('pushQueue/')).length,1);assert.deepEqual(h.records.get(h.ref.path).sentMilestones,[3,6,10]);
});
