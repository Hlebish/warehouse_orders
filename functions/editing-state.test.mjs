import test from 'node:test';
import assert from 'node:assert/strict';
import {orderEditSnapshot,assertOrderUnchanged} from '../editing-state.mjs';
import {explainBuybackItem} from '../buyback-explanation.mjs';
import {draftKey} from '../draft-store.mjs';
import {localDateKey,validReceivedDate} from '../buyback-dates.mjs';
const order=()=>({number:'42',client:'Client',status:'Создан',createdAt:'2026-11-12',articles:[{article:'A',quantity:1}]});
test('receipt dates accept backdated and leap-day receipts but reject nonexistent calendar dates',()=>{
 assert.equal(validReceivedDate('2026-11-01'),true);
 assert.equal(validReceivedDate('2024-02-29'),true);
 for(const value of ['2026-02-29','2026-11-31','2026-13-01','2026-00-10','','01.11.2026'])assert.equal(validReceivedDate(value),false,value);
 assert.equal(localDateKey(new Date(2026,10,1,23,59)),'2026-11-01');
});
test('normalizing an order version tolerates absent optional fields, but detects collection changes',()=>{
 const base=orderEditSnapshot(order());
 assert.doesNotThrow(()=>assertOrderUnchanged(base,{...order(),deliveryType:'city',clientId:'',assemblyInProgress:false,returns:[]}));
 assert.throws(()=>assertOrderUnchanged(base,{...order(),articles:[{article:'A',quantity:1,collected:true}],updatedByName:'Аня'}),/Аня/);
});
test('versions include business fields, not property insertion order',()=>{
 const base=order(),expected=orderEditSnapshot(base);
 for(const patch of [{status:'Отгружен кладовщиком'},{client:'Other'},{clientId:'other'},{number:'43'},{updatedAt:'later'},{articles:[{article:'B',quantity:1}]}])assert.throws(()=>assertOrderUnchanged(expected,{...base,...patch}),{code:'order-conflict'});
 assert.doesNotThrow(()=>assertOrderUnchanged(expected,{articles:base.articles,status:base.status,client:base.client,number:base.number,createdAt:base.createdAt}));
});
test('drafts are isolated by account, order, kind and reply target',()=>{
 const keys=[draftKey('a','o','comment'),draftKey('b','o','comment'),draftKey('a','p','comment'),draftKey('a','o','defect'),draftKey('a','o','comment','reply')];assert.equal(new Set(keys).size,5);
});
test('inventory explanation separates card quantity from aggregate article totals',()=>{
 const rows=[{article:'A-1',quantity:1,status:'active'},{article:'A-1',quantity:2,status:'sold',soldByOrderId:'order',soldByOrderNumber:'42'},{article:'A-10',quantity:99,status:'sold'}];
 const info=explainBuybackItem(rows[0],rows);assert.equal(info.available,1);assert.equal(info.sold,2);assert.match(info.detail,/1 шт/);
 assert.match(explainBuybackItem(rows[1],rows).detail,/42/);
});
test('an active lot linked to a shipped order is flagged for synchronization, not described as unshipped',()=>{
 const item={article:'A',quantity:1,status:'active',orderId:'o'};
 const info=explainBuybackItem(item,[item],{number:'42',status:'Отгружен кладовщиком'});
 assert.equal(info.warning,true);assert.match(info.title,/синхронизации/);
 assert.equal(explainBuybackItem(item,[item],{number:'42',status:'Собран'}).warning,false);
});
