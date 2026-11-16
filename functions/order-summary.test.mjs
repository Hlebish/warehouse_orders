import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildOrderSummary,renderOrderSummary} from '../order-summary.mjs';

const base=patch=>({status:'Создан',createdAt:'2026-11-16T08:00:00Z',articles:[{article:'A',collected:true},{article:'B',collected:false}],entries:[],...patch});
test('open defects take priority over shipment readiness and expose the responsible role',()=>{
 const summary=buildOrderSummary(base({status:'Одобрен на отгрузку клиенту',entries:[{kind:'defect',article:'B',text:'Повреждение'}]}));
 assert.equal(summary.tone,'warning');assert.match(summary.attention,/B/);assert.match(summary.attention,/1/);
 assert.equal(summary.next.owner,'Менеджер');assert.match(summary.next.text,/смена статуса пока заблокирована/);
});
test('resolved defects stop blocking work and removed lines do not count towards assembly',()=>{
 const summary=buildOrderSummary(base({entries:[{kind:'defect',articleIndex:1,article:'B',decision:'Удалена из заказа'},{kind:'defect',articleIndex:0,article:'A',decision:'Подтверждён'}]}));
 assert.deepEqual(summary.progress,{collected:1,total:1,removed:1,returns:0});
 assert.equal(summary.tone,'ready');assert.equal(summary.next.owner,'Кладовщик');assert.doesNotMatch(summary.attention,/Ожидает решения/);
 const cancelled=buildOrderSummary(base({entries:[{kind:'defect',article:'A',decision:'Отменён'}]}));
 assert.doesNotMatch(cancelled.attention,/Ожидает решения/);
});
test('terminal orders never propose assembly, defect approval or a new shipment',()=>{
 for(const status of ['Отгружен кладовщиком','Клиент забрал самовывозом','Отменён']){
  const summary=buildOrderSummary(base({status,entries:[{kind:'defect',article:'A'}]}));
  assert.equal(summary.tone,'done');assert.equal(summary.next.owner,'');
  assert.doesNotMatch(summary.next.text,/рассмотреть|продолжить|выполнить отгрузку/i);
 }
});
test('history loading does not claim an issue-free or shipment-ready order',()=>{
 const summary=buildOrderSummary(base({status:'Одобрен на отгрузку клиенту'}),{historyLoaded:false});
 assert.equal(summary.tone,'loading');assert.match(summary.attention,/Проверяем/);assert.match(summary.next.text,/Дождитесь/);
 assert.doesNotMatch(renderOrderSummary(base(),{historyLoaded:false}),/Сборка: 1\/2/);
 assert.equal(buildOrderSummary({},{historyLoaded:false}).latest.text,'История загружается');
});
test('workflow statuses show actionable guidance for the responsible staff',()=>{
 const cases=[
  ['Ожидает оплаты','Бухгалтер / менеджер',/оплаты/],
  ['На согласовании','Менеджер',/клиентом/],
  ['Под вопросом','Менеджер',/решение/],
  ['Перенесен','Менеджер',/вернуть заказ в работу/],
  ['Собран','Менеджер',/согласовать/],
  ['Одобрен на отгрузку клиенту','Кладовщик',/отгрузку/],
  ['Ожидает самовывоза','Кладовщик',/выдачу/],
  ['Возврат','Менеджер',/возврата/]
 ];
 for(const [status,owner,text] of cases){const summary=buildOrderSummary(base({status}));assert.equal(summary.next.owner,owner,status);assert.match(summary.next.text,text,status);}
 assert.match(buildOrderSummary(base({status:'Одобрен на отгрузку клиенту',deliveryType:'pickup'})).next.text,/выдаче/);
});
test('assembly progress excludes removed duplicate article positions by index',()=>{
 const summary=buildOrderSummary(base({assemblyInProgress:true,articles:[{article:'A',collected:false},{article:'A',collected:true}],entries:[{kind:'defect',article:'A',articleIndex:1,decision:'Удалена из заказа'}]}));
 assert.equal(summary.progress.total,1);assert.equal(summary.progress.collected,0);assert.match(summary.next.text,/Продолжить сборку/);
 const empty=buildOrderSummary(base({articles:[{article:'A'}],entries:[{kind:'defect',articleIndex:0,decision:'Удалена из заказа'}]}));
 assert.match(empty.attention,/Все позиции исключены/);assert.equal(empty.next.owner,'Менеджер');assert.doesNotMatch(empty.next.text,/отгрузить/);
});
test('latest event handles timestamp forms, excludes viewed entries and includes later defect decisions',()=>{
 const summary=buildOrderSummary(base({entries:[
  {kind:'comment',text:'Старый комментарий',createdAt:'2026-11-16T09:00:00Z'},
  {kind:'defect',article:'B',text:'Скол',createdAt:{toDate:()=>new Date('2026-11-16T10:00:00Z')},decision:'Подтверждён',decidedAt:{seconds:Date.parse('2026-11-16T11:00:00Z')/1000},decidedByName:'Галина'},
  {kind:'viewed',text:'Просмотрено',createdAt:{toMillis:()=>Date.parse('2026-11-16T12:00:00Z')}}
 ]}));
 assert.equal(summary.latest.text,'Дефект подтверждён · B');assert.equal(summary.latest.author,'Галина');
 assert.equal(summary.latest.at.toISOString(),'2026-11-16T11:00:00.000Z');
});
test('return cancellations and general edits appear as factual events',()=>{
 const order=base({returns:[{createdAt:'2026-11-16T09:00:00Z',reason:'Не подошло',status:'cancelled',cancelledAt:'2026-11-16T10:00:00Z',cancelledByName:'Директор'}]});
 const returned=buildOrderSummary(order);assert.equal(returned.latest.text,'Возврат отменён');assert.equal(returned.progress.returns,0);
 const edited=buildOrderSummary({...order,updatedAt:'2026-11-16T11:00:00Z',updatedByName:'Менеджер'});assert.equal(edited.latest.text,'Заказ обновлён · Создан');
});
test('rendering escapes all order data and leaves source records unchanged',()=>{
 const order=base({entries:[{kind:'comment',text:'<img src=x onerror=alert(1)>',author:'<script>bad</script>',createdAt:'2026-11-16T09:00:00Z'}]});
 const before=JSON.stringify(order);const html=renderOrderSummary(order,{formatDateTime:()=>'<date>'});
 assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;date&gt;/);
 assert.doesNotMatch(html,/<img|<script>|<date>/);assert.equal(JSON.stringify(order),before);
});

