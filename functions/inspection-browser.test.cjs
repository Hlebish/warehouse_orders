const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const mapLookup=app.slice(app.indexOf('const WAREHOUSE_MAP_LOOKUP_URL='),app.indexOf('async function loadWarehouseMapAddresses('));
const fixture=`
import {createInspectionItems} from '/inspection-items.mjs';
import {decorateDefectPhotoActions,photoDataUrl} from '/photo-sharing.mjs';
let role='manager',listener,failNext=false,releaseAddresses;
const calls=[],mapCalls=[],now=new Date().toISOString();
const initialAddresses=new Promise(resolve=>{releaseAddresses=resolve;});
const auth={currentUser:{getIdToken:async()=> 'test-token'}};
async function fetch(_url,{body,headers}){
 const {articles}=JSON.parse(body);
 mapCalls.push({articles,authorization:headers.Authorization});
 if(mapCalls.length===1)await initialAddresses;
 return {ok:true,json:async()=>({ok:true,results:articles.map(article=>({
  article,
  locations:article==='APMA2506'?[{address:'S1-A-1'},{address:'S3-C-8'}]:[],
  unaddressed:article==='APHD4307'
 }))})};
}
${mapLookup}
let items=[{id:'pending',article:'APMA2506',status:'pending',client:'Иван',name:'Бампер',createdAt:now,createdBy:'me',createdByName:'Евген',defects:[]},{id:'checked',article:'APHD4307',status:'checked',name:'Капот',createdAt:now,createdBy:'me',createdByName:'Евген',checkedAt:now,checkedByName:'Глеб',defects:[]}];
const emit=()=>listener?.({items:items.filter(item=>['pending','checked'].includes(item.status)),fromCache:false});
function showModal(title,body){document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=body;document.getElementById('modalBackdrop').hidden=false;}
const closeModal=()=>document.getElementById('modalBackdrop').hidden=true;
const api=createInspectionItems({watch(next){listener=next;queueMicrotask(emit);return ()=>{listener=null;};},getSession:()=>({uid:'me',role}),
 showModal,closeModal,toast:message=>window.qa.toasts.push(message),
 decoratePhotos:root=>decorateDefectPhotoActions(root,true),preparePhotoPreviews:files=>Promise.all(files.map(photoDataUrl)),getStorageAddresses:lookupWarehouseMapAddresses,getClients:()=>[{id:'client-1',name:'Иван'},...Array.from({length:20},(_,i)=>({id:'c'+i,name:'Иван '+(i+1)}))],getProducts:()=>[{article:'APAA1001',name:'Крыло левое'}],
 upload:async(id,defectId,files)=>{if(files.length>5)throw Error('Не более пяти фото');return Array.from(files,(_,i)=>'/fixture-'+i+'.jpg');},
 async manage(data){calls.push(data);await new Promise(resolve=>setTimeout(resolve,80));if(failNext){failNext=false;throw Error('Временная ошибка сохранения');}const item=items.find(i=>i.id===data.id);
  if(data.action==='create')items.push({...data,status:'pending',createdAt:now,createdBy:'me',createdByName:'Евген',defects:[]});
  if(data.action==='check')Object.assign(item,{status:'checked',checkedByName:'Глеб',checkedAt:now});
  if(data.action==='reopen')item.status='pending';
  if(data.action==='reportDefect'){item.status='pending';item.defects.push({id:data.defectId,text:data.text,photos:data.photos,authorName:'Глеб',createdAt:now,decision:''});}
  if(data.action==='decideDefect')item.defects.find(d=>d.id===data.defectId).decision='Подтверждён';
  if(data.action==='remove')item.status='removed';emit();return {id:data.id};
 }});
document.documentElement.classList.add('app-booted');document.querySelector('.app-shell').hidden=false;document.getElementById('siteLoader').hidden=true;document.getElementById('closeModal').onclick=closeModal;
window.qa={toasts:[],calls,mapCalls,releaseAddresses,role(value){role=value;emit();},fail(){failNext=true;},archive(id){items.find(i=>i.id===id).status='ordered';emit();},emit,open:api.open,ready:true};api.start();
`;
async function main(){const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://local').pathname;if(p==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(index.replace('</body>','<script type="module" src="/fixture.mjs"></script></body>'));return;}if(p==='/fixture.mjs'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fixture);return;}const file=path.join(root,path.basename(p));if(!fs.existsSync(file)){res.writeHead(204);res.end();return;}res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file,'utf8').replace(/@import[^;]*;/g,''));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'})});const page=await browser.newPage({viewport:{width:1280,height:900},hasTouch:true,reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin);await page.waitForFunction(()=>window.qa?.ready);
  assert.equal(await page.locator('#statInspectionPending').textContent(),'1');assert.equal(await page.locator('#statInspectionChecked').textContent(),'1');
  await page.locator('#inspectionPendingCard').click();await page.locator('#inspectionBoard').waitFor();assert.equal(await page.locator('[data-inspection-action="check"]').count(),0,'manager must not see warehouse checks');
  await page.locator('[data-inspection-address="APMA2506"]').getByText('Адрес: загружается').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.qa.mapCalls),[{articles:['APMA2506','APHD4307'],authorization:'Bearer test-token'}]);
  await page.evaluate(()=>{window.qa.emit();window.qa.releaseAddresses();});
  await page.locator('[data-inspection-address="APMA2506"]').getByText('S1-A-1, S3-C-8').waitFor();
  await page.locator('[data-inspection-address="APHD4307"]').getByText('Без адреса').waitFor();
  assert.equal(await page.evaluate(()=>window.qa.mapCalls.length),1,'a live redraw does not repeat lookups');
  await page.locator('#inspectionAdd').click();await page.locator('#inspectionAddForm [type="submit"]').click();assert.equal(await page.evaluate(()=>window.qa.calls.length),0,'SKU is mandatory');
  const clientInput=page.locator('#inspectionClient'),suggestions=page.locator('#inspectionClientSuggestions');
  await clientInput.focus();assert.equal(await suggestions.isVisible(),false,'empty client field must not open suggestions');
  await clientInput.fill('Иван');
  assert.equal(await suggestions.getByRole('option').count(),5);
  assert.ok((await suggestions.boundingBox()).height<=164,'client suggestions must stay compact');
  await clientInput.press('ArrowDown');await clientInput.press('ArrowDown');await clientInput.press('Enter');
  assert.equal(await clientInput.inputValue(),'Иван 1');
  assert.equal(await suggestions.isVisible(),false);
  await page.setViewportSize({width:390,height:900});
  await clientInput.fill('Иван 2');
  await suggestions.getByRole('option',{name:'Иван 2',exact:true}).tap();
  assert.equal(await clientInput.inputValue(),'Иван 2');
  assert.equal(await suggestions.isVisible(),false);
  await page.setViewportSize({width:1280,height:900});
  await clientInput.fill('ручное имя');assert.equal(await suggestions.isVisible(),false);
  await clientInput.fill('');
  await page.locator('#inspectionArticle').fill('APAA1001');await page.locator('#inspectionArticle').dispatchEvent('change');assert.equal(await page.locator('#inspectionName').inputValue(),'Крыло левое');await page.locator('#inspectionName').fill('');
  await page.locator('#inspectionAddForm [type="submit"]').click();await page.waitForFunction(()=>document.getElementById('statInspectionPending').textContent==='2');assert.equal(await page.evaluate(()=>window.qa.calls[0].client),'');
  await page.locator('[data-inspection-address="APAA1001"]').getByText('На карте не найдено').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.qa.mapCalls[1].articles),['APAA1001']);
  await page.locator('#inspectionArticle').fill('DRAFT');await page.evaluate(()=>window.qa.emit());assert.equal(await page.locator('#inspectionArticle').inputValue(),'DRAFT','live counts must preserve the draft');
  await page.evaluate(()=>window.qa.role('warehouse'));await page.locator('[data-inspection-action="check"][data-inspection-id="pending"]').click();await page.waitForFunction(()=>document.getElementById('statInspectionChecked').textContent==='2');
  await page.locator('[data-inspection-defect="pending"]').click();await page.locator('#inspectionDefectText').fill('Две вмятины на кромке');await page.locator('#inspectionDefectPhotos').setInputFiles([0,1].map(i=>({name:'defect-'+i+'.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,i,255,217])})));
  const draft=page.locator('#inspectionDefectPreview');
  await draft.locator('[data-photo-group]').getByText('Отправить 2 фото в Viber').waitFor();
  assert.equal(await draft.locator('[data-share-photo]').count(),2);
  assert.equal(await draft.locator('[data-copy-photo]').count(),2);
  assert.equal(await draft.locator('[data-share-photo-group]').count(),1);
  assert.ok(JSON.parse(await draft.locator('[data-photo-group]').getAttribute('data-photo-group')).every(url=>url.startsWith('data:image/jpeg;base64,')));
  await page.evaluate(()=>window.qa.fail());await page.locator('#inspectionDefectForm [type="submit"]').click();await page.locator('#inspectionDefectFeedback').getByText('Временная ошибка сохранения').waitFor();assert.equal(await page.locator('#inspectionDefectText').inputValue(),'Две вмятины на кромке');
  await page.locator('#inspectionDefectForm [type="submit"]').click();await page.locator('#inspectionBoard').waitFor();const savedDefect=page.locator('[data-inspection-item="pending"] .inspection-defect');
  assert.equal(await savedDefect.locator('.inspection-photos img').count(),2);
  assert.equal(await savedDefect.locator('[data-share-photo]').count(),2);
  assert.deepEqual(JSON.parse(await savedDefect.locator('[data-photo-group]').getAttribute('data-photo-group')),['/fixture-0.jpg','/fixture-1.jpg']);assert.equal(await page.locator('[data-inspection-action="check"][data-inspection-id="pending"]').isDisabled(),true);
  await page.evaluate(()=>window.qa.role('accountant'));await page.locator('[data-inspection-decision="approve"]').click();await page.waitForFunction(()=>document.querySelector('.inspection-defect.resolved'));
  await page.evaluate(()=>window.qa.role('warehouse'));await page.locator('[data-inspection-action="check"][data-inspection-id="pending"]').click();await page.waitForFunction(()=>document.querySelector('#inspectionList-checked [data-inspection-item="pending"]'));
  await page.evaluate(()=>window.qa.archive('pending'));assert.equal(await page.locator('[data-inspection-item="pending"]').count(),0);assert.equal(await page.locator('#statInspectionChecked').textContent(),'1');
  for(const width of [1280,390,320])for(const dark of [false,true]){
   await page.setViewportSize({width,height:900});await page.evaluate(dark=>document.body.classList.toggle('dark-theme',dark),dark);
   const overflow=await page.locator('#inspectionBoard').evaluate(node=>node.scrollWidth>node.clientWidth+1);
   assert.equal(overflow,false,'inspection board overflow '+width);
   const counterFill=await page.locator('.stat-created').evaluate(node=>getComputedStyle(node).backgroundColor);
   const cards=await page.locator('#inspectionPendingCard,#inspectionCheckedCard').evaluateAll(nodes=>nodes.map(node=>{
    const box=node.getBoundingClientRect();return {left:box.left,right:box.right,fill:getComputedStyle(node).backgroundColor};
   }));
   for(const card of cards){assert.ok(card.left>=0&&card.right<=width+1);assert.equal(card.fill,counterFill);}
   if(width!==320)await page.screenshot({path:path.join(os.tmpdir(),'warehouse-inspection-'+width+'-'+(dark?'dark':'light')+'.png')});
  }
  await page.locator('#closeModal').click();await page.locator('#inspectionCheckedCard').focus();await page.keyboard.press('Enter');await page.locator('#inspectionBoard').waitFor();assert.deepEqual(errors,[]);console.log('PASS inspection counters, role controls, compact client suggestions, draft and saved photo actions, defect retry/decisions, and both themes at 1280/390/320');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}}
main().catch(error=>{console.error(error);process.exitCode=1;});
