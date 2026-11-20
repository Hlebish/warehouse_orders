// Real order-card renderers and styles, with an isolated Firestore listener.
// The local fixture never signs in or makes requests to production services.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const historyImport=source.split('\n').find(line=>/^import .*from ['"]\.\/order-history\.mjs/.test(line));
assert.ok(historyImport,'the order card imports the real history model');
const application=[
 between('function showModal(', 'function closeModal('),
 between('function button(', 'function articleRowHtml('),
 between('function statusClass(', 'const statOrderConfig='),
 between('function orderDeliveryFields(', '/* ===== Справочники клиентов'),
 between('function focusPendingOrderEntry(', 'async function openPendingNotificationOrder('),
 between('function renderOrderHistoryItem(', 'function openOrderActionCategory('),
 between('function editOrderInfo(', 'const orderEditsInFlight=')
].join('\n');
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=';
const fixture=`
${historyImport.replace("'./order-history", "'/order-history").replace('"./order-history', '"/order-history')}
import {orderPaymentLabel,orderPaymentLabels,isOrderPaymentType,deliveryAddressLimit,mainCommentLimit,storedOrderDeliveryDetails} from '/order-delivery.mjs';
import {decorateDefectPhotoActions} from '/photo-sharing.mjs';
const $=id=>document.getElementById(id),modal=$('modalBackdrop');
const signedInUser={uid:'current-viewer'},profileName='Текущий сотрудник';
const state={orders:[],role:'warehouse'},db={},entryUnsubscribes=new Map(),serverCache=new Map(),serverEntriesLoaded=new Set();
const staffDirectory=new Map([['creator-legacy',{uid:'creator-legacy',displayName:'Анна из справочника'}]]);
let selectedId=null,canManageUsers=false,initialCloudLoad=true,pendingOrderEntryFocus=null;
let orderReturnModalSnapshot=null,directChatTarget=null,directChatActiveThreadId='',directChatOpenRequest=0;
let directChatUnsubscribe=null,activeEntryDraft=null,modalHistoryEntry=false;
const photoSharing={isOpen:()=>false,close(){}},persistOpenEntryDraft=()=>{},decoratePhotoSharing=()=>{};
const openStaffPanel=()=>{},isAndroidWarehouse=()=>false,orderEditSnapshot=x=>x;
const loadProductsCatalog=()=>{},articlesEditorHtml=()=>'',canEditOrder=o=>!isShipmentLocked(o);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const renderChatText=esc;
const asDate=value=>{if(!value)return null;if(typeof value.toDate==='function')return value.toDate();if(typeof value.toMillis==='function')return new Date(value.toMillis());if(typeof value==='object'&&Number.isFinite(value.seconds))return new Date(value.seconds*1000);const date=new Date(value);return Number.isNaN(date.getTime())?null:date;};
const fmtDateTime=value=>{const date=asDate(value);return date?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(date):'—';};
const plural=(n,a,b,c)=>{n=Math.abs(n)%100;const d=n%10;return n>10&&n<20?c:d>1&&d<5?b:d===1?a:c;};
const isManagerRole=()=>['manager','chief_accountant','accountant'].includes(state.role);
const isShipmentLocked=o=>['Отгружен кладовщиком','Клиент забрал самовывозом'].includes(o?.status)&&!canManageUsers;
const hasPendingDefect=o=>(o.entries||[]).some(entry=>entry.kind==='defect'&&!entry.decision);
const loadWarehouseMapAddresses=()=>{},saveOrdersCache=()=>{},scheduleRender=()=>{};
const toast=message=>window.qa.toasts.push(message);
const collection=(_db,...segments)=>segments.join('/'),entryFromCloud=(id,data)=>({id,...data});
const listeners=new Map();
function onSnapshot(ref,options,callback){if(options.includeMetadataChanges!==true)throw Error('Missing history metadata updates');listeners.set(ref,callback);queueMicrotask(()=>{if(listeners.get(ref)===callback)callback(snapshot(ref,true));});return ()=>listeners.delete(ref);}
function snapshot(ref,fromCache){const order=state.orders.find(item=>ref==='orders/'+item.id+'/entries');return {docs:(order?.entries||[]).map(entry=>({id:entry.id,data:()=>({...entry})})),metadata:{fromCache}};}
const seed={id:'order-history',number:'QA-17',client:'Клиент с длинным названием для проверки карточки',status:'Отгружен кладовщиком',deliveryType:'city',author:'Анна Создатель',createdBy:'creator',createdAt:'2026-11-17T08:00:00Z',assemblyStartedAt:'2026-11-17T08:05:00Z',assemblyStartedByName:'Иван Кладовщик',assembledAt:'2026-11-17T08:10:00Z',shippedAt:'2026-11-17T08:35:00Z',articles:[{article:'ДЕТАЛЬ-17',quantity:2,collected:true}],returns:[{id:'return-1',author:'Иван Кладовщик',createdAt:'2026-11-17T08:40:00Z',items:[{article:'ДЕТАЛЬ-17',quantity:1}],reason:'Не подошёл размер',status:'cancelled',cancelledAt:'2026-11-17T08:50:00Z',cancelledByName:'Директор'}],entries:[
 {id:'entry-shipped',kind:'system',author:'Иван Кладовщик',text:'Статус: Собран → Отгружен кладовщиком',statusTo:'Отгружен кладовщиком',createdAt:'2026-11-17T08:35:00Z'},
 {id:'entry-comment',kind:'comment',author:'Галина Бухгалтер',text:'Комментарий с фотографией '+ 'ДЛИННЫЙАРТИКУЛ'.repeat(14)+' <script>не выполнять</script>',photos:[${JSON.stringify(photo)}],important:true,createdAt:'2026-11-17T08:20:00Z'},
 {id:'entry-defect',kind:'defect',author:'Иван Кладовщик',article:'ДЕТАЛЬ-17',articleIndex:0,text:'Небольшой скол на краю',photos:[${JSON.stringify(photo)}],createdAt:'2026-11-17T08:25:00Z',decision:'Подтверждён',decidedAt:'2026-11-17T08:30:00Z',decidedByName:'Мария Менеджер',decisionText:'Клиент согласовал скол'},
 {id:'entry-question',kind:'question',author:'Мария Менеджер',text:'Проверка комплектации',createdAt:'2026-11-17T08:15:00Z'},
 {id:'entry-reply',kind:'comment',author:'Иван Кладовщик',text:'Ответ на комментарий',replyToEntryId:'entry-comment',replyToAuthorName:'Галина Бухгалтер',replyToText:'Комментарий с фотографией',createdAt:'2026-11-17T08:22:00Z'},
 {id:'entry-assembled',kind:'system',author:'Иван Кладовщик',text:'Заказ собран',statusTo:'Собран',createdAt:'2026-11-17T08:10:00Z'}
]};
state.orders.push(structuredClone(seed));
window.qa={toasts:[]};
${application}
Object.assign(window.qa,{
 ready:true,
 createOrder:openNewOrder,
 readDelivery:readOrderDeliveryFields,
 editDelivery:()=>{Object.assign(state.orders[0],{status:'Создан',paymentType:'deferred',deliveryAddress:'Улица 12',mainComment:'Вход со двора'});selectedId=seed.id;editOrderInfo();},
 open:(role='warehouse')=>{state.role=role;openOrder(seed.id);},
 loaded:()=>{const ref='orders/'+seed.id+'/entries';listeners.get(ref)?.(snapshot(ref,false));},
 reset:()=>{canManageUsers=false;state.orders[0]=structuredClone(seed);serverEntriesLoaded.clear();entryUnsubscribes.get(seed.id)?.();entryUnsubscribes.delete(seed.id);},
 legacyCreator:()=>{const order=state.orders[0];order.author='Сотрудник';order.createdBy='creator-legacy';delete order.createdByName;openOrder(order.id);},
 unknownCreator:()=>{const order=state.orders[0];delete order.author;delete order.createdBy;delete order.createdByName;openOrder(order.id);},
 pendingDefect:()=>{const order=state.orders[0];order.status='Собран';const defect=order.entries.find(entry=>entry.id==='entry-defect');delete defect.decision;delete defect.decidedAt;delete defect.decidedByName;delete defect.decisionText;openOrder(order.id);},
 activeReturn:()=>{canManageUsers=true;state.role='director';const order=state.orders[0],record=order.returns[0];record.status='created';delete record.cancelledAt;delete record.cancelledByName;openOrder(order.id);},
 pickup:()=>{const order=state.orders[0];order.status='Клиент забрал самовывозом';order.entries=order.entries.filter(entry=>entry.id!=='entry-shipped');openOrder(order.id);},
 assembled:()=>{state.orders[0].status='Собран';openOrder(seed.id);},
 focus:id=>{pendingOrderEntryFocus={orderId:seed.id,entryId:id};openOrder(seed.id);}
});
`;

