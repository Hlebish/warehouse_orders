// Scripted integration QA: real application handlers and modules, isolated
// Firestore/Storage adapter and a fresh browser profile. No production access.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const application=[
 between('function presenceLastSeenLabel(', 'function renderStaffPanel('),
 between('function showModal(', 'function button('),
 between('let directChatTarget=', 'const ADMIN_TEST_CASES=')
].join('\n');
const fixture=`
import {composerHtml,bindChatComposer,chatDay,chatTime} from '/chat-ui.mjs?v=2026.11.16.04';
import {bindDirectChatDraft} from '/direct-chat-draft.mjs?v=2026.11.16.04';
import {createDirectChatHistory} from '/direct-chat-history.mjs?v=2026.11.16.04';
import {createDirectChatReceipts} from '/direct-chat-receipts.mjs?v=2026.11.16.02';
import {createDirectChatNoticeSync} from '/direct-chat-notices.mjs?v=2026.11.16.02';
import {drafts,draftKey} from '/draft-store.mjs?v=2026.11.16.04';
const $=id=>document.getElementById(id),modal=$('modalBackdrop');
const signedInUser={uid:'me'},profileName='Кладовщик';
const db={},storage={},state={orders:[],notices:[],role:'warehouse'};
let selectedId=null,activeEntryDraft=null,directChatUnsubscribe=null,chatUnsubscribe=null;
let modalHistoryEntry=false,orderReturnModalSnapshot=null;
const entryUnsubscribes=new Map(),statOrderConfig={},staffPresence=new Map();
const photoSharing={isOpen:()=>false,close(){}},persistOpenEntryDraft=()=>{},decoratePhotoSharing=()=>{};
const orderEditSnapshot=x=>x,openStatOrders=()=>{},showNotifications=()=>{},openStaffPanel=()=>{};
const isAndroidWarehouse=()=>false,isPhoneDevice=()=>innerWidth<700;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const renderChatText=esc,fmtDateTime=value=>new Date(value).toLocaleString('ru-RU');
const toast=message=>{window.qa.toasts.push(message);};
const flagOn=(n,key)=>n?.[key]===true||n?.[key]==='true'||n?.[key]===1;
const showDirectUrgentAlert=()=>{},renderStaffPanel=()=>renderDirectChatPresence();
const markNotificationItemsRead=async notices=>{notices.forEach(n=>n.read=true);return {failed:0};};
const directChatNoticeSync=createDirectChatNoticeSync({viewerId:'me',isCurrentAccount:()=>true,markRead:n=>markNotificationItemsRead([n])});
const threads=new Map(),listeners=new Set(),photos=new Map();
const mainThread='me__peer';
const seed=Array.from({length:240},(_,i)=>({id:'m'+String(i).padStart(3,'0'),authorId:i%2?'me':'peer',authorName:'Сотрудник',text:i===5?'Артикул ARTICLE-OLD-42 найден в начале':'Сообщение '+i,photos:[],createdAt:new Date(Date.UTC(2026,10,16,0,i)).toISOString(),readBy:['me','peer'],urgentAckBy:[],isUrgent:false}));
threads.set(mainThread,seed);threads.set('me__other',[]);
const doc=(_db,...segments)=>segments.join('/'),collection=doc;
const orderBy=(field,direction)=>({kind:'order',field,direction}),limit=count=>({kind:'limit',count}),startAfter=cursor=>({kind:'cursor',id:cursor.id});
const query=(ref,...constraints)=>({ref,constraints});
const serverTimestamp=()=>new Date().toISOString(),arrayUnion=(...values)=>({union:values});
function record(ref){const parts=ref.split('/');if(parts.length===2)return {participants:parts[1].split('__')};return threads.get(parts[1])?.find(m=>m.id===parts[3]);}
function snapDoc(ref,value){return {id:ref.split('/').at(-1),metadata:{hasPendingWrites:false},exists:()=>!!value,data:()=>structuredClone(value)};}
function snapshot(q){const thread=q.ref.split('/')[1],list=[...(threads.get(thread)||[])].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||String(b.id).localeCompare(String(a.id)));const cursor=q.constraints.find(x=>x.kind==='cursor'),count=q.constraints.find(x=>x.kind==='limit')?.count||list.length;const from=cursor?list.findIndex(m=>m.id===cursor.id)+1:0;const rows=list.slice(from,from+count);return {docs:rows.map(m=>snapDoc(q.ref+'/'+m.id,m)),size:rows.length,metadata:{fromCache:false,hasPendingWrites:false}};}
function emit(){for(const listener of listeners)queueMicrotask(()=>{if(listeners.has(listener))listener.callback(snapshot(listener.q));});}
function onSnapshot(q,_options,callback){const listener={q,callback};listeners.add(listener);queueMicrotask(()=>{if(listeners.has(listener))callback(snapshot(q));});return ()=>listeners.delete(listener);}
async function getDocsFromServer(q){window.qa.pageReads++;if(window.qa.delayNextPage){window.qa.delayNextPage=false;await new Promise(resolve=>{window.qa.releasePage=resolve;});window.qa.releasePage=null;}return snapshot(q);}
async function runTransaction(_db,callback){const changes=[];const result=await callback({get:async ref=>snapDoc(ref,record(ref)),set:(ref,value)=>changes.push([ref,value]),update:()=>{}});if(window.qa.failSend&&changes.some(([ref])=>ref.split('/').length===4))throw Error('Тест: нет связи');for(const [ref,value]of changes){const p=ref.split('/');if(p.length===4){const list=threads.get(p[1])||[];list.push({...value,id:p[3]});threads.set(p[1],list);}}if(changes.length)emit();return result;}
async function updateDoc(ref,patch){const value=record(ref);if(!value)throw Error('missing message');for(const[key,next]of Object.entries(patch))value[key]=next?.union?[...new Set([...(value[key]||[]),...next.union])]:next;emit();}
const getDocFromServer=async ref=>snapDoc(ref,record(ref));
function writeBatch(){const changes=[];return {set:(ref,value)=>changes.push([ref,value]),update:()=>{},commit:async()=>{
 if(window.qa.failSend)throw Error('Тест: нет связи');
 for(const [ref,value] of changes)if(record(ref))throw Error('already exists');
 for(const [ref,value] of changes){const p=ref.split('/'),list=threads.get(p[1])||[];list.push({...value,id:p[3]});threads.set(p[1],list);}emit();
 }};}
const storageRef=(_storage,ref)=>ref,uploadBytes=async(ref,blob)=>photos.set(ref,blob);
async function getDownloadURL(ref){if(!photos.has(ref))throw Object.assign(Error('not found'),{code:'storage/object-not-found'});return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=';}
const readPhotos=async files=>files,queuePush=async()=>true;
window.qa={toasts:[],pageReads:0};
${application}
Object.assign(window.qa,{
 ready:true,open:(peer='peer',message='')=>openDirectChat({uid:peer,displayName:peer==='peer'?'Галина':'Другой сотрудник',roleLabel:'Бухгалтер'},'',message),
 close:()=>closeModal(true),emit,listenerCount:()=>listeners.size,
 sendCount:()=>[...threads.values()].reduce((sum,list)=>sum+list.filter(m=>!m.id.startsWith('m')).length,0),
 message:(id)=>threads.get(mainThread).find(m=>m.id===id),
 metadataRefresh:()=>emit()
 ,storedDraft:peer=>drafts.get(draftKey('me',['me',peer].sort().join('__'),'direct-chat'))
});
`;

