import test from 'node:test';
import assert from 'node:assert/strict';
import {buybackPhase,buybackIsCritical,buybackStockPatch} from '../buyback-state.mjs';
import {explainBuybackItem} from '../buyback-explanation.mjs';
const now=new Date(2026,10,12,12);
test('only an active lot between days 10 and 13 lights the critical indicator',()=>{
 for(const [date,phase]of [['2026-11-12','active'],['2026-11-06','approaching'],['2026-11-02','critical'],['2026-10-30','critical'],['2026-10-29','expired'],['2026-10-01','expired']]){
  const row={status:'active',receivedAt:date};assert.equal(buybackPhase(row,now),phase);assert.equal(buybackIsCritical(row,now),phase==='critical');
 }
 for(const status of ['expired','stocked','sold','returned','cancelled','shipped'])assert.equal(buybackIsCritical({status,receivedAt:'2026-11-02'},now),false,status);
 assert.equal(buybackIsCritical({status:'active',receivedAt:'invalid'},now),false);
});
test('midnight expires an active critical lot even before the server status refresh',()=>{
 const row={status:'active',receivedAt:'2026-10-30'};assert.equal(buybackIsCritical(row,new Date(2026,10,12,23,59)),true);assert.equal(buybackIsCritical(row,new Date(2026,10,13,0,1)),false);
});
test('stock acceptance records its actor and does not reset the receipt date or count toward timed stock',()=>{
 const row={article:'A',quantity:2,receivedAt:'2026-10-01',status:'expired'},stocked={...row,...buybackStockPatch({uid:'accountant',name:'Анна'},'2026-11-12')};
 assert.equal(stocked.receivedAt,row.receivedAt);assert.equal(stocked.stockedBy,'accountant');assert.equal(buybackPhase(stocked,now),'stocked');
 const info=explainBuybackItem(stocked,[stocked]);assert.equal(info.available,0);assert.equal(info.stocked,2);assert.match(info.detail,/Срок возврата закрыт/);
});