test('the order card renders the summary above actions with the current history-loading state',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=source.indexOf('function openOrder(id,'),end=source.indexOf('function openOrderActionCategory(',start);
 assert.ok(start>=0&&end>start);
 const order={...base(),id:'o',client:'Клиент',number:'1'},calls=[];
 const modal={hidden:true,dataset:{}};
 const elements={modalTitle:{textContent:'Личный чат'},modalEyebrow:{textContent:'Сообщения'},modalBody:{innerHTML:'Чат'},modalFoot:{innerHTML:''}};
 const context={state:{orders:[order],role:'warehouse'},selectedId:null,entryUnsubscribes:new Map(),serverEntriesLoaded:new Set(),
  canManageUsers:false,isManagerRole:()=>false,hasPendingDefect:()=>false,isShipmentLocked:()=>false,watchOrderEntries(){},modal,
  orderReturnModalSnapshot:null,directChatTarget:{uid:'peer'},directChatActiveThreadId:'peer__user',$:id=>elements[id],
  esc:value=>String(value??''),button:()=>'',statusPill:()=>'',assemblyIndicator:()=>'',fmtDateTime:()=>'',entriesCount:()=>0,plural:()=>'',
  loadWarehouseMapAddresses(){},focusPendingOrderEntry(){},showModal(title,body){calls.push({title,body});modal.hidden=false;elements.modalTitle.textContent=title;},
  renderOrderSummary(value,options){calls.push({summary:true,value,options});return '<section class="order-summary">Сводка</section>';}
 };
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);context.openOrder('o');
 assert.equal(calls.find(call=>call.summary).options.historyLoaded,false);
 const body=calls.find(call=>call.body).body;assert.ok(body.indexOf('class="order-summary"')<body.indexOf('class="detail-actions"'));
 assert.doesNotMatch(body,/detail-history-mini/);
 context.serverEntriesLoaded.add('o');context.openOrder('o');assert.equal(calls.filter(call=>call.summary).at(-1).options.historyLoaded,true);
});

test('the entries listener refreshes the summary once when cached history is confirmed by the server',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=source.indexOf('function watchOrderEntries('),end=source.indexOf('async function openPendingNotificationOrder(',start);
 let callback,rendered=0;
 const context={db:{},entryUnsubscribes:new Map(),serverEntriesLoaded:new Set(),state:{orders:[{id:'o',entries:[]}]},
  collection:()=>({}),onSnapshot(_ref,options,listener){assert.equal(options.includeMetadataChanges,true);callback=listener;return ()=>{};},
  serverCache:new Map(),saveOrdersCache(){},scheduleRender(){},initialCloudLoad:true,selectedId:'o',modal:{hidden:false,dataset:{orderDetail:'o'}},
  openOrder(){rendered++;},toast(){},entryFromCloud:(id,data)=>({id,...data}),asDate:value=>new Date(value)
 };
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);context.watchOrderEntries('o');
 callback({docs:[],metadata:{fromCache:true}});assert.equal(rendered,1);assert.equal(context.serverEntriesLoaded.has('o'),false);
 callback({docs:[],metadata:{fromCache:false}});assert.equal(rendered,2);assert.equal(context.serverEntriesLoaded.has('o'),true);
 callback({docs:[],metadata:{fromCache:false}});assert.equal(rendered,2);
});