async function run(){
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/qa.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fixture);return;}
  if(pathname==='/'){
   res.setHeader('Content-Type','text/html; charset=utf-8');
   res.end('<!doctype html><html class="app-booted"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>*{animation:none!important;transition:none!important;scroll-behavior:auto!important}</style></head><body class="dark-theme"><div class="modal-backdrop" id="modalBackdrop" hidden><section class="modal"><header class="modal-head"><div><span id="modalEyebrow" class="eyebrow"></span><h2 id="modalTitle"></h2></div><button class="close-button" aria-label="Закрыть">×</button></header><div id="modalBody" class="modal-body"></div><footer id="modalFoot" class="modal-foot"></footer></section></div><script type="module" src="/qa.js"></script></body></html>');return;
  }
  const file=path.join(root,path.basename(pathname));
  if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
  const content=fs.readFileSync(file,'utf8');res.end(pathname.endsWith('.css')?content.replace(/@import[^;]*;/g,''):content);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:process.platform==='win32'?{channel:'chrome'}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  await page.goto(url);await page.waitForFunction(()=>window.qa?.ready);
  await page.evaluate(()=>window.qa.createOrder());
  assert.equal(await page.locator('#orderPaymentType').inputValue(),'');
  assert.equal(await page.evaluate(()=>window.qa.readDelivery()),null);
  await page.locator('#orderPaymentType').selectOption('unknown');
  assert.deepEqual(await page.evaluate(()=>window.qa.readDelivery()),{paymentType:'unknown',deliveryAddress:'',mainComment:''});
  await page.locator('#orderPaymentType').selectOption({label:'Безналичные'});
  assert.equal((await page.evaluate(()=>window.qa.readDelivery())).paymentType,'cashless');
  const address=page.locator('#orderDeliveryAddress');
  for(const type of ['city','kamyanske','post','pickup']){
   await page.locator('#deliveryType').selectOption(type);
   assert.equal(await address.evaluate(input=>input.required),false);
   assert.equal(await address.inputValue(),'');
   assert.equal(await page.locator('label[for="orderDeliveryAddress"]').textContent(),'Адрес доставки (необязательно)');
  }
  await page.evaluate(()=>window.qa.editDelivery());
  assert.equal(await page.locator('#orderPaymentType').inputValue(),'deferred');
  assert.equal(await page.locator('#orderDeliveryAddress').inputValue(),'Улица 12');
  assert.equal(await address.evaluate(input=>input.required),false);
  assert.equal(await page.locator('#orderMainComment').inputValue(),'Вход со двора');
  await page.evaluate(()=>window.qa.reset());
  await page.evaluate(()=>window.qa.open());
  assert.match(await page.locator('.order-delivery-summary').textContent(),/Оплата: Неизвестно/);
  assert.equal(await page.locator('[data-action="print-driver-order"]').count(),0);
  assert.equal(await page.locator('.order-summary').count(),0);
  assert.doesNotMatch(await page.locator('#modalBody').textContent(),/Коротко по заказу|Следующее действие/);
  assert.match(await page.locator('.order-detail-head').textContent(),/Анна Создатель/);
  assert.match(await page.locator('.order-detail-head').textContent(),/17.*2026/);
  assert.equal(await page.locator('.order-history-loading').count(),2);
  await page.evaluate(()=>window.qa.loaded());
  assert.equal(await page.locator('.order-history-loading').count(),0);
  console.log('PASS actual order card removes the green summary and updates cached history after server confirmation');

  const ids=await page.locator('[data-order-entry-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.orderEntryId));
  assert.deepEqual(ids,['entry-assembled','entry-question','entry-comment','entry-reply','entry-defect','entry-shipped']);
  const events=await page.locator('.order-history [data-order-history-id]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.orderHistoryId,at:node.querySelector('time')?.dateTime})));
  assert.deepEqual(events.map(event=>event.id),['milestone:created','milestone:assemblyStartedAt','entry-assembled','entry-question','entry-comment','entry-reply','entry-defect','decision:entry-defect','entry-shipped','return:return-1','return-cancelled:return-1']);
  assert.deepEqual(events.map(event=>event.at),[...events.map(event=>event.at)].sort());
  assert.equal(new Set(events.map(event=>event.id)).size,events.length,'duplicate history events');
  assert.match(await page.locator('.order-latest-event').textContent(),/Возврат отменён.*Директор/s);
  const text=await page.locator('#modalBody').textContent();
  for(const expected of ['Иван Кладовщик','Мария Менеджер','Клиент согласовал скол','Не подошёл размер','Возврат отменён'])assert.ok(text.includes(expected),expected);
  assert.equal(await page.locator('[data-order-entry-id="entry-comment"] [data-photo]').count(),1);
  assert.equal(await page.locator('[data-order-entry-id="entry-defect"] [data-photo]').count(),1);
  assert.equal(await page.locator('[data-action="reply-entry:entry-comment"]').count(),1);
  assert.equal(await page.locator('[data-action="add-comment"]').isEnabled(),true);
  assert.match(await page.locator('[data-order-entry-id="entry-reply"] .timeline-reply-reference').textContent(),/Галина Бухгалтер/);
  assert.equal(await page.locator('[data-order-entry-id="entry-comment"] script').count(),0);
  assert.equal(await page.locator('[data-copy-photo]').count(),2);
  console.log('PASS chronological rich entries retain comments, replies, photos, decision details and return events');

  await page.evaluate(()=>window.qa.legacyCreator());
  assert.match(await page.locator('.order-detail-head').textContent(),/Анна из справочника/);
  await page.evaluate(()=>window.qa.unknownCreator());
  assert.match(await page.locator('.order-detail-head').textContent(),/Автор не указан/);
  await page.evaluate(()=>{window.qa.reset();window.qa.open('manager');window.qa.loaded();window.qa.pendingDefect();});
  for(const action of ['defect-confirm:entry-defect','defect-remove:entry-defect','defect-cancel:entry-defect','review-defect:0'])assert.equal(await page.locator('[data-action="'+action+'"]').isEnabled(),true,action);
  await page.evaluate(()=>window.qa.open('warehouse'));
  assert.equal(await page.locator('[data-action="defect-confirm:entry-defect"]').count(),0);
  assert.equal(await page.locator('[data-action="toggle-assembly"]').isEnabled(),true);
  assert.equal(await page.locator('[data-action="open-warehouse-actions"]').isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'📋 Менеджер',exact:true}).isDisabled(),true);
  console.log('PASS legacy creator lookup and existing manager/warehouse action permissions');

  await page.evaluate(()=>window.qa.focus('entry-comment'));
  await page.waitForFunction(()=>document.querySelector('[data-order-entry-id="entry-comment"]')?.classList.contains('entry-notification-focus'));
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.orderEntryId),'entry-comment');
  await page.waitForFunction(()=>{const target=document.querySelector('[data-order-entry-id="entry-comment"]').getBoundingClientRect(),body=document.getElementById('modalBody').getBoundingClientRect();return target.top<body.bottom&&target.bottom>body.top;});
  console.log('PASS notification targeting focuses the exact original rich history entry');

  await page.evaluate(()=>window.qa.activeReturn());
  assert.equal(await page.locator('[data-order-history-id="return:return-1"] [data-action="cancel-return:order-history:return-1"]').isEnabled(),true);
  assert.equal(await page.locator('[data-action^="delete-entry:"]').count(),6);
  await page.evaluate(()=>{window.qa.reset();window.qa.open();window.qa.loaded();window.qa.pickup();});
  assert.match(await page.locator('[data-order-history-id="milestone:shippedAt"]').textContent(),/Заказ выдан самовывозом/);
  console.log('PASS return cancellation remains on its history event and legacy self pickup gets a dated event');

  for(const width of [1280,390,320])for(const dark of [true,false]){
   await page.setViewportSize({width,height:844});
   await page.evaluate(dark=>document.body.classList.toggle('dark-theme',dark),dark);
   await page.evaluate(()=>{window.qa.reset();window.qa.open();window.qa.loaded();document.getElementById('modalBody').scrollTop=0;document.querySelector('.modal').scrollTop=0;});
   const layout=await page.locator('.modal').evaluate(dialog=>({
    dialogOverflow:dialog.scrollWidth>dialog.clientWidth+1,
    bodyOverflow:document.getElementById('modalBody').scrollWidth>document.getElementById('modalBody').clientWidth+1,
    outsideViewport:dialog.getBoundingClientRect().left<-.5||dialog.getBoundingClientRect().right>innerWidth+.5,
    rows:[...dialog.querySelectorAll('[data-order-entry-id]')].length,
    creatorColor:getComputedStyle(dialog.querySelector('.order-created-by')).color,
    creatorFont:getComputedStyle(dialog.querySelector('.order-created-by')).fontSize,
    historyActorColor:getComputedStyle(dialog.querySelector('.order-history .timeline-top b')).color,
    overflowing:[...dialog.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().right>dialog.getBoundingClientRect().right+1).slice(0,8).map(node=>({tag:node.tagName,className:node.className,width:node.clientWidth,scroll:node.scrollWidth,text:node.textContent.slice(0,100)}))
   }));
   if(layout.dialogOverflow||layout.bodyOverflow||layout.outsideViewport){await page.screenshot({path:path.join(os.tmpdir(),'order-history-overflow-'+width+'.png')});console.log('LAYOUT',JSON.stringify(layout));}
   assert.equal(layout.dialogOverflow,false,'dialog overflow '+width+' '+dark);
   assert.equal(layout.bodyOverflow,false,'body overflow '+width+' '+dark);
   assert.equal(layout.outsideViewport,false,'dialog outside viewport '+width+' '+dark);
   assert.equal(layout.rows,6);
   assert.equal(layout.creatorFont,'12px');
   assert.equal(layout.creatorColor,dark?'rgb(186, 199, 209)':'rgb(83, 105, 92)');
   if(!dark)assert.equal(layout.historyActorColor,'rgb(38, 62, 54)');
   if(width===390){
    console.log('COLORS',dark?'dark':'light',JSON.stringify({creator:layout.creatorColor,creatorFont:layout.creatorFont,historyActor:layout.historyActorColor}));
    await page.screenshot({path:path.join(os.tmpdir(),'order-history-'+(dark?'dark':'light')+'-390.png')});
    await page.locator('.order-history').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
    await page.screenshot({path:path.join(os.tmpdir(),'order-history-'+(dark?'dark':'light')+'-timeline-390.png')});
   }
  }
  assert.deepEqual(errors,[],'browser exceptions');
  console.log('PASS 1280/390/320 layouts in light and dark themes without browser exceptions');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
