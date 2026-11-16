// Isolated browser integration check for the actual drawer markup, CSS,
// rendering and event handlers. No Firebase or production sessions are used.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const drawerStart=index.indexOf('    <div class="staff-presence-backdrop"');
const drawerEnd=index.indexOf('</aside>',drawerStart)+8;
assert.ok(drawerStart>=0&&drawerEnd>drawerStart,'Drawer markup must be present');
const drawer=index.slice(drawerStart,drawerEnd);
const application=[between('function presenceLastSeenLabel(', 'async function loadStaffDirectory('),between('function isStaffPanelDesktopLayout(',"document.addEventListener('focusin',")].join('\n');
const fixture=`
import * as model from '/staff-conversations.mjs';
Object.assign(window,model);
const $=id=>document.getElementById(id),modal=$('modalBackdrop');
const signedInUser={uid:'me'},state={notices:[],orders:[],role:'warehouse'};
const directChatTarget=null,staffPresence=new Map(),staffDirectory=new Map(),directThreads=new Map();
let staffDirectoryLoadError=false,directThreadsLoadError=false,directThreadsErrorCode='';
let staffDrawerSearch='',staffDrawerUnreadOnly=false,staffDrawerItems=[],directChatOpenRequest=0;
const roles={warehouse:'Кладовщик',manager:'Менеджер',accountant:'Бухгалтер'};
const resolveDirectChatPeer=async uid=>staffDirectory.get(uid);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const asDate=value=>value?.toDate?.()||new Date(value||0),fmtDateTime=value=>asDate(value).toLocaleString('ru-RU');
const flagOn=(n,key)=>n?.[key]===true||n?.[key]==='true'||n?.[key]===1;
const isMentionNotice=n=>!n?.directChatThreadId&&flagOn(n,'isMention');
const urgentDirectAlertCache=new Map(),openedUrgentNoticeIds=new Set();
const syncUrgentDirectTrayItem=()=>{},isUrgentNoticeHidden=()=>true,openUrgentDirectNotice=()=>{};
const markNotificationItemsRead=async notices=>{notices.forEach(n=>n.read=true);return {failed:0};};
const openMentionNotice=notice=>window.qa.opened.push({kind:'notice',notice});
function showNotifications(){window.qa.opened.push({kind:'notifications'});openStaffPanel(false);}
async function openDirectChat(person,threadId='',messageId=''){window.qa.opened.push({kind:'chat',uid:person.uid,threadId,messageId});openStaffPanel(false);}
const profiles=[
 {uid:'me',displayName:'Мой профиль',role:'warehouse',roleLabel:'Кладовщик',active:true},
 {uid:'alice',displayName:'Алиса',role:'manager',roleLabel:'Менеджер',active:true},
 {uid:'bob',displayName:'Борис',role:'warehouse',roleLabel:'Кладовщик',active:true},
 {uid:'carol',displayName:'Сотрудник с очень длинным именем для проверки переноса',role:'accountant',roleLabel:'Бухгалтер',active:true},
 {uid:'disabled',displayName:'Отключённый сотрудник',role:'warehouse',active:false}
];
profiles.forEach(person=>staffDirectory.set(person.uid,person));
staffPresence.set('alice',{active:true,updatedAt:Date.now(),activity:'В приложении'});
staffPresence.set('bob',{active:true,updatedAt:Date.now()-4*60*60*1000});
staffPresence.set('carol',{active:true,updatedAt:Date.now()-3*86400000});
directThreads.set('alice__me',{id:'alice__me',participants:['alice','me'],lastMessage:'Проверьте артикул ALICE-42',lastSenderId:'alice',lastMessageAt:new Date(Date.now()-60000)});
directThreads.set('bob__me',{id:'bob__me',participants:['bob','me'],lastMessage:'Отправлено со склада',lastSenderId:'me',lastMessageAt:new Date(Date.now()-120000)});
directThreads.set('carol__me',{id:'carol__me',participants:['carol','me'],lastMessage:'Документы по заказу №12345 готовы',lastSenderId:'carol',lastMessageAt:new Date(Date.now()-3*86400000)});
state.notices=[{id:'alice-1',authorId:'alice',directChatThreadId:'alice__me',directMessageId:'message-42',message:'Ещё одно сообщение',createdAt:new Date(Date.now()-60000),read:false},{id:'alice-2',authorId:'alice',directChatThreadId:'alice__me',directMessageId:'message-43',message:'Проверьте артикул ALICE-42',createdAt:new Date(Date.now()-50000),read:false}];
window.qa={opened:[],workspaceClicks:0,underlyingModalCloses:0};
${application}
// The full app has a later Escape listener for modal dialogs. The drawer must
// consume its own Escape before that listener can close an underlying form.
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden){window.qa.underlyingModalCloses++;modal.hidden=true;}});
Object.assign(window.qa,{ready:true,render:()=>renderStaffPanel(),open:()=>openStaffPanel(true),close:()=>openStaffPanel(false),
 openBeforeAnimationFrame(){const raf=window.requestAnimationFrame,callbacks=[];window.requestAnimationFrame=callback=>{callbacks.push(callback);return 0;};try{openStaffPanel(true);}finally{window.requestAnimationFrame=raf;}window.qa.finishFrames=()=>callbacks.forEach(callback=>callback(performance.now()));},
 clearUnread(){state.notices.forEach(n=>n.read=true);renderStaffPanel();},
 reset(){state.notices.forEach(n=>n.read=false);staffPresence.set('alice',{active:true,updatedAt:Date.now(),activity:'В приложении'});window.qa.opened=[];renderStaffPanel();},
 addMany(){for(let i=0;i<45;i++)staffDirectory.set('contact-'+i,{uid:'contact-'+i,displayName:'Контакт '+String(i).padStart(2,'0'),role:'warehouse',roleLabel:'Кладовщик',active:true});renderStaffPanel();},
 updatePresence(uid,time){staffPresence.set(uid,{active:true,updatedAt:time});renderStaffPanel();}
});
$('workAction').addEventListener('click',()=>window.qa.workspaceClicks++);
renderStaffPanel();
`;