async function run(){
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/qa.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fixture);return;}
  if(pathname==='/'){
   res.setHeader('Content-Type','text/html; charset=utf-8');
   res.end('<!doctype html><html class="app-booted"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>*{animation:none!important;transition:none!important;scroll-behavior:auto!important}</style></head><body class="dark-theme"><div class="modal-backdrop" id="modalBackdrop" hidden><section class="modal"><header class="modal-head"><div><span id="modalEyebrow" class="eyebrow"></span><h2 id="modalTitle"></h2></div></header><div id="modalBody" class="modal-body"></div><footer id="modalFoot" class="modal-foot"></footer></section></div><script type="module" src="/qa.js"></script></body></html>');return;
  }
  const file=path.join(root,path.basename(pathname));
  if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
  const content=fs.readFileSync(file,'utf8');res.end(pathname.endsWith('.css')?content.replace(/@import[^;]*;/g,''):content);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  await page.goto(url);await page.waitForFunction(()=>window.qa?.ready);
  await page.evaluate(()=>window.qa.open());
  await page.waitForFunction(()=>document.querySelectorAll('[data-direct-message-id]').length===100);
  const anchor=await page.locator('#directChatMessages').evaluate(box=>{box.scrollTop=400;const bounds=box.getBoundingClientRect();const node=[...box.querySelectorAll('[data-direct-message-id]')].find(el=>el.getBoundingClientRect().top>=bounds.top);return {id:node.dataset.directMessageId,offset:node.getBoundingClientRect().top-bounds.top};});
  await page.evaluate(()=>{window.qa.delayNextPage=true;});
  await page.locator('#directChatLoadOlder').click();
  await page.waitForFunction(()=>typeof window.qa.releasePage==='function');await page.evaluate(()=>window.qa.metadataRefresh());
  await page.evaluate(()=>window.qa.releasePage());
  await page.waitForFunction(()=>document.querySelectorAll('[data-direct-message-id]').length===200);
  const anchorAfter=await page.locator('[data-direct-message-id="'+anchor.id+'"]').evaluate(el=>el.getBoundingClientRect().top-document.getElementById('directChatMessages').getBoundingClientRect().top);
  assert.ok(Math.abs(anchorAfter-anchor.offset)<3,'live metadata during pagination moved visible message');
  await page.locator('#directChatSearch').fill('NO-SUCH-ARTICLE-999');
  await page.waitForFunction(()=>document.querySelector('#directChatHistoryStatus').textContent==='Найдено сообщений: 0'&&document.querySelector('#directChatMessages').textContent.includes('Сообщений с таким текстом не найдено.'));
  await page.locator('#directChatSearch').fill('article-old-42');
  await page.waitForFunction(()=>document.querySelectorAll('[data-direct-message-id]').length===1&&document.querySelector('#directChatHistoryStatus').textContent==='Найдено сообщений: 1');
  assert.match(await page.locator('#directChatMessages').textContent(),/ARTICLE-OLD-42/);
  await page.locator('#directChatSearchClear').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-direct-message-id]').length===240);
  assert.equal(await page.locator('#directChatLoadOlder').isHidden(),true);
  console.log('PASS history pagination and search across every page');

  await page.evaluate(()=>window.qa.close());await page.evaluate(()=>window.qa.open('peer','m010'));
  await page.waitForFunction(()=>document.querySelector('[data-direct-message-id="m010"]')?.classList.contains('direct-message-focus'));
  await page.evaluate(()=>window.qa.metadataRefresh());
  await page.waitForFunction(()=>document.querySelector('[data-direct-message-id="m010"]')?.classList.contains('direct-message-focus'));
  const target=await page.locator('[data-direct-message-id="m010"]').boundingBox(),messages=await page.locator('#directChatMessages').boundingBox();
  assert.ok(target.y>=messages.y&&target.y+target.height<=messages.y+messages.height);
  console.log('PASS old notification target loads, scrolls and retains highlight');

  await page.locator('#directChatInput').fill('Текст личного черновика');
  await page.locator('#directChatPhotoInput').setInputFiles({name:'part.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=','base64')});
  await page.locator('#directChatUrgent').check();
  await page.evaluate(()=>window.qa.close());await page.evaluate(()=>window.qa.open('other'));
  assert.equal(await page.locator('#directChatInput').inputValue(),'');
  await page.locator('#directChatInput').fill('Другой черновик');
  await page.evaluate(()=>window.qa.close());await page.evaluate(()=>window.qa.open());
  await page.waitForFunction(()=>document.querySelector('#directChatInput').value==='Текст личного черновика');
  assert.equal(await page.locator('#directChatPhotoPreview img').count(),1);
  assert.equal(await page.locator('#directChatUrgent').isChecked(),true);
  console.log('PASS real IndexedDB restores text, raw photo and urgent flag per conversation');

  await page.locator('#directChatSend').click();
  await page.waitForFunction(()=>window.qa.sendCount()===1&&document.querySelector('#directChatInput').value==='');
  assert.equal(await page.locator('#directChatPhotoPreview').isHidden(),true);
  assert.equal(await page.locator('#directChatUrgent').isChecked(),false);
  await page.evaluate(()=>window.qa.close());await page.evaluate(()=>window.qa.open());
  await page.waitForFunction(()=>document.querySelector('#directChatStatus')?.textContent!=='Черновик восстановлен.');
  assert.equal(await page.locator('#directChatInput').inputValue(),'');
  await page.evaluate(()=>window.qa.close());await page.evaluate(()=>window.qa.open('other'));
  await page.waitForFunction(()=>document.querySelector('#directChatInput').value==='Другой черновик');
  console.log('PASS successful send clears only the sent conversation draft');

  await page.locator('#directChatPhotoInput').setInputFiles({name:'other-part.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=','base64')});
  await page.locator('#directChatUrgent').check();
  await page.evaluate(()=>{window.qa.failSend=true;});await page.locator('#directChatSend').click();
  await page.waitForFunction(()=>document.querySelector('#directChatStatus').classList.contains('is-error')&&!document.querySelector('#directChatInput').disabled);
  assert.equal(await page.locator('#directChatInput').inputValue(),'Другой черновик');
  assert.equal(await page.locator('#directChatPhotoPreview img').count(),1);assert.equal(await page.locator('#directChatUrgent').isChecked(),true);
  const saved=await page.evaluate(()=>window.qa.storedDraft('other'));assert.equal(saved.text,'Другой черновик');assert.equal(saved.files.length,1);
  await page.reload();await page.waitForFunction(()=>window.qa?.ready);await page.evaluate(()=>window.qa.open('other'));
  await page.waitForFunction(()=>document.querySelector('#directChatInput').value==='Другой черновик');
  assert.equal(await page.locator('#directChatPhotoPreview img').count(),1);assert.equal(await page.locator('#directChatUrgent').isChecked(),true);
  console.log('PASS failed send retains all draft data across browser reload');

  for(const width of [1280,390,320]){
   await page.setViewportSize({width,height:844});
   const layout=await page.locator('.direct-chat-shell').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,composerVisible:document.querySelector('#directChatSend').getBoundingClientRect().bottom<=innerHeight}));
   assert.equal(layout.overflow,false,'horizontal overflow at '+width);assert.equal(layout.composerVisible,true,'composer outside screen at '+width);
  }
  await page.screenshot({path:'/tmp/direct-chat-expanded-mobile.png'});
  assert.deepEqual(errors,[],'browser exceptions');
  console.log('PASS desktop/mobile layout and no browser exceptions');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
