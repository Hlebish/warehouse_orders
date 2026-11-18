// Exercise the real coordinator, resume handlers, order listener and indicator
// in a mobile browser, with a deterministic local Firestore transport.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const markup=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');
const script=`
import {createForegroundSync} from '/foreground-sync.mjs';
const $=id=>document.getElementById(id),modal=$('modalBackdrop'),isAndroidClient=()=>true;
let signedInUser={uid:'qa'},ordersRetryTimer=null,ordersUnsubscribe=null,ordersRetryDelay=3000,ordersConnectionNoticeShown=false,ordersListenerBlocked=false,initialCloudLoad=true;
let serverListener=null,reconnects=0,subscriptions=0;const inspectionItems={start(){}};
const state={orders:[{id:'cached',status:'Создан',number:'1',entries:[]}]},db={},pendingWrites=new Set(),pendingOrderData=new Map(),serverCache=new Map(),entryUnsubscribes=new Map();
const selectedId=null,pendingNotificationOrderId='',collection=()=>({}),saveOrdersCache=()=>{},flushOrdersCache=()=>{},watchPendingDefectOrders=()=>{},restoreUiState=()=>{},notify=()=>{},toast=()=>{};
const scheduleRender=()=>{$('statCreated').textContent=state.orders.filter(o=>o.status==='Создан').length;};
function onSnapshot(_ref,options,callback){subscriptions++;serverListener=callback;queueMicrotask(()=>callback({docs:[],docChanges:()=>[],metadata:{fromCache:true}}));return ()=>{};}
async function disableNetwork(){reconnects++;serverListener({docs:[],docChanges:()=>[],metadata:{fromCache:true}});}
async function enableNetwork(){}
${between('function renderDataSyncStatus(', 'const warehouseMapPanel=')}
${between('function watchOrders(){', 'let presenceUnsubscribe=')}
const finishInitialLoading=()=>{},windowCheck=()=>{};window.checkWarehouseSiteUpdate=windowCheck;
${between("window.addEventListener('warehouse-app-resumed',event=>{", 'function updateVersionLabel()')}
document.documentElement.classList.add('app-booted');document.querySelector('.app-shell').hidden=false;$('siteLoader').hidden=true;
$('modalTitle').textContent='Черновик комментария';$('modalBody').innerHTML='<textarea id="draft">Неотправленный текст</textarea>';modal.hidden=false;
scheduleRender();watchOrders();
window.qa={resume:()=>window.dispatchEvent(new CustomEvent('warehouse-app-resumed',{detail:{backgroundMs:30000}})),
 confirm(){const doc={id:'new',data:()=>({number:'2',status:'Создан',articles:[]})};serverListener({docs:[{id:'cached'},doc],docChanges:()=>[{type:'added',doc}],metadata:{fromCache:false,hasPendingWrites:false}});},
 connections:()=>({reconnects,subscriptions}),stop:()=>foregroundDataSync.reset()};
`;
async function run(){
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(markup.replace('</body>','<script type="module" src="/fixture.js"></script></body>'));return;}
  if(pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(script);return;}
  if(['/styles.css','/foreground-sync.mjs'].includes(pathname)){res.setHeader('Content-Type',pathname.endsWith('css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,pathname.slice(1))));return;}
  res.writeHead(204);res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36 WarehouseOrdersAndroid'});
  page.setDefaultTimeout(5000);
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.waitForFunction(()=>!!window.qa);
  assert.equal(await page.locator('#statCreated').textContent(),'1','empty SDK cache preserves the visible count');
  await page.locator('#draft').focus();await page.locator('#draft').evaluate(node=>node.setSelectionRange(4,8));
  await page.evaluate(()=>{window.qa.resume();window.qa.resume();});
  await page.locator('#dataSyncIndicator[data-state="syncing"]').waitFor({state:'visible'});
  assert.deepEqual(await page.evaluate(()=>window.qa.connections()),{reconnects:1,subscriptions:1});
  for(const dark of [false,true]){
   await page.evaluate(dark=>document.body.classList.toggle('dark-theme',dark),dark);
   const layout=await page.locator('#dataSyncIndicator').evaluate(node=>({height:node.querySelector('.data-sync-track').getBoundingClientRect().height,right:node.querySelector('.data-sync-label').getBoundingClientRect().right,pointer:getComputedStyle(node).pointerEvents}));
   assert.equal(layout.height,3);assert.ok(layout.right<=390);assert.equal(layout.pointer,'none');
  }
  await page.screenshot({path:path.join(process.env.TEMP||root,'warehouse-background-sync-mobile.png')});
  await page.evaluate(()=>window.qa.confirm());await page.locator('#dataSyncIndicator').waitFor({state:'hidden'});
  assert.equal(await page.locator('#statCreated').textContent(),'2');
  assert.deepEqual(await page.locator('#draft').evaluate(node=>({value:node.value,start:node.selectionStart,end:node.selectionEnd,focused:document.activeElement===node})),{value:'Неотправленный текст',start:4,end:8,focused:true});
  assert.equal(await page.locator('#siteLoader').isVisible(),false);assert.equal(page.url(),origin+'/');
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await page.locator('#dataSyncIndicator[data-state="offline"]').waitFor({state:'visible'});
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>window.qa.connections().reconnects===2);
  await page.evaluate(()=>window.qa.confirm());await page.locator('#dataSyncIndicator').waitFor({state:'hidden'});
  assert.equal(await page.locator('#draft').inputValue(),'Неотправленный текст');assert.deepEqual(errors,[]);
  console.log('PASS Android resume, retained counters/draft/focus, one subscription, thin light/dark indicator, offline recovery');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
