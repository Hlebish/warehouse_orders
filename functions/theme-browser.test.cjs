// Visual contract for the real app shell and common dialog surfaces, including
// buyback's late-injected stylesheet. Runs locally without Firebase sessions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');
const buyback=fs.readFileSync(path.join(root,'buyback.js'),'utf8');
const injectedStyles=[...buyback.matchAll(/style\.textContent\s*(?:=|\+=)\s*`([\s\S]*?)`/g)].map(match=>match[1]).join('\n');
const buybackMarkup=buyback.match(/overlay\.innerHTML=`([\s\S]*?)`;/)?.[1];assert.ok(buybackMarkup);
const form='<form id="orderForm"><div class="form-grid"><div class="field"><label>Номер заказа</label><input value="3188"></div><div class="field"><label>Клиент</label><input value="Андрей Петренко"></div><div class="field"><label>Доставка</label><select><option>Самовывоз</option></select></div><div class="field"><label>Дата</label><input type="date" value="2026-11-18"></div></div><div class="order-article-view"><b>APMA2506 · Бампер передний</b><span>2 шт.</span></div><div class="field"><label>Комментарий</label><textarea>Проверьте упаковку перед отправкой</textarea></div><div class="upload-box">Прикрепить фотографии<input type="file"></div><div class="draft-status">Черновик сохранён на этом устройстве</div></form>';
const order='<div class="order-detail-head"><div><div class="detail-number">Андрей Петренко</div><div class="detail-client">Заказ № 3188</div><div class="detail-meta">Создан сегодня · Доставка по городу</div></div><span class="status-pill status-defect">Дефект</span></div><div class="detail-actions"><button class="small-button primary-soft">Добавить комментарий</button><button class="small-button">Редактировать</button></div><div class="order-article-view article-defect-pending"><b>APMA2506 · Бампер передний</b><span>Требует решения по дефекту</span></div><div class="defect-order-lock-note">Смена статуса доступна после решения по дефекту</div><div class="detail-section-title">История заказа</div><article class="timeline-item"><div class="timeline-top"><b>Евген</b> · Сегодня, 12:45</div><div class="defect-comment-box defect-comment-pending"><b>Дефект детали</b><p>Небольшая вмятина в углу детали.</p><button class="small-button good">Одобрить дефект</button> <button class="small-button danger">Удалить позицию</button></div></article><article class="timeline-item"><div class="timeline-top">Глеб · Сегодня, 12:40</div><div class="timeline-text">Заказ собран. Ожидаем решения менеджера.</div></article>';
const directory='<div class="directory-toolbar"><label class="search-box"><input placeholder="Поиск клиента"></label><button class="primary-button">Добавить клиента</button></div><div class="directory-table-wrap"><table class="directory-table"><thead><tr><th>Клиент</th><th>Телефон</th><th>Адрес</th></tr></thead><tbody><tr><td>Андрей Петренко</td><td>+380 67 123 45 67</td><td>Днепр, ул. Центральная, 12</td></tr></tbody></table></div><p class="directory-help">Клиенты из истории заказов</p>';
const chat='<div class="direct-chat-person"><span class="staff-avatar">Е</span><div><b>Евген</b><small>В сети · Менеджер</small></div></div><div id="directChatMessages" class="chat-messages"><article class="chat-message"><b>Евген</b><p>Привет! Клиент подтвердил заказ.</p><small>12:40</small></article><article class="chat-message mine"><b>Вы</b><p>Спасибо, подготовлю к отгрузке.</p><small>✓✓ Прочитано</small></article></div><form class="chat-composer"><div class="chat-input-wrap"><textarea placeholder="Напишите сообщение…"></textarea></div><button class="primary-button">Отправить</button></form>';
async function run(){
 const {composerHtml}=await import('../chat-ui.mjs');
 const chatBody=chat.replace(/<form class="chat-composer">[\s\S]*$/,'')+composerHtml(true);
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(index.replace('</head>','<style>'+injectedStyles+'</style></head>'));return;}
  const file=path.join(root,path.basename(pathname));if(!fs.existsSync(file)){res.writeHead(204);res.end();return;}
  res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'text/plain');const content=fs.readFileSync(file,'utf8');res.end(pathname.endsWith('.css')?content.replace(/@import[^;]*;/g,''):content);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 let browser;try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin);
  await page.evaluate(()=>{document.documentElement.classList.add('app-booted');document.querySelector('.app-shell').hidden=false;document.getElementById('siteLoader').hidden=true;document.getElementById('userName').textContent='Глеб';document.getElementById('userRole').textContent='Администратор';document.getElementById('today').textContent='ср, 18 ноября';document.querySelectorAll('.stat-card strong').forEach((node,i)=>node.textContent=[12,8,3,5,2,4,1,6,2][i]);document.getElementById('ordersBody').innerHTML=['Создан','Собран','Ожидает оплаты','Одобрен на отгрузку клиенту'].map((label,i)=>'<tr><td><a class="order-number">№ '+(3188-i)+'</a><span class="client-sub">создал Евген</span></td><td><b class="client-name">'+['Андрей Петренко','ТОВ Автосервис Плюс','Виктор Коваленко','Денис Мельник'][i]+'</b><span class="client-sub">Сегодня, 12:40</span></td><td><span class="status-pill '+['status-neutral','status-assembled','status-payment','status-ready'][i]+'">'+label+'</span></td><td><span class="delivery-type-pill">Самовывоз</span></td><td>2</td><td>18 ноября</td><td>···</td></tr>').join('');});
  const inspect=()=>page.evaluate(()=>{
   const bad=[];for(const node of document.querySelectorAll('body *')){
    const box=node.getBoundingClientRect();if(!box.width||!box.height||getComputedStyle(node).visibility==='hidden'||node.closest('#siteLoader,#imageViewer,.staff-presence-backdrop,.modal-backdrop')===node)continue;
    const style=getComputedStyle(node),c=style.backgroundColor.match(/[\d.]+/g)?.map(Number);if(!c||c.length>3&&c[3]<.8)continue;
    if(Math.max(...c.slice(0,3))<85&&box.width*box.height>600)bad.push({tag:node.tagName,class:node.className,color:style.backgroundColor});
   }return bad;
  });
  const readable=()=>page.evaluate(()=>{
   const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),luma=c=>{const a=c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;},failures=[];
   for(const node of document.querySelectorAll('.stat-card .stat-label,.stat-card strong,.stat-card small,.page-heading p,.panel-heading p,.field label,.buyback-supplier-filter label,.buyback-head p,.buyback-meta,.timeline-text,.chat-composer-hint')){
    if(!node.getClientRects().length||getComputedStyle(node).visibility==='hidden')continue;
    let surface=node,bg;while(surface){bg=rgb(getComputedStyle(surface).backgroundColor);if(bg.length===3||bg[3]>.95)break;surface=surface.parentElement;}
    if(!surface)continue;const a=luma(rgb(getComputedStyle(node).color)),b=luma(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    if(ratio<4.5)failures.push({class:node.className,text:node.textContent.trim().slice(0,60),ratio:ratio.toFixed(2)});
   }return failures;
  });
  for(const width of [1440,390,320])for(const dark of [false,true]){
   await page.setViewportSize({width,height:1000});await page.evaluate(dark=>document.body.classList.toggle('dark-theme',dark),dark);await page.waitForTimeout(320);
   const metrics=await page.locator('.stat-card').evaluateAll(nodes=>nodes.map(node=>{const icon=node.querySelector('svg'),box=node.getBoundingClientRect();return {width:box.width,left:box.left,right:box.right,overflow:node.scrollWidth>node.clientWidth+1,fill:getComputedStyle(icon.querySelector('path')).fill,stroke:getComputedStyle(icon).stroke,font:parseFloat(getComputedStyle(node.querySelector('strong')).fontSize)};}));
   assert.equal(metrics.length,9);for(const m of metrics){assert.equal(m.fill,'none');assert.notEqual(m.stroke,'rgb(0, 0, 0)');assert.ok(m.font>=26);assert.equal(m.overflow,false);assert.ok(m.left>=0&&m.right<=width+1);}
   if(!dark){const bad=await inspect();assert.deepEqual(bad,[],'dark surfaces on light dashboard');assert.deepEqual(await readable(),[],'light dashboard text contrast');const bg=await page.locator('body').evaluate(node=>getComputedStyle(node).backgroundColor);assert.notEqual(bg,'rgb(255, 255, 255)');}
   if(width!==320)await page.screenshot({path:path.join(os.tmpdir(),'warehouse-theme-'+(dark?'dark':'light')+'-'+width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>document.body.classList.remove('dark-theme'));await page.waitForTimeout(320);
  for(const [title,content,kind] of [['Новый заказ',form,''],['Заказ № 3188',order,''],['Клиенты',directory,'directory-modal'],['Личный чат','<div class="direct-chat-shell">'+chatBody+'</div>','chat-dialog direct-chat-dialog']]){
   await page.evaluate(({title,content,kind})=>{document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=content;document.querySelector('#modalBackdrop>.modal').className='modal '+kind;document.getElementById('modalFoot').innerHTML='<button class="secondary-button">Закрыть</button><button class="primary-button">Сохранить</button>';document.getElementById('modalBackdrop').hidden=false;},{title,content,kind});
   await page.waitForTimeout(350);assert.deepEqual(await inspect(),[],'dark surfaces in '+title);assert.deepEqual(await readable(),[],'dialog text contrast');
   await page.screenshot({path:path.join(os.tmpdir(),'warehouse-theme-dialog-'+(kind?'chat':title.startsWith('Заказ')?'order':'form')+'.png')});
  }
  await page.evaluate(markup=>{document.getElementById('modalBackdrop').hidden=true;const overlay=document.createElement('div');overlay.className='buyback-overlay';overlay.innerHTML=markup;document.body.append(overlay);document.getElementById('buybackSummary').innerHTML='<button class="buyback-chip"><span>В работе</span><b>8</b></button>';document.getElementById('buybackList').innerHTML='<div class="buyback-supplier-groups"><section class="buyback-supplier-group"><button class="buyback-supplier-toggle">Автодетали Плюс <small>2 товара</small></button><div class="buyback-supplier-items"><div class="buyback-card"><div><b class="buyback-article">APMA2506 × 2</b><p class="buyback-meta">Бампер передний · Принят 16.11.2026</p><div class="buyback-progress"><span style="width:25%"></span></div><span class="buyback-status">В работе</span></div><div class="buyback-actions"><button>Продан</button><button class="danger">Отменить</button></div></div></div></section></div>';},buybackMarkup);
  await page.waitForTimeout(350);for(const width of [1280,390]){await page.setViewportSize({width,height:1000});assert.deepEqual(await inspect(),[],'dark surfaces in buyback '+width);await page.screenshot({path:path.join(os.tmpdir(),'warehouse-theme-buyback-'+width+'.png')});}
  assert.deepEqual(errors,[]);console.log('PASS both dashboard themes at 1440/390/320; 9 outline icons; light forms, defects, chat and buyback without dark surfaces');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}run().catch(error=>{console.error(error);process.exitCode=1;});
