const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>value?.toDate?.()||new Date(value||0);
const date=value=>{const d=time(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});};
const key=value=>String(value||'').trim().toLocaleUpperCase('ru').replace(/\s+/g,'');
const addressLoading='📍 Адрес: загружается…';
const addressUnavailable='📍 Адрес временно недоступен';
const pendingDefects=item=>(item.defects||[]).filter(defect=>!defect.decision);
export function createInspectionItems({watch,manage,upload,getSession,showModal,closeModal,toast,getStorageAddresses,getClients=()=>[],getProducts=()=>[],decoratePhotos=()=>{},preparePhotoPreviews}){
 const $=id=>document.getElementById(id);let items=[],stop=null,userId='',loaded=false,error='',sending=false;
 const addressesByBoard=new WeakMap();
 function counters(){
  for(const status of ['pending','checked']){const node=$(status==='pending'?'statInspectionPending':'statInspectionChecked');if(node)node.textContent=error?'—':loaded||items.length?String(items.filter(item=>item.status===status).length):'…';}
  const node=$('statInspectionDefects');
  if(node){
   const count=items.reduce((sum,item)=>sum+pendingDefects(item).length,0);
   const value=error?'—':loaded||items.length?String(count):'…';
   if(node.textContent!==value)node.textContent=value;
   node.toggleAttribute('data-active',Number(value)>0);
  }
 }
 function permissions(){const session=getSession()||{};return {...session,warehouse:session.admin||session.role==='warehouse'||session.role==='director',manager:session.admin||['manager','accountant','chief_accountant','director'].includes(session.role)};}
 function defectPhotosHtml(photos,article){
  if(!photos?.length)return '';
  const context=escape('Фото дефекта · '+article);
  return `<div class="inspection-photos">${photos.map((url,index)=>`<div class="order-photo-share">
   <button type="button" class="inspection-photo-open" data-photo="${escape(url)}" aria-label="Открыть фото дефекта ${index+1}"><img src="${escape(url)}" alt="Фото дефекта ${index+1}" data-photo="${escape(url)}" loading="lazy"></button>
   <button type="button" class="small-button primary-soft" data-viber-photo="${escape(url)}" data-viber-context="${context}">Отправить в Viber</button>
  </div>`).join('')}</div>`;
 }
 function defectHtml(item,defect){const p=permissions();return `<div class="inspection-defect ${defect.decision?'resolved':''}"><div class="inspection-defect-heading"><b>⚠ Дефект</b><span>${defect.decision?'Одобрен':'Ожидает решения'}</span></div><p>${escape(defect.text)}</p>${defectPhotosHtml(defect.photos,item.article)}<small>${escape(defect.authorName)} · ${escape(date(defect.createdAt))}</small>${!defect.decision&&p.manager?`<div class="inspection-actions"><button type="button" class="small-button good" data-inspection-decision="approve" data-inspection-id="${escape(item.id)}" data-defect-id="${escape(defect.id)}">Одобрить дефект</button><button type="button" class="small-button danger" data-inspection-decision="cancel" data-inspection-id="${escape(item.id)}" data-defect-id="${escape(defect.id)}">Снять с проверки</button></div>`:''}</div>`;}
 function itemHtml(item,addresses,defectsOnly=false){
  const p=permissions(),pending=(item.defects||[]).some(d=>!d.decision);
  const article=String(item.article||'').trim();
  const address=article?`<small class="warehouse-map-address" data-inspection-address="${escape(article)}">${escape(addresses.get(article)||addressLoading)}</small>`:'';
  const actions=defectsOnly?'':`<div class="inspection-actions">${p.warehouse?`${item.status==='pending'?`<button type="button" class="small-button good" data-inspection-action="check" data-inspection-id="${escape(item.id)}" ${pending?'disabled title="Сначала необходимо решение по дефекту"':''}>✓ Проверено</button>`:`<button type="button" class="small-button" data-inspection-action="reopen" data-inspection-id="${escape(item.id)}">Вернуть на проверку</button>`}<button type="button" class="small-button danger" data-inspection-defect="${escape(item.id)}" ${pending?'disabled':''}>Добавить дефект</button>`:''}${p.manager||p.uid===item.createdBy?`<button type="button" class="small-button" data-inspection-remove="${escape(item.id)}">Снять с проверки</button>`:''}</div>`;
  return `<article class="inspection-item ${pending?'has-defect':''}" data-inspection-item="${escape(item.id)}"><div class="inspection-item-heading"><div><b>${escape(item.article)}</b>${item.name?'<p>'+escape(item.name)+'</p>':''}</div><span class="inspection-state">${pending?'⚠ Дефект':item.status==='checked'?'✓ Проверен':'Ожидает проверки'}</span></div>${address}${item.client?'<div class="inspection-client">Клиент: '+escape(item.client)+'</div>':''}<div class="inspection-meta">Добавил ${escape(item.createdByName)} · ${escape(date(item.createdAt))}${item.status==='checked'?'<br>Проверил '+escape(item.checkedByName)+' · '+escape(date(item.checkedAt)):''}</div>${(defectsOnly?pendingDefects(item):item.defects||[]).map(d=>defectHtml(item,d)).join('')}${actions}</article>`;
 }
 async function loadMissingAddresses(board,addresses){
  const missing=new Set();
  for(const node of board.querySelectorAll('[data-inspection-address]')){
   const article=node.dataset.inspectionAddress;
   if(!addresses.has(article))missing.add(article);
  }
  if(!missing.size)return;
  for(const article of missing)addresses.set(article,addressLoading);
  try{
   const results=await getStorageAddresses([...missing]);
   for(const article of missing)addresses.set(article,results.get(article)||addressUnavailable);
  }catch{
   for(const article of missing)addresses.set(article,addressUnavailable);
  }
  if(!board.isConnected||board.closest('[hidden]'))return;
  for(const node of board.querySelectorAll('[data-inspection-address]')){
   node.textContent=addresses.get(node.dataset.inspectionAddress)||addressLoading;
  }
 }
 function render(){
  counters();const board=$('inspectionBoard');if(!board||board.closest('[hidden]'))return;
  let addresses=addressesByBoard.get(board);
  if(!addresses){addresses=new Map();addressesByBoard.set(board,addresses);}
  const label=$('inspectionLoadStatus');label.textContent=error||(!loaded&&!items.length?'Загружаем список…':'');label.hidden=!label.textContent;
  if(board.dataset.inspectionView==='defects'){
   const group=items.filter(item=>pendingDefects(item).length).sort((a,b)=>time(b.updatedAt||b.createdAt)-time(a.updatedAt||a.createdAt));
   $('inspectionDefectList').innerHTML=group.map(item=>itemHtml(item,addresses,true)).join('')||'<div class="inspection-empty">'+(loaded?'Нет дефектов, ожидающих решения.':'Ожидаем данные…')+'</div>';
  }else{
   for(const status of ['pending','checked']){const group=items.filter(item=>item.status===status).sort((a,b)=>time(b.createdAt)-time(a.createdAt));$('inspectionCount-'+status).textContent=String(group.length);$('inspectionList-'+status).innerHTML=group.map(item=>itemHtml(item,addresses)).join('')||'<div class="inspection-empty">'+(loaded?(status==='pending'?'Товара на проверку пока нет':'Проверенного товара пока нет'):'Ожидаем данные…')+'</div>';}
  }
  decoratePhotos(board);
  void loadMissingAddresses(board,addresses);
 }
 function start(){const p=getSession();if(!p?.uid)return;if(stop&&userId===p.uid){render();return;}stop?.();userId=p.uid;const uid=userId;
  stop=watch(snapshot=>{if(userId!==uid)return;if(!snapshot.fromCache)loaded=true;if(snapshot.items.length||loaded)items=snapshot.items;error='';render();},failure=>{if(userId!==uid)return;stop?.();stop=null;error='Не удалось загрузить товар на проверку. Подключение будет восстановлено при возвращении в приложение.';render();console.warn('Inspection list failed',failure);});
 }
 function bindClientSuggestions(input,list,clients){
  let matches=[],active=-1;
  function close(){
   matches=[];active=-1;
   list.hidden=true;list.replaceChildren();
   input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
  }
  function choose(index){
   const client=matches[index];if(!client)return;
   input.value=client.name;close();input.focus();
  }
  input.addEventListener('input',()=>{
   close();
   const query=key(input.value);
   if(!query)return;
   matches=clients.filter(client=>key(client.name).includes(query)).slice(0,5);
   if(!matches.length)return;
   list.replaceChildren(...matches.map((client,index)=>{
    const option=document.createElement('button');
    option.type='button';option.tabIndex=-1;option.id='inspection-client-option-'+index;
    option.setAttribute('role','option');option.setAttribute('aria-selected','false');
    option.textContent=client.name;
    option.addEventListener('pointerdown',event=>event.preventDefault());
    option.onclick=()=>choose(index);
    return option;
   }));
   list.hidden=false;input.setAttribute('aria-expanded','true');
  });
  input.addEventListener('blur',close);
  input.addEventListener('keydown',event=>{
   if(!matches.length||event.isComposing)return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
   if(event.key==='Enter'&&active>=0){event.preventDefault();choose(active);return;}
   if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
   event.preventDefault();
   active=active<0?(event.key==='ArrowDown'?0:matches.length-1)
    :Math.max(0,Math.min(matches.length-1,active+(event.key==='ArrowDown'?1:-1)));
   for(const [index,option] of [...list.children].entries())option.setAttribute('aria-selected',String(index===active));
   const option=list.children[active];
   input.setAttribute('aria-activedescendant',option.id);
   option.scrollIntoView({block:'nearest'});
  });
 }
 function open(status='pending'){
  if(status==='defects'){
   showModal('Дефекты на проверке','<div id="inspectionBoard" data-inspection-view="defects"><p id="inspectionLoadStatus" class="field-hint" role="status" hidden></p><div id="inspectionDefectList" class="inspection-list"></div></div>',[],'ОСМОТР ДЕТАЛЕЙ');
   bindBoardActions(status);render();return;
  }
  const clients=getClients(),products=getProducts();
  showModal('Товар на проверку',`<div id="inspectionBoard"><div class="inspection-toolbar"><p>Осмотр деталей перед заказом. Артикул обязателен, остальные поля — по желанию.</p><button type="button" id="inspectionAdd" class="primary-button">＋ Добавить товар</button></div><details id="inspectionAddPanel" class="inspection-add-panel"><summary>Добавление товара</summary><form id="inspectionAddForm"><div class="form-grid"><div class="field"><label for="inspectionArticle">Артикул *</label><input id="inspectionArticle" required maxlength="160" list="inspectionArticles" autocomplete="off" placeholder="Например, APMA2506"><datalist id="inspectionArticles">${products.slice(0,500).map(p=>`<option value="${escape(p.article)}">${escape(p.name||'')}</option>`).join('')}</datalist></div><div class="field"><label for="inspectionName">Наименование</label><input id="inspectionName" maxlength="200" placeholder="Крыло, капот…"></div><div class="field"><label for="inspectionClient">Клиент</label><input id="inspectionClient" maxlength="200" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="inspectionClientSuggestions" placeholder="Необязательно"><div id="inspectionClientSuggestions" class="inspection-client-suggestions" role="listbox" aria-label="Подсказки по имени клиента" hidden></div></div></div><div class="inspection-actions"><button type="submit" class="primary-button">Добавить на проверку</button><span class="inspection-feedback" id="inspectionAddFeedback" role="status"></span></div></form></details><p id="inspectionLoadStatus" class="field-hint" role="status" hidden></p><div class="inspection-columns">${['pending','checked'].map(s=>`<section class="inspection-column" id="inspectionColumn-${s}"><h3>${s==='pending'?'На проверку':'Проверенные'} <span id="inspectionCount-${s}">0</span></h3><div id="inspectionList-${s}" class="inspection-list"></div></section>`).join('')}</div></div>`,[],'ОСМОТР ДЕТАЛЕЙ');
  let draftId=crypto.randomUUID();$('inspectionAdd').addEventListener('click',()=>{$('inspectionAddPanel').open=true;$('inspectionArticle').focus();});
  bindClientSuggestions($('inspectionClient'),$('inspectionClientSuggestions'),clients);
  $('inspectionArticle').addEventListener('change',()=>{const product=products.find(p=>key(p.article)===key($('inspectionArticle').value));if(product&&!$('inspectionName').value)$('inspectionName').value=product.name||'';});
  $('inspectionAddForm').addEventListener('submit',async event=>{event.preventDefault();if(sending)return;const form=event.currentTarget;if(!form.reportValidity())return;
   const article=$('inspectionArticle').value.trim();if(!article){$('inspectionAddFeedback').textContent='Укажите артикул.';return;}
   const client=$('inspectionClient').value.trim(),person=clients.find(c=>key(c.name)===key(client)),button=form.querySelector('[type="submit"]'),feedback=$('inspectionAddFeedback');sending=true;button.disabled=true;feedback.textContent='Сохраняем…';
   try{await manage({action:'create',id:draftId,article,name:$('inspectionName').value.trim(),client,clientId:person?.id||''});draftId=crypto.randomUUID();if(form.isConnected)form.reset();feedback.textContent='Товар добавлен на проверку.';toast('Товар добавлен на проверку.');}
   catch(err){feedback.textContent=err.message||'Не удалось сохранить. Попробуйте ещё раз.';}
   finally{sending=false;button.disabled=false;}
  });
  bindBoardActions(status);render();if(status==='checked')requestAnimationFrame(()=>$('inspectionColumn-checked')?.scrollIntoView({block:'start',behavior:'smooth'}));
 }
 function bindBoardActions(status){
  $('inspectionBoard').addEventListener('click',event=>{const action=event.target.closest('[data-inspection-action]'),defect=event.target.closest('[data-inspection-defect]'),decision=event.target.closest('[data-inspection-decision]'),remove=event.target.closest('[data-inspection-remove]');
   if(action)void mutate({action:action.dataset.inspectionAction,id:action.dataset.inspectionId},action);
   else if(defect)openDefect(defect.dataset.inspectionDefect);
   else if(decision){if(decision.dataset.inspectionDecision==='cancel')confirmRemove(decision.dataset.inspectionId,decision.dataset.defectId,status);else void mutate({action:'decideDefect',id:decision.dataset.inspectionId,defectId:decision.dataset.defectId,decision:'approve'},decision);}
   else if(remove)confirmRemove(remove.dataset.inspectionRemove);
  });
 }
 async function mutate(data,button){if(button?.disabled)return;if(button)button.disabled=true;try{await manage(data);toast('Изменения сохранены.');}catch(err){toast(err.message||'Не удалось сохранить.');}finally{if(button?.isConnected)button.disabled=false;}}
 function confirmRemove(id,defectId='',status='pending'){const item=items.find(item=>item.id===id);if(!item)return;showModal('Снять товар с проверки?',`<p>Позиция <b>${escape(item.article)}</b> исчезнет из обоих списков.</p><div class="inspection-actions"><button type="button" id="inspectionCancelRemove" class="secondary-button">Назад</button><button type="button" id="inspectionConfirmRemove" class="small-button danger">Снять с проверки</button></div>`,[],'ПОДТВЕРЖДЕНИЕ');$('inspectionCancelRemove').onclick=()=>open(status);$('inspectionConfirmRemove').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await manage(defectId?{action:'decideDefect',id,defectId,decision:'cancel'}:{action:'remove',id});open(status);toast('Товар снят с проверки.');}catch(err){button.disabled=false;toast(err.message||'Не удалось снять товар.');}};}
 function openDefect(id){const item=items.find(item=>item.id===id);if(!item)return;let defectId=crypto.randomUUID(),photos=null,previewVersion=0;
  showModal('Дефект товара',`<p><b>${escape(item.article)}</b> ${escape(item.name)}</p><form id="inspectionDefectForm"><div class="field"><label for="inspectionDefectText">Описание дефекта *</label><textarea id="inspectionDefectText" required maxlength="2000" placeholder="Опишите обнаруженную проблему"></textarea></div><div class="field"><label for="inspectionDefectPhotos">Фото дефекта</label><input id="inspectionDefectPhotos" type="file" accept="image/*" multiple><span class="field-hint">До 5 фотографий. После сохранения менеджер сможет принять решение.</span><div id="inspectionDefectPreview" aria-live="polite"></div></div><div class="inspection-actions"><button type="button" id="inspectionDefectBack" class="secondary-button">Назад</button><button type="submit" class="primary-button">Сохранить дефект</button></div><p id="inspectionDefectFeedback" class="inspection-feedback" role="status"></p></form>`,[],'ОСМОТР ДЕТАЛИ');
  $('inspectionDefectBack').onclick=()=>open();
  $('inspectionDefectPhotos').onchange=async event=>{
   photos=null;defectId=crypto.randomUUID();
   const preview=$('inspectionDefectPreview'),files=[...event.currentTarget.files],version=++previewVersion;
   preview.replaceChildren();
   if(!files.length||!preparePhotoPreviews)return;
   preview.textContent='Подготавливаем фото…';
   try{
    const urls=await preparePhotoPreviews(files);
    if(!preview.isConnected||version!==previewVersion)return;
    preview.innerHTML=defectPhotosHtml(urls,item.article);
    decoratePhotos(preview);
   }catch(error){
    if(preview.isConnected&&version===previewVersion)preview.textContent=error.message||'Не удалось подготовить фотографии.';
   }
  };
  $('inspectionDefectForm').onsubmit=async event=>{event.preventDefault();if(sending)return;const form=event.currentTarget;if(!form.reportValidity())return;const button=form.querySelector('[type="submit"]'),feedback=$('inspectionDefectFeedback'),text=$('inspectionDefectText').value.trim(),photoInput=$('inspectionDefectPhotos'),files=photoInput.files;sending=true;button.disabled=photoInput.disabled=true;
   try{feedback.textContent='Сохраняем фотографии и описание…';photos??=await upload(id,defectId,files);await manage({action:'reportDefect',id,defectId,text,photos});if(form.isConnected)open();toast('Дефект добавлен. Ожидаем решения менеджера.');}
   catch(err){feedback.textContent=err.message||'Не удалось сохранить дефект. Попробуйте ещё раз.';}
   finally{sending=false;if(button.isConnected)button.disabled=photoInput.disabled=false;}
  };
 }
 for(const status of ['pending','checked']){const node=$(status==='pending'?'inspectionPendingCard':'inspectionCheckedCard');node?.addEventListener('click',()=>open(status));node?.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();open(status);}});}
 $('inspectionDefectsCard')?.addEventListener('click',()=>open('defects'));
 window.addEventListener('online',()=>{if(!stop&&getSession()?.uid)start();});window.addEventListener('warehouse-app-resumed',()=>{if(!stop&&getSession()?.uid)start();});
 return {start,open,stop(){userId='';stop?.();stop=null;items=[];loaded=false;error='';counters();if($('inspectionBoard')||$('inspectionDefectForm'))closeModal();}};
}
