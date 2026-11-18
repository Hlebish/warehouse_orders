// Isolated browser integration check for the actual drawer markup, CSS,
// rendering and event handlers. No Firebase or production sessions are used.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
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
const mainStart=index.indexOf('    <main class="main-area">'),mainEnd=index.indexOf('</main>',mainStart)+7;
assert.ok(mainStart>=0&&mainEnd>mainStart,'Actual orders workspace markup must be present');
const workspace=index.slice(mainStart,mainEnd).replace('<section class="content">','<section class="content"><button id="workAction" type="button">Действие в заказе</button>');
const application=[between('function presenceLastSeenLabel(', 'async function loadStaffDirectory('),between('function isStaffPanelDesktopLayout(',"document.addEventListener('focusin',")].join('\n');
const fixture=`
import * as model from '/staff-conversations.mjs';
Object.assign(window,model);
const $=id=>document.getElementById(id),modal=$('modalBackdrop');
if(/WarehouseOrdersAndroid/.test(navigator.userAgent))document.documentElement.classList.add('android-warehouse');
if($('today'))$('today').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'long'}).format(new Date());
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
   res.end('<!doctype html><html class="app-booted"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style id="qaNoMotion">[hidden]{display:none!important}*{animation:none!important;transition:none!important;scroll-behavior:auto!important}</style></head><body class="dark-theme"><div class="app-shell"><aside class="sidebar">Склад</aside>'+drawer+workspace+'<div id="modalBackdrop" class="modal-backdrop" hidden><section class="modal"><span id="modalEyebrow">НОВЫЙ ЗАКАЗ</span><textarea id="orderDraft">Сохранённый текст заказа</textarea></section></div><div id="toastStack"></div></div><script type="module" src="/qa.js"></script></body></html>');return;
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
  await page.waitForFunction(()=>document.querySelectorAll('[data-staff-message-id]').length>=3);
  const mainBox=()=>page.locator('.main-area').boundingBox();
  const tableBox=()=>page.locator('table').boundingBox();
  function sameBox(a,b,label){for(const key of ['x','y','width','height'])assert.ok(Math.abs(a[key]-b[key])<1,label+' '+key+' changed from '+a[key]+' to '+b[key]);}
  const checkOpen=()=>page.waitForFunction(()=>document.getElementById('staffPresencePanel').classList.contains('open'));
  const checkClosed=()=>page.waitForFunction(()=>!document.getElementById('staffPresencePanel').classList.contains('open'));
  const checkNoneditableFocus=async()=>assert.equal(await page.evaluate(()=>document.activeElement?.matches('input,textarea,[contenteditable="true"]')),false,'opening the drawer focused an editable field');

  // Parent supplies the final row identity; Write controls are retained from
  // the existing app and provide a stable way to locate each employee.
  const row=id=>page.locator('.staff-conversation-row[data-staff-conversation-id="'+id+'"]');
  const report=[];
  for(const width of [1280,900,720,390,320])for(const dark of [true,false])for(const native of [false,true]){
   await page.evaluate(({dark,native})=>{document.body.classList.toggle('dark-theme',dark);document.documentElement.classList.toggle('warehouse-desktop-app',native);window.qa.close();},{dark,native});
   await page.setViewportSize({width,height:900});
   const mobile=width<=720,opener=mobile?'staffPresenceToggle':'staffPresenceExpand';
   assert.equal(await page.locator('#staffPresencePanel').isHidden(),mobile,'collapsed mobile rail must be absent');
   const collision=await page.evaluate(()=>{
    const panel=document.getElementById('staffPresencePanel'),rail=panel.getBoundingClientRect(),shown=panel.getClientRects().length>0&&getComputedStyle(panel).visibility!=='hidden';
    const targets=[...document.querySelectorAll('.topbar button,.stat-card,.orders-panel .list-controls button,.orders-panel .list-controls input')].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
    const outside=[],overlap=[];
    for(const node of targets){const a=node.getBoundingClientRect(),name=node.id||node.getAttribute('data-stat-key')||node.className;if(a.left<-.5||a.right>innerWidth+.5)outside.push({name,left:a.left,right:a.right});if(shown&&a.left<rail.right&&a.right>rail.left&&(node.closest('.content')||(a.top<rail.bottom&&a.bottom>rail.top)))overlap.push({name,control:a.toJSON(),rail:rail.toJSON()});}
    const content=document.querySelector('.content').getBoundingClientRect();
    return {outside,overlap,main:document.querySelector('.main-area').getBoundingClientRect().toJSON(),content:content.toJSON()};
   });
   if(collision.overlap.length||collision.outside.length){console.log('COLLISION',JSON.stringify({width,dark,native,collision}));await page.screenshot({path:path.join(os.tmpdir(),'staff-drawer-collision.png')});}
   assert.deepEqual(collision.overlap,[],'collapsed rail covers workspace controls at '+width+'/'+native);
   assert.deepEqual(collision.outside,[],'workspace controls outside viewport at '+width+'/'+native);
   if(mobile){assert.ok(Math.abs(collision.main.width-width)<1,'mobile workspace lost width to a rail gutter');assert.ok(collision.content.right<=width+1,'mobile content exceeds viewport');}
   const before=await mainBox(),beforeTable=await tableBox();
   await page.locator('#'+opener).click();await checkOpen();await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceClose');await checkNoneditableFocus();
   sameBox(before,await mainBox(),'main '+width+'/'+dark+'/'+native);sameBox(beforeTable,await tableBox(),'table '+width+'/'+dark+'/'+native);
   const bounds=await page.locator('#staffPresencePanel').boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,'drawer outside viewport at '+width);
   const overflow=await page.locator('#staffPresencePanel').evaluate(e=>e.scrollWidth>e.clientWidth);assert.equal(overflow,false,'drawer horizontal overflow');
   await page.locator('#staffPresenceClose').click();await checkClosed();sameBox(before,await mainBox(),'main after close');
   report.push({width,dark,native});
  }
  console.log('PASS real workspace controls and stats are uncovered; overlay preserves layout with no autofocus keyboard at all 20 viewport/theme/native combinations');

  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{document.documentElement.classList.remove('warehouse-desktop-app');window.qa.reset();window.qa.close();});
  await page.locator('[data-staff-rail-id="alice"]').click();await checkOpen();assert.equal(await page.evaluate(()=>window.qa.opened.length),0,'collapsed avatar opened a chat');
  await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceClose');await checkNoneditableFocus();
  await page.locator('#staffPresenceClose').click();await checkClosed();
  const rail=await page.locator('#staffPresencePanel').boundingBox();await page.mouse.click(rail.x+rail.width/2,rail.y+rail.height-24);await checkOpen();assert.equal(await page.evaluate(()=>window.qa.opened.length),0,'empty rail opened a chat');
  await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceClose');await checkNoneditableFocus();
  await page.locator('#staffPresenceClose').click();await checkClosed();await page.locator('#staffPresencePanel').focus();await page.keyboard.press('Space');await checkOpen();
  await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceClose');await checkNoneditableFocus();
  console.log('PASS avatar and empty collapsed rail both expand without opening chat');

  assert.equal(await page.locator('[data-staff-message-id="me"]').count(),0,'own profile duplicated as contact');
  assert.equal(await page.locator('[data-staff-message-id="alice"]').count(),1);assert.equal(await page.locator('[data-staff-message-id="bob"]').count(),1);assert.equal(await page.locator('[data-staff-message-id="carol"]').count(),1);
  assert.equal(await page.locator('#staffInboxList').count(),0,'old split inbox remains');assert.equal(await page.locator('#staffPresenceCount').count(),0,'old split online section remains');
  assert.match(await row('alice').textContent(),/ALICE-42/);assert.match(await row('alice').textContent(),/В сети/);assert.match(await row('bob').textContent(),/Был\(а\) в сети/);
  await page.locator('[data-staff-open-id="alice"]').click();await checkClosed();
  assert.deepEqual(await page.evaluate(()=>window.qa.opened.at(-1)),{kind:'chat',uid:'alice',threadId:'alice__me',messageId:'message-43'});
  await page.evaluate(()=>window.qa.reset());await page.locator('#staffPresenceExpand').click();await checkOpen();
  await page.locator('#staffDirectorySearch').click();assert.equal(await page.evaluate(()=>document.activeElement?.id),'staffDirectorySearch','explicit search tap must focus the search input');
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
  await page.evaluate(()=>window.qa.openBeforeAnimationFrame());await checkOpen();await checkNoneditableFocus();await page.mouse.click(work.x+5,work.y+5);await checkClosed();assert.equal(await page.evaluate(()=>window.qa.workspaceClicks),clicks+1,'first-frame outside click reached workspace action');await page.evaluate(()=>window.qa.finishFrames());
  await page.evaluate(()=>{document.getElementById('modalBackdrop').hidden=false;window.qa.open();});await checkOpen();await page.keyboard.press('Escape');await checkClosed();
  assert.equal(await page.evaluate(()=>window.qa.underlyingModalCloses),0,'drawer Escape closed the underlying modal');assert.equal(await page.locator('#orderDraft').inputValue(),'Сохранённый текст заказа');await page.evaluate(()=>document.getElementById('modalBackdrop').hidden=true);
  console.log('PASS keyboard expansion, Escape and outside close without workspace click-through');
  await page.evaluate(()=>{window.qa.addMany();window.qa.open();});await checkOpen();
  await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceClose');await checkNoneditableFocus();
  const anchor=await page.locator('.staff-panel-scroll').evaluate(scroll=>{scroll.scrollTop=700;const bounds=scroll.getBoundingClientRect();const target=[...scroll.querySelectorAll('[data-staff-open-id]')].find(node=>{const box=node.getBoundingClientRect();return box.top>=bounds.top&&box.bottom<=bounds.bottom;});target.focus({preventScroll:true});return {uid:target.dataset.staffOpenId,top:scroll.scrollTop,header:document.querySelector('.staff-panel-header').getBoundingClientRect().top};});
  await page.evaluate(()=>window.qa.updatePresence('alice',Date.now()));
  const refreshed=await page.locator('.staff-panel-scroll').evaluate(scroll=>({uid:document.activeElement.dataset.staffOpenId,top:scroll.scrollTop,header:document.querySelector('.staff-panel-header').getBoundingClientRect().top}));
  assert.equal(refreshed.uid,anchor.uid,'presence refresh lost focused employee');assert.ok(Math.abs(refreshed.top-anchor.top)<2,'presence refresh moved list scroll');assert.ok(Math.abs(refreshed.header-anchor.header)<1,'list scrolling moved drawer header');
  console.log('PASS live presence refresh preserves focused contact, scroll and sticky header');
  await page.evaluate(()=>{window.qa.reset();document.querySelector('.staff-panel-scroll').scrollTop=0;window.qa.close();document.getElementById('workAction').hidden=true;});await page.setViewportSize({width:390,height:844});await checkClosed();assert.equal(await page.locator('#staffPresencePanel').isHidden(),true);await page.locator('#staffPresenceToggle').click();await checkOpen();await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceClose');await checkNoneditableFocus();await page.keyboard.press('Escape');await checkClosed();await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceToggle');await page.screenshot({path:path.join(os.tmpdir(),'staff-drawer-mobile-collapsed.png')});await page.locator('#staffPresenceToggle').click();await checkOpen();await page.waitForFunction(()=>document.activeElement?.id==='staffPresenceClose');await checkNoneditableFocus();await page.screenshot({path:path.join(os.tmpdir(),'staff-drawer-mobile.png')});
  const androidContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36 WarehouseOrdersAndroid'});
  const android=await androidContext.newPage();android.on('pageerror',error=>errors.push(error.message));await android.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());await android.goto(url);await android.waitForFunction(()=>window.qa?.ready);
  await android.evaluate(()=>document.getElementById('workAction').hidden=true);
  for(const dark of [true,false]){
   await android.evaluate(dark=>{document.body.classList.toggle('dark-theme',dark);window.qa.close();},dark);
   assert.equal(await android.locator('#staffPresencePanel').isHidden(),true,'Android collapsed rail remains visible');
   const outside=await android.evaluate(()=>[...document.querySelectorAll('.topbar button,.stat-card')].filter(node=>node.getClientRects().length).map(node=>({id:node.id||node.getAttribute('data-stat-key'),box:node.getBoundingClientRect()})).filter(({box})=>box.left<-.5||box.right>innerWidth+.5).map(({id})=>id));assert.deepEqual(outside,[],'Android controls or stats outside viewport');
   if(dark)await android.screenshot({path:path.join(os.tmpdir(),'staff-drawer-android-collapsed.png')});
   await android.locator('#staffPresenceToggle').tap();await android.waitForFunction(()=>document.activeElement?.id==='staffPresenceClose');assert.equal(await android.evaluate(()=>document.activeElement?.matches('input,textarea,[contenteditable="true"]')),false,'Android opening would summon the keyboard');
   if(dark)await android.screenshot({path:path.join(os.tmpdir(),'staff-drawer-android-open.png')});
   await android.locator('#staffDirectorySearch').tap();assert.equal(await android.evaluate(()=>document.activeElement?.id),'staffDirectorySearch','Android explicit search tap did not focus input');await android.locator('#staffPresenceClose').tap();await android.waitForFunction(()=>document.activeElement?.id==='staffPresenceToggle');
  }
  await androidContext.close();console.log('PASS Android touch/DPR3 has clear stats and messages control, no automatic editable focus, and explicit search tap works');
  // Leave animations enabled here: sample real CSS transitions at fixed times,
  // including the first frame. Content must translate without changing layout.
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const width of [1280,390])for(const dark of [false,true]){
   await page.setViewportSize({width,height:844});
   const samples=await page.evaluate(dark=>{
    document.body.classList.toggle('dark-theme',dark);window.qa.close();
    const guard=document.getElementById('qaNoMotion');void document.getElementById('staffPresenceContent').getBoundingClientRect();guard.sheet.disabled=true;
    const layer=document.getElementById('staffPresenceContent');
    void layer.getBoundingClientRect();window.qa.open();void layer.getBoundingClientRect();
    const opening=layer.getAnimations().find(animation=>animation.transitionProperty==='transform');
    if(!opening)throw Error('Drawer has no opening slide transition');
    const measure=()=>{
     const box=layer.getBoundingClientRect(),heading=layer.querySelector('.staff-panel-header').getBoundingClientRect(),row=layer.querySelector('.staff-conversation-row').getBoundingClientRect();
     return {x:box.x,width:box.width,height:box.height,headingWidth:heading.width,headingHeight:heading.height,rowWidth:row.width,rowHeight:row.height,rowOffset:row.x-box.x,scrollWidth:document.documentElement.scrollWidth};
    };
    opening.pause();const enter=[0,70,140,280].map(time=>{opening.currentTime=time;return measure();});opening.finish();
    window.qa.close();void layer.getBoundingClientRect();
    const closing=layer.getAnimations().find(animation=>animation.transitionProperty==='transform');
    if(!closing)throw Error('Drawer has no closing slide transition');
    closing.pause();const exit=[0,70,140,280].map(time=>{closing.currentTime=time;return measure();});closing.finish();guard.sheet.disabled=false;
    return {enter,exit};
   },dark);
   const reference=samples.enter.at(-1);
   for(const frame of [...samples.enter,...samples.exit]){
    for(const key of ['width','height','headingWidth','headingHeight','rowWidth','rowHeight','rowOffset'])assert.ok(Math.abs(frame[key]-reference[key])<.1,'drawer content reflows during animation: '+key+'/'+width+'/'+dark);
    assert.ok(frame.scrollWidth<=width+1,'offscreen drawer creates horizontal page scrolling');
   }
   assert.ok(samples.enter[0].x>=width,'drawer does not start beyond the screen');assert.ok(reference.x<width-reference.width+1,'drawer does not finish inside screen');
   assert.ok(samples.enter[0].x>samples.enter[1].x&&samples.enter[1].x>samples.enter[2].x&&samples.enter[2].x>reference.x,'opening does not slide left');
   assert.ok(samples.exit[0].x<samples.exit[1].x&&samples.exit[1].x<samples.exit[2].x&&samples.exit[2].x<samples.exit[3].x,'closing does not slide right');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await page.evaluate(()=>{document.getElementById('qaNoMotion').sheet.disabled=true;window.qa.open();const layer=document.getElementById('staffPresenceContent'),box=layer.getBoundingClientRect();return {animations:layer.getAnimations().length,inside:box.x>=0&&box.right<=innerWidth};});
  assert.equal(reduced.animations,0);assert.equal(reduced.inside,true);
  console.log('PASS opening/closing move a full-width surface without text reflow, horizontal overflow or motion when reduced motion is enabled');
  assert.deepEqual(errors,[],'browser exceptions');console.log('PASS no browser errors');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
