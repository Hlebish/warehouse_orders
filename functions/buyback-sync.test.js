const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createHash}=require('node:crypto');
const helpers=require('./buyback-articles');
const source=fs.readFileSync(require.resolve('./index'),'utf8');
const code=source.slice(source.indexOf('async function markBuybackItemsSold('),source.indexOf('async function restoreBuybackItemsForReturn('));
function setup(items){
 const records=new Map(items.map((item,i)=>['item'+i,{...item}])),markers=new Set();
 const collection=name=>({doc:id=>({id,collection}),where:(field,op,value)=>({field,op,value})});
 const context={...helpers,createHash,buybackEventDocId:(p,e)=>p+e,FieldValue:{delete:()=>null,serverTimestamp:()=> 'now'},logger:{info(){}},db:{collection,runTransaction:async callback=>{
 const writes=[];
 const result=await callback({get:async ref=>ref.field?{docs:[...records].filter(([,item])=>ref.op==='in'?ref.value.includes(item[ref.field]):item[ref.field]===ref.value).map(([id,item])=>({id,ref:{id},data:()=>({...item}),get:key=>item[key]}))}:{exists:markers.has(ref.id)},update:(ref,patch)=>writes.push(()=>records.set(ref.id,{...records.get(ref.id),...patch})),set:(ref,patch)=>writes.push(()=>patch.kind?markers.add(ref.id):records.set(ref.id,{...patch}))});
 writes.forEach(write=>write());return result;
 }}};
 vm.createContext(context);vm.runInContext(code,context);
 return {records,sell:(article,quantity=1,event='evt')=>context.markBuybackItemsSold({id:'order',number:'42',client:'Buyer',articles:[{article,quantity}]},event)};
}
test('imported order line sells linked stock and retry never sells it twice',async()=>{
 const {records,sell}=setup([{article:'APHD4307',quantity:1,status:'active',orderId:'order'}]);
 await sell('APHD4307 Капот Honda');assert.equal(records.get('item0').status,'sold');
 await sell('APHD4307 Капот Honda',1,'another-event');
 assert.equal([...records.values()].filter(item=>item.status==='sold').length,1);
});
test('partial shipment keeps unsold remainder in deadlines',async()=>{
 const {records,sell}=setup([{article:'APHD4307',quantity:3,status:'active'}]);
 await sell('APHD4307 Капот',1);assert.equal(records.get('item0').quantity,2);assert.equal(records.get('item0').status,'active');
 assert.equal([...records.values()].find(item=>item.status==='sold').quantity,1);
});
test('linked lot wins over older stock; other orders reserved stock is untouched',async()=>{
 const {records,sell}=setup([{article:'APHD4307',quantity:1,status:'active',orderId:'other',receivedAt:'2020'},
 {article:'APHD4307',quantity:1,status:'active',receivedAt:'2021'},
 {article:'APHD4307',quantity:1,status:'active',orderId:'order',receivedAt:'2026'}]);
 await sell('APHD4307');assert.equal(records.get('item2').status,'sold');assert.equal(records.get('item0').status,'active');assert.equal(records.get('item1').status,'active');
});