async function main(){
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/qa.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fixture);return;}
  if(pathname==='/'){
   res.setHeader('Content-Type','text/html; charset=utf-8');
   res.end('<!doctype html><html class="app-booted"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>*{animation:none!important;transition:none!important;scroll-behavior:auto!important}</style></head><body class="dark-theme"><div class="app-shell"><aside class="sidebar">Склад</aside>'+drawer+'<main class="main-area"><header class="topbar"><button id="staffPresenceToggle" type="button" aria-expanded="false">Сообщения <i id="staffPresenceBadge">0</i></button></header><div class="content"><button id="workAction">Действие в заказе</button><div class="table-wrap"><table><thead><tr><th>Заказ</th><th>Клиент</th><th>Статус</th></tr></thead><tbody><tr><td>12345</td><td>Клиент</td><td>Создан</td></tr></tbody></table></div></div></main><div id="modalBackdrop" class="modal-backdrop" hidden><section class="modal"><span id="modalEyebrow">НОВЫЙ ЗАКАЗ</span><textarea id="orderDraft">Сохранённый текст заказа</textarea></section></div><div id="toastStack"></div></div><script type="module" src="/qa.js"></script></body></html>');return;
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
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  await page.goto(url);await page.waitForFunction(()=>window.qa?.ready);
  await page.waitForFunction(()=>document.querySelectorAll('[data-staff-message-id]').length>=3);
  const mainBox=()=>page.locator('.main-area').boundingBox();
  const tableBox=()=>page.locator('table').boundingBox();
  function sameBox(a,b,label){for(const key of ['x','y','width','height'])assert.ok(Math.abs(a[key]-b[key])<1,label+' '+key+' changed from '+a[key]+' to '+b[key]);}
  const checkOpen=()=>page.waitForFunction(()=>document.getElementById('staffPresencePanel').classList.contains('open'));
  const checkClosed=()=>page.waitForFunction(()=>!document.getElementById('staffPresencePanel').classList.contains('open'));

  // Parent supplies the final row identity; Write controls are retained from
  // the existing app and provide a stable way to locate each employee.
  const row=id=>page.locator('.staff-conversation-row[data-staff-conversation-id="'+id+'"]');
  const report=[];
  for(const width of [1280,900,720,390,320])for(const dark of [true,false])for(const native of [false,true]){
   await page.evaluate(({dark,native})=>{document.body.classList.toggle('dark-theme',dark);document.documentElement.classList.toggle('warehouse-desktop-app',native);window.qa.close();},{dark,native});
   await page.setViewportSize({width,height:900});
   const before=await mainBox(),beforeTable=await tableBox();
   await page.locator('#staffPresenceExpand').click();await checkOpen();
   sameBox(before,await mainBox(),'main '+width+'/'+dark+'/'+native);sameBox(beforeTable,await tableBox(),'table '+width+'/'+dark+'/'+native);
   const bounds=await page.locator('#staffPresencePanel').boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,'drawer outside viewport at '+width);
   const overflow=await page.locator('#staffPresencePanel').evaluate(e=>e.scrollWidth>e.clientWidth);assert.equal(overflow,false,'drawer horizontal overflow');
   await page.locator('#staffPresenceClose').click();await checkClosed();sameBox(before,await mainBox(),'main after close');
   report.push({width,dark,native});
  }
  console.log('PASS fixed overlay preserves workspace and table at all 20 viewport/theme/native combinations');

  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{document.documentElement.classList.remove('warehouse-desktop-app');window.qa.reset();window.qa.close();});
  await page.locator('[data-staff-rail-id="alice"]').click();await checkOpen();assert.equal(await page.evaluate(()=>window.qa.opened.length),0,'collapsed avatar opened a chat');
  await page.locator('#staffPresenceClose').click();await checkClosed();
  const rail=await page.locator('#staffPresencePanel').boundingBox();await page.mouse.click(rail.x+rail.width/2,rail.y+rail.height-24);await checkOpen();assert.equal(await page.evaluate(()=>window.qa.opened.length),0,'empty rail opened a chat');
  await page.locator('#staffPresenceClose').click();await checkClosed();await page.locator('#staffPresencePanel').focus();await page.keyboard.press('Space');await checkOpen();
  console.log('PASS avatar and empty collapsed rail both expand without opening chat');

  assert.equal(await page.locator('[data-staff-message-id="me"]').count(),0,'own profile duplicated as contact');
  assert.equal(await page.locator('[data-staff-message-id="alice"]').count(),1);assert.equal(await page.locator('[data-staff-message-id="bob"]').count(),1);assert.equal(await page.locator('[data-staff-message-id="carol"]').count(),1);
  assert.equal(await page.locator('#staffInboxList').count(),0,'old split inbox remains');assert.equal(await page.locator('#staffPresenceCount').count(),0,'old split online section remains');
  assert.match(await row('alice').textContent(),/ALICE-42/);assert.match(await row('alice').textContent(),/В сети/);assert.match(await row('bob').textContent(),/Был\(а\) в сети/);
  await page.locator('[data-staff-open-id="alice"]').click();await checkClosed();
  assert.deepEqual(await page.evaluate(()=>window.qa.opened.at(-1)),{kind:'chat',uid:'alice',threadId:'alice__me',messageId:'message-43'});
  await page.evaluate(()=>window.qa.reset());await page.locator('#staffPresenceExpand').click();await checkOpen();
  await page.locator('#staffDirectorySearch').fill('ALICE-42');assert.equal(await page.locator('[data-staff-message-id]').count(),1);
  await page.locator('#staffDirectorySearch').fill('');await page.locator('#staffFilterUnread').click();assert.equal(await page.locator('[data-staff-message-id]').count(),1);
  await page.evaluate(()=>window.qa.clearUnread());assert.equal(await page.locator('[data-staff-message-id]').count(),0);assert.equal(await page.locator('#staffPresenceRailCount').isHidden(),true);assert.equal(await page.locator('#staffUrgentSection').isHidden(),true);await page.locator('#staffFilterAll').click();assert.equal(await page.locator('[data-staff-message-id]').count(),3);
  await page.locator('[data-staff-message-id="bob"]').click();await checkClosed();assert.equal(await page.evaluate(()=>window.qa.opened.at(-1).uid),'bob');
  console.log('PASS unified contacts, presence, previews, search, unread filter and Write');

  await page.locator('#staffPresenceExpand').focus();await page.keyboard.press('Enter');await checkOpen();assert.equal(await page.locator('#staffPresenceExpand').getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');await checkClosed();assert.equal(await page.locator('#staffPresenceExpand').getAttribute('aria-expanded'),'false');
  await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceExpand');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'staffPresenceExpand','Escape did not restore the opening control');
  await page.locator('#staffPresenceExpand').click();await checkOpen();const work=await page.locator('#workAction').boundingBox();const clicks=await page.evaluate(()=>window.qa.workspaceClicks);await page.mouse.click(work.x+5,work.y+5);await checkClosed();assert.equal(await page.evaluate(()=>window.qa.workspaceClicks),clicks,'backdrop click reached workspace action');
  await page.waitForFunction(()=>document.getElementById('staffPresenceBackdrop').hidden);await page.locator('#workAction').click();assert.equal(await page.evaluate(()=>window.qa.workspaceClicks),clicks+1);
  await page.evaluate(()=>window.qa.openBeforeAnimationFrame());await checkOpen();await page.mouse.click(work.x+5,work.y+5);await checkClosed();assert.equal(await page.evaluate(()=>window.qa.workspaceClicks),clicks+1,'first-frame outside click reached workspace action');await page.evaluate(()=>window.qa.finishFrames());
  await page.evaluate(()=>{document.getElementById('modalBackdrop').hidden=false;window.qa.open();});await checkOpen();await page.keyboard.press('Escape');await checkClosed();
  assert.equal(await page.evaluate(()=>window.qa.underlyingModalCloses),0,'drawer Escape closed the underlying modal');assert.equal(await page.locator('#orderDraft').inputValue(),'Сохранённый текст заказа');await page.evaluate(()=>document.getElementById('modalBackdrop').hidden=true);
  console.log('PASS keyboard expansion, Escape and outside close without workspace click-through');
  await page.evaluate(()=>{window.qa.addMany();window.qa.open();});await checkOpen();
  await page.waitForFunction(()=>document.activeElement?.id==='staffDirectorySearch');
  const anchor=await page.locator('.staff-panel-scroll').evaluate(scroll=>{scroll.scrollTop=700;const bounds=scroll.getBoundingClientRect();const target=[...scroll.querySelectorAll('[data-staff-open-id]')].find(node=>{const box=node.getBoundingClientRect();return box.top>=bounds.top&&box.bottom<=bounds.bottom;});target.focus({preventScroll:true});return {uid:target.dataset.staffOpenId,top:scroll.scrollTop,header:document.querySelector('.staff-panel-header').getBoundingClientRect().top};});
  await page.evaluate(()=>window.qa.updatePresence('alice',Date.now()));
  const refreshed=await page.locator('.staff-panel-scroll').evaluate(scroll=>({uid:document.activeElement.dataset.staffOpenId,top:scroll.scrollTop,header:document.querySelector('.staff-panel-header').getBoundingClientRect().top}));
  assert.equal(refreshed.uid,anchor.uid,'presence refresh lost focused employee');assert.ok(Math.abs(refreshed.top-anchor.top)<2,'presence refresh moved list scroll');assert.ok(Math.abs(refreshed.header-anchor.header)<1,'list scrolling moved drawer header');
  console.log('PASS live presence refresh preserves focused contact, scroll and sticky header');
  await page.evaluate(()=>{window.qa.reset();document.querySelector('.staff-panel-scroll').scrollTop=0;});await page.setViewportSize({width:390,height:844});await checkOpen();await page.screenshot({path:'/tmp/staff-drawer-mobile.png'});
  assert.deepEqual(errors,[],'browser exceptions');console.log('PASS no browser errors');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
